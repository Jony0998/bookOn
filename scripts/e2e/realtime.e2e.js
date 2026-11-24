/**
 * End-to-end test of the real-time layer with real Socket.io clients:
 * identity from cookies, private conversation rooms, live messages, typing,
 * order status to the reader, notifications to the library.
 * Only runs against a "*_test" database; removes what it creates.
 *
 * Usage: MONGO_URL=<...>/BookOn_test node scripts/e2e/realtime.e2e.js
 */
const path = require("path");
const bcrypt = require("bcrypt");
const { io } = require("socket.io-client");
const { startServer, check, summary, requireTestDb } = require("./harness");

const ROOT = path.join(__dirname, "..", "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Socket that records every event it gets */
const client = (api, cookie) => {
  const socket = io(api, { transports: ["websocket"], extraHeaders: cookie ? { Cookie: cookie } : {}, reconnection: false, forceNew: true });
  socket.got = [];
  socket.onAny((event, payload) => socket.got.push({ event, payload }));
  return new Promise((resolve, reject) => {
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  });
};
const waitFor = async (socket, event, test = () => true, ms = 4000) => {
  for (let t = 0; t < ms; t += 50) {
    const hit = socket.got.find((g) => g.event === event && test(g.payload));
    if (hit) return hit.payload;
    await sleep(50);
  }
  return null;
};
const join = (socket, payload) => new Promise((resolve) => socket.emit("inquiry:join", payload, resolve));

(async () => {
  const db = await requireTestDb();
  const members = db.collection("members");
  const inquiries = db.collection("inquiries");
  const orders = db.collection("orders");
  const orderItems = db.collection("orderItems");
  const products = db.collection("products");
  const library = await members.findOne({ memberType: "LIBRARY" });
  await members.updateOne({ _id: library._id }, { $set: { memberPassword: await bcrypt.hash("rt-admin-1", 10) } });
  await inquiries.deleteMany({ inquiryEmail: /@example\.com$/ });
  const book = await products.findOne({ productStatus: "PROCESS", productLeftCount: { $gte: 2 } });

  const server = await startServer(ROOT, 3017);
  const { api } = server;
  const stamp = Date.now().toString(36);
  const nick = `rt_${stamp}`;
  const json = (body, cookie) => ({ method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const sockets = [];
  const createdOrders = [];

  try {
    // identities
    let res = await fetch(`${api}/member/signup`, json({ memberNick: nick, memberEmail: `${nick}@example.com`, memberPassword: "rt-pass-1234" }));
    const readerCookie = (res.headers.get("set-cookie") || "").split(";")[0];
    const login = await fetch(`${api}/admin/login`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ memberNick: library.memberNick, memberPassword: "rt-admin-1" }) });
    const adminCookie = (login.headers.get("set-cookie") || "").split(";")[0];

    const lib = await client(api, adminCookie);
    const reader = await client(api, readerCookie);
    const guest = await client(api);
    const stranger = await client(api);
    sockets.push(lib, reader, guest, stranger);
    check("sockets connect (library, reader, guest)", lib.connected && reader.connected && guest.connected);

    // ---- a guest asks a question -> the library hears about it at once
    res = await fetch(`${api}/inquiry/create`, json({ name: "e2e Realtime", email: `rt_${stamp}@example.com`, topic: "BOOK", message: "Jonli savol: kitob bormi?" }));
    const { inquiry, key } = await res.json();
    let ev = await waitFor(lib, "inquiry:new", (p) => p.inquiryId === inquiry._id);
    check("library gets inquiry:new with counts", !!ev && ev.name === "e2e Realtime" && ev.newInquiries >= 1 && ev.preview.includes("Jonli savol"), JSON.stringify(ev));
    check("readers don't get library events", !reader.got.some((g) => g.event === "inquiry:new") && !guest.got.some((g) => g.event === "inquiry:new"));

    // ---- private room: key required
    check("join with the right key", (await join(guest, { id: inquiry._id, key })).ok === true);
    check("join with a wrong key refused", (await join(stranger, { id: inquiry._id, key: "x".repeat(43) })).ok === false);
    check("join with a bad id refused", (await join(stranger, { id: "nope" })).ok === false);
    check("library may join any conversation", (await join(lib, { id: inquiry._id })).ok === true);

    // ---- typing, both ways, throttled, never to outsiders
    guest.emit("inquiry:typing", { id: inquiry._id });
    ev = await waitFor(lib, "inquiry:typing", (p) => p.inquiryId === inquiry._id && p.from === "READER");
    check("library sees the reader typing", !!ev);
    lib.emit("inquiry:typing", { id: inquiry._id });
    ev = await waitFor(guest, "inquiry:typing", (p) => p.from === "LIBRARY");
    check("reader sees the library typing", !!ev);
    for (let i = 0; i < 5; i++) guest.emit("inquiry:typing", { id: inquiry._id });
    await sleep(400);
    check("typing is throttled (1 per 1.5 s)", lib.got.filter((g) => g.event === "inquiry:typing").length === 1, String(lib.got.filter((g) => g.event === "inquiry:typing").length));
    stranger.emit("inquiry:typing", { id: inquiry._id });
    await sleep(300);
    check("outsiders can't type into a room", lib.got.filter((g) => g.event === "inquiry:typing").length === 1 && !stranger.got.some((g) => g.event === "inquiry:typing"));

    // ---- library replies -> the guest sees it live
    await fetch(`${api}/admin/inquiry/${inquiry._id}/reply`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: adminCookie }, body: new URLSearchParams({ message: "Ha, bor! Ertaga yetkazamiz." }) });
    ev = await waitFor(guest, "inquiry:message", (p) => p.message.messageFrom === "LIBRARY");
    check("guest gets the library reply live", !!ev && ev.message.messageText === "Ha, bor! Ertaga yetkazamiz." && ev.status === "ANSWERED", JSON.stringify(ev));
    check("outsider gets nothing from that room", !stranger.got.some((g) => g.event === "inquiry:message"));

    // ---- reader reply -> library notified
    await fetch(`${api}/inquiry/${inquiry._id}/reply`, json({ key, message: "Rahmat, kutaman!" }));
    ev = await waitFor(lib, "inquiry:reply", (p) => p.inquiryId === inquiry._id);
    check("library gets inquiry:reply when the reader writes", !!ev && ev.message.messageText === "Rahmat, kutaman!");

    // ---- status change reaches the room
    await fetch(`${api}/admin/inquiry/${inquiry._id}/status`, json({ inquiryStatus: "CLOSED" }, adminCookie));
    ev = await waitFor(guest, "inquiry:status", (p) => p.status === "CLOSED");
    check("closing is pushed to the conversation", !!ev);

    // ---- a member's own conversation: joins without a key; unread pushed to all their tabs
    res = await fetch(`${api}/inquiry/create`, json({ topic: "ORDER", message: "Buyurtmam qachon keladi?" }, readerCookie));
    const mine = (await res.json()).inquiry;
    check("owner joins own conversation without a key", (await join(reader, { id: mine._id })).ok === true);
    await fetch(`${api}/admin/inquiry/${mine._id}/reply`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: adminCookie }, body: new URLSearchParams({ message: "Bugun kechqurun yetadi." }) });
    ev = await waitFor(reader, "inquiry:unread", (p) => p.inquiryId === mine._id);
    check("member gets the unread count live", !!ev && ev.unread === 1, JSON.stringify(ev));

    // ---- orders: library hears new orders, the reader hears status changes
    res = await fetch(`${api}/order/create`, json({ items: [{ productId: String(book._id), itemQuantity: 1, itemPrice: 1 }], delivery: { phone: "+998901234567", address: "Toshkent, Chilonzor 1", note: "" } }, readerCookie));
    const order = (await res.json()).result;
    createdOrders.push(order._id);
    ev = await waitFor(lib, "order:new", (p) => p.orderId === order._id);
    check("library gets order:new with the pending count", !!ev && ev.pendingOrders >= 1, JSON.stringify(ev));
    await fetch(`${api}/admin/order/${order._id}/status`, json({ orderStatus: "PROCESS" }, adminCookie));
    ev = await waitFor(reader, "order:status", (p) => p.orderId === order._id);
    check("reader sees 'on the way' live", !!ev && ev.orderStatus === "PROCESS" && ev.by === "LIBRARY", JSON.stringify(ev));
    check("other readers don't get it", !guest.got.some((g) => g.event === "order:status") && !stranger.got.some((g) => g.event === "order:status"));
    await fetch(`${api}/order/update`, json({ orderId: order._id, orderStatus: "FINISH" }, readerCookie));
    ev = await waitFor(lib, "order:status", (p) => p.orderId === order._id && p.by === "READER");
    check("library sees the reader's 'received'", !!ev && ev.orderStatus === "FINISH");

    // ---- an expired / forged token just means "guest"
    const forged = await client(api, "accessToken=forged.token.value");
    sockets.push(forged);
    check("forged token connects as a guest", forged.connected && (await join(forged, { id: mine._id })).ok === false);
  } catch (err) {
    check("unexpected error", false, err.stack || String(err));
  } finally {
    sockets.forEach((s) => s.close());
    const ids = createdOrders.map((id) => new (require("mongoose").Types.ObjectId)(id));
    const items = await orderItems.find({ orderId: { $in: ids } }).toArray();
    for (const it of items) await products.updateOne({ _id: it.productId }, { $inc: { productLeftCount: it.itemQuantity } });
    await orderItems.deleteMany({ orderId: { $in: ids } });
    await orders.deleteMany({ _id: { $in: ids } });
    await inquiries.deleteMany({ $or: [{ inquiryEmail: /@example\.com$/ }, { inquiryName: /^e2e / }] });
    await members.deleteOne({ memberNick: nick });
    await members.updateOne({ _id: library._id }, { $set: { memberPassword: library.memberPassword } });
    await server.stop();
  }
  process.exit(summary());
})();
