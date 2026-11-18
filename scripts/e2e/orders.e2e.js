/**
 * End-to-end test of checkout and the order lifecycle:
 * delivery details, stock checks, library confirm/deliver/cancel, stock and points.
 * Only runs against a "*_test" database; restores everything it touches.
 *
 * Usage: MONGO_URL=<...>/BookOn_test node scripts/e2e/orders.e2e.js
 */
const path = require("path");
const bcrypt = require("bcrypt");
const { startServer, check, summary, requireTestDb } = require("./harness");

const ROOT = path.join(__dirname, "..", "..");

(async () => {
  const db = await requireTestDb();
  const members = db.collection("members");
  const products = db.collection("products");
  const orders = db.collection("orders");
  const orderItems = db.collection("orderItems");

  const library = await members.findOne({ memberType: "LIBRARY" });
  await members.updateOne({ _id: library._id }, { $set: { memberPassword: await bcrypt.hash("orders-admin-1", 10), memberStatus: "ACTIVE" } });
  const book = await products.findOne({ productStatus: "PROCESS" });
  const originalStock = book.productLeftCount;
  await products.updateOne({ _id: book._id }, { $set: { productLeftCount: 5 } });

  const server = await startServer(ROOT);
  const { api } = server;
  const stamp = Date.now().toString(36);
  const nick = `ord_${stamp}`;
  const createdOrderIds = [];

  const json = (body, cookie) => ({ method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const stock = async () => (await products.findOne({ _id: book._id })).productLeftCount;
  const points = async () => (await members.findOne({ memberNick: nick })).memberPoints;
  const items = (qty) => [{ productId: String(book._id), itemQuantity: qty, itemPrice: 0.01 }];

  try {
    let res = await fetch(`${api}/member/signup`, json({ memberNick: nick, memberEmail: `${nick}@example.com`, memberPassword: "orders-pass-1" }));
    const reader = (res.headers.get("set-cookie") || "").split(";")[0];
    check("reader signed up", res.status === 201);

    const login = await fetch(`${api}/admin/login`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ memberNick: library.memberNick, memberPassword: "orders-admin-1" }) });
    const admin = (login.headers.get("set-cookie") || "").split(";")[0];
    check("library signed in", admin.startsWith("connect.sid="));
    const setStatus = (id, orderStatus, cookie = admin) => fetch(`${api}/admin/order/${id}/status`, json({ orderStatus }, cookie));

    // ---- checkout validation
    const delivery = { phone: "+998 90 123 45 67", address: "Toshkent, Yunusobod 4-12", note: "Qoʻngʻiroq qiling" };
    res = await fetch(`${api}/order/create`, json({ items: items(1), delivery: { ...delivery, phone: "abc" } }, reader));
    check("checkout rejects bad phone", res.status === 400);
    res = await fetch(`${api}/order/create`, json({ items: items(1), delivery: { ...delivery, address: "x" } }, reader));
    check("checkout rejects short address", res.status === 400);
    res = await fetch(`${api}/order/create`, json({ items: items(6), delivery }, reader));
    let body = await res.json();
    check("checkout rejects more than in stock", res.status === 400 && /stock/i.test(body.message), body.message);

    // ---- checkout ok (prices from the server, details stored, profile updated)
    res = await fetch(`${api}/order/create`, json({ items: items(2), delivery, saveToProfile: true }, reader));
    body = await res.json();
    const o1 = body.result;
    createdOrderIds.push(o1?._id);
    check("checkout creates a pending order", res.status === 201 && o1.orderStatus === "PAUSE");
    check("delivery details saved on the order", o1.orderPhone === "+998901234567" && o1.orderAddress === delivery.address && o1.orderNote === delivery.note);
    const expectedPrice = book.productDiscountPrice != null && book.productDiscountPrice < book.productPrice ? book.productDiscountPrice : book.productPrice;
    const expectedSub = expectedPrice * 2;
    check("server-side prices (client price ignored)", o1.orderTotal === expectedSub + (expectedSub < 100 ? 5 : 0), `total ${o1.orderTotal}`);
    const profile = await members.findOne({ memberNick: nick });
    check("saveToProfile stores phone and address", profile.memberPhone === "+998901234567" && profile.memberAddress === delivery.address);
    check("placing an order does not take stock yet", (await stock()) === 5);

    // ---- old clients (bare array) still work, using the profile details
    res = await fetch(`${api}/order/create`, json(items(1), reader));
    body = await res.json();
    createdOrderIds.push(body.result?._id);
    check("legacy array checkout uses profile details", res.status === 201 && body.result.orderAddress === delivery.address);

    // ---- reader can no longer self-confirm
    res = await fetch(`${api}/order/update`, json({ orderId: o1._id, orderStatus: "PROCESS" }, reader));
    check("reader cannot confirm an order", res.status === 400);

    // ---- library confirms: stock down, +1 point, single-shot
    const pointsBefore = await points();
    res = await setStatus(o1._id, "PROCESS", reader);
    check("admin action needs library session", res.status === 401);
    res = await setStatus(o1._id, "PROCESS");
    check("library confirms", res.status === 200);
    check("confirm takes stock", (await stock()) === 3, `stock ${await stock()}`);
    check("confirm gives the reader 1 point", (await points()) === pointsBefore + 1);
    res = await setStatus(o1._id, "PROCESS");
    check("double confirm is rejected", res.status === 400 && (await stock()) === 3);

    // ---- library cancels a confirmed order: stock returns
    res = await setStatus(o1._id, "DELETE");
    check("library cancels a confirmed order", res.status === 200);
    check("cancel returns stock", (await stock()) === 5, `stock ${await stock()}`);
    res = await setStatus(o1._id, "FINISH");
    check("cancelled order cannot be delivered", res.status === 400);

    // ---- confirm fails cleanly when stock ran out meanwhile
    res = await fetch(`${api}/order/create`, json({ items: items(4), delivery }, reader));
    const o3 = (await res.json()).result;
    createdOrderIds.push(o3?._id);
    await products.updateOne({ _id: book._id }, { $set: { productLeftCount: 2 } });
    res = await setStatus(o3._id, "PROCESS");
    body = await res.json();
    check("confirm without enough stock is refused", res.status === 400 && /stock/i.test(body.message));
    check("refused confirm leaves order pending and stock intact", (await orders.findOne({ _id: new (require("mongoose").Types.ObjectId)(o3._id) })).orderStatus === "PAUSE" && (await stock()) === 2);

    // ---- normal path to delivered; reader may also mark received
    await products.updateOne({ _id: book._id }, { $set: { productLeftCount: 5 } });
    res = await setStatus(o3._id, "PROCESS");
    check("confirm after restock", res.status === 200 && (await stock()) === 1);
    res = await setStatus(o3._id, "FINISH");
    check("library marks delivered", res.status === 200);
    check("delivered keeps stock taken", (await stock()) === 1);

    // ---- reader cancels their own pending order
    res = await fetch(`${api}/order/create`, json({ items: items(1), delivery }, reader));
    const o4 = (await res.json()).result;
    createdOrderIds.push(o4?._id);
    res = await fetch(`${api}/order/update`, json({ orderId: o4._id, orderStatus: "DELETE" }, reader));
    check("reader cancels a pending order", res.status === 200);

    const page = await (await fetch(`${api}/admin/order/all?status=PAUSE`, { headers: { Cookie: admin } })).text();
    check("admin orders page shows actions", page.includes("order-action") && page.includes("Tasdiqlash"));
  } finally {
    const { Types } = require("mongoose");
    const ids = createdOrderIds.filter(Boolean).map((id) => new Types.ObjectId(id));
    await orderItems.deleteMany({ orderId: { $in: ids } });
    await orders.deleteMany({ _id: { $in: ids } });
    await members.deleteOne({ memberNick: nick });
    await products.updateOne({ _id: book._id }, { $set: { productLeftCount: originalStock } });
    await members.updateOne({ _id: library._id }, { $set: { memberPassword: library.memberPassword, memberStatus: library.memberStatus } });
    await server.stop();
  }
  process.exitCode = summary();
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
