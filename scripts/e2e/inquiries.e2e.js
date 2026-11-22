/**
 * End-to-end test of the reception desk: guest and member questions, private
 * links, library replies, unread badge, statuses, validation and rate limits.
 * Only runs against a "*_test" database; removes what it creates.
 *
 * Usage: MONGO_URL=<...>/BookOn_test node scripts/e2e/inquiries.e2e.js
 */
const path = require("path");
const bcrypt = require("bcrypt");
const { startServer, check, summary, requireTestDb } = require("./harness");

const ROOT = path.join(__dirname, "..", "..");
const TEST_EMAILS = /@example\.com$/;

(async () => {
  const db = await requireTestDb();
  const members = db.collection("members");
  const inquiries = db.collection("inquiries");
  const library = await members.findOne({ memberType: "LIBRARY" });
  await members.updateOne({ _id: library._id }, { $set: { memberPassword: await bcrypt.hash("inq-admin-1", 10), memberStatus: "ACTIVE" } });
  // Earlier runs from this machine would count against the hourly limit
  await inquiries.deleteMany({ $or: [{ inquiryEmail: TEST_EMAILS }, { inquiryName: /^e2e / }] });

  const server = await startServer(ROOT);
  const { api } = server;
  const stamp = Date.now().toString(36);
  const nick = `inq_${stamp}`;
  const json = (body, cookie, method = "POST") => ({ method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const get = (url, cookie) => fetch(api + url, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });

  try {
    // ---- validation
    let res = await fetch(`${api}/inquiry/create`, json({ name: "e2e Guest", message: "Kitob qachon keladi?" }));
    check("guest needs an email", res.status === 400);
    res = await fetch(`${api}/inquiry/create`, json({ name: "e2e Guest", email: `g_${stamp}@example.com`, message: "hi" }));
    check("too short message rejected", res.status === 400);
    res = await fetch(`${api}/inquiry/create`, json({ name: "e", email: `g_${stamp}@example.com`, message: "Kitob qachon keladi?" }));
    check("too short name rejected", res.status === 400);
    res = await fetch(`${api}/inquiry/create`, json({ name: "e2e Bot", email: `b_${stamp}@example.com`, message: "Buy cheap stuff now", website: "http://spam" }));
    check("honeypot filled -> rejected", res.status === 400 && !(await inquiries.findOne({ inquiryName: "e2e Bot" })));
    res = await fetch(`${api}/inquiry/create`, json({ name: "e2e Guest", email: `g_${stamp}@example.com`, phone: "12", message: "Kitob qachon keladi?" }));
    check("bad phone rejected", res.status === 400);

    // ---- guest question
    res = await fetch(`${api}/inquiry/create`, json({ name: "e2e Guest", email: `G_${stamp}@Example.com`, phone: "+998 90 111 22 33", topic: "BOOK", message: "Salom!\r\n\r\n\r\n\r\n“Oʻtkan kunlar” qachon keladi?", lang: "ru" }));
    let body = await res.json();
    const guest = body.inquiry;
    const key = body.key;
    check("guest question created", res.status === 201 && guest.inquiryStatus === "NEW" && guest.inquiryTopic === "BOOK");
    check("private key returned", typeof key === "string" && key.length === 43);
    check("no internal fields leaked", !("inquiryIpHash" in guest) && !("inquiryMember" in guest));
    let doc = await inquiries.findOne({ _id: new (require("mongoose").Types.ObjectId)(guest._id) });
    check("email normalised, phone stored, lang kept", doc.inquiryEmail === `g_${stamp}@example.com` && doc.inquiryPhone === "+998901112233" && doc.inquiryLang === "ru");
    check("blank lines collapsed", doc.inquiryMessages[0].messageText === "Salom!\n\n“Oʻtkan kunlar” qachon keladi?", JSON.stringify(doc.inquiryMessages[0].messageText));

    res = await get(`/inquiry/${guest._id}`);
    check("thread hidden without key", res.status === 404);
    res = await get(`/inquiry/${guest._id}?key=${"x".repeat(43)}`);
    check("thread hidden with wrong key", res.status === 404);
    res = await get(`/inquiry/not-an-id?key=${key}`);
    check("bad id -> 404", res.status === 404);
    res = await get(`/inquiry/${guest._id}?key=${encodeURIComponent(key)}`);
    check("thread opens with key", res.status === 200 && (await res.json()).inquiryMessages.length === 1);

    res = await fetch(`${api}/inquiry/${guest._id}/reply`, json({ key, message: "Yana bir savol: narxi qancha?" }));
    body = await res.json();
    check("guest can reply with key", res.status === 200 && body.inquiryMessages.length === 2 && body.inquiryMessages[1].messageFrom === "READER");
    res = await fetch(`${api}/inquiry/${guest._id}/reply`, json({ message: "Kalitsiz javob yozishga urinish" }));
    check("reply without key refused", res.status === 404);

    // ---- member question
    res = await fetch(`${api}/member/signup`, json({ memberNick: nick, memberEmail: `${nick}@example.com`, memberPassword: "inq-pass-123" }));
    const reader = (res.headers.get("set-cookie") || "").split(";")[0];
    check("reader signed up", res.status === 201);
    res = await fetch(`${api}/inquiry/create`, json({ topic: "ORDER", orderId: "0123456789abcdef01234567", message: "Buyurtmam qayerda?" }, reader));
    body = await res.json();
    const mine = body.inquiry;
    check("member question uses account nick and email", res.status === 201 && mine.inquiryName === nick && mine.inquiryEmail === `${nick}@example.com`);
    check("someone else's order not linked", !mine.inquiryOrder);
    res = await get("/inquiry/mine", reader);
    let list = await res.json();
    check("member sees own list", res.status === 200 && list.length === 1 && list[0]._id === mine._id);
    res = await get("/inquiry/mine");
    check("list needs login", res.status === 401);
    res = await get(`/inquiry/${guest._id}`, reader);
    check("member can't open another person's thread", res.status === 404);

    // ---- hourly limit (3 per sender): guest + member already used 2 from this IP
    res = await fetch(`${api}/inquiry/create`, json({ name: "e2e Third", email: `t_${stamp}@example.com`, message: "Uchinchi savol matni" }));
    check("third question allowed", res.status === 201);
    res = await fetch(`${api}/inquiry/create`, json({ name: "e2e Fourth", email: `f_${stamp}@example.com`, message: "Toʻrtinchi savol matni" }));
    body = await res.json();
    check("fourth in an hour -> 429", res.status === 429 && /hour/.test(body.message), body.message);

    // ---- library side
    res = await get("/admin/inquiry/all");
    check("admin inbox requires login", res.status === 401);
    const login = await fetch(`${api}/admin/login`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ memberNick: library.memberNick, memberPassword: "inq-admin-1" }) });
    const admin = (login.headers.get("set-cookie") || "").split(";")[0];
    let html = await (await get("/admin/inquiry/all", admin)).text();
    check("inbox lists waiting questions", html.includes("e2e Guest") && html.includes(`@${nick}`) && html.includes("Murojaatlar"));
    check("sidebar badge shows waiting count", /Javob kutayotgan murojaatlar">\s*\d+/.test(html));
    html = await (await get(`/admin/inquiry/${guest._id}`, admin)).text();
    check("thread page shows messages and contact", html.includes("qachon keladi?") && html.includes(`g_${stamp}@example.com`) && html.includes("Ruscha"));

    res = await fetch(`${api}/admin/inquiry/${guest._id}/reply`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: admin }, body: new URLSearchParams({ message: "ok" }) });
    check("too short library reply refused", (await res.text()).includes("5–2000"));
    res = await fetch(`${api}/admin/inquiry/${guest._id}/reply`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: admin }, body: new URLSearchParams({ message: "Salom! Kitob ertaga keladi, narxi $12." }) });
    check("library reply redirects back (no mail in tests)", res.status === 302 && /\/admin\/inquiry\/[0-9a-f]{24}\?sent=1&mail=0$/.test(res.headers.get("location") || ""));
    doc = await inquiries.findOne({ _id: doc._id });
    check("status ANSWERED, reader has unread", doc.inquiryStatus === "ANSWERED" && doc.inquiryReaderUnread === true);
    await new Promise((r) => setTimeout(r, 300));
    check("reply email (dev log) carries the private link", server.log().includes(`reply -> g_${stamp}@example.com: `) && server.log().includes(`/reception/${guest._id}?key=${key}`));
    res = await get(`/inquiry/${guest._id}?key=${encodeURIComponent(key)}`);
    body = await res.json();
    check("guest sees the answer and it's marked read", body.inquiryMessages.at(-1).messageFrom === "LIBRARY" && body.inquiryReaderUnread === false);

    // member unread badge
    await fetch(`${api}/admin/inquiry/${mine._id}/reply`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: admin }, body: new URLSearchParams({ message: "Buyurtmangiz yoʻlda, bugun yetadi." }) });
    res = await get("/inquiry/unread", reader);
    check("member unread count = 1", (await res.json()).unread === 1);
    await get(`/inquiry/${mine._id}`, reader);
    res = await get("/inquiry/unread", reader);
    check("opening clears unread", (await res.json()).unread === 0);
    res = await fetch(`${api}/inquiry/${mine._id}/reply`, json({ message: "Rahmat, kutaman!" }, reader));
    body = await res.json();
    check("member reply reopens for the library", res.status === 200 && body.inquiryStatus === "NEW");

    // statuses
    res = await fetch(`${api}/admin/inquiry/${mine._id}/status`, json({ inquiryStatus: "CLOSED" }, admin));
    check("library closes", res.status === 200 && (await res.json()).inquiryStatus === "CLOSED");
    res = await fetch(`${api}/admin/inquiry/${mine._id}/status`, json({ inquiryStatus: "DONE" }, admin));
    check("unknown status refused", res.status === 400);
    res = await fetch(`${api}/admin/inquiry/${mine._id}/status`, json({ inquiryStatus: "CLOSED" }, reader));
    check("reader can't use admin status", res.status === 401);
    html = await (await get("/admin/inquiry/all?status=CLOSED", admin)).text();
    check("closed tab lists it", html.includes(`@${nick}`));

    // reader burst limit: guest thread has 2 reader messages in the last minutes
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await fetch(`${api}/inquiry/${guest._id}/reply`, json({ key, message: `Qoʻshimcha savol ${i + 1}` }))).status);
    check("reader burst limited to 5 per 10 min", codes.join(",") === "200,200,200,429", codes.join(","));
  } catch (err) {
    check("unexpected error", false, err.stack || String(err));
  } finally {
    await inquiries.deleteMany({ $or: [{ inquiryEmail: TEST_EMAILS }, { inquiryName: /^e2e / }] });
    await members.deleteOne({ memberNick: nick });
    await members.updateOne({ _id: library._id }, { $set: { memberPassword: library.memberPassword } });
    await server.stop();
  }
  process.exit(summary());
})();
