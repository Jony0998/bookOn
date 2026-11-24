/**
 * End-to-end test of recommendations: the similarity maths, the background
 * rebuild, "similar books" with reasons, "for you" for members, guests with
 * viewed books and complete strangers. Builds its own small world of books,
 * readers and orders in a "*_test" database and removes it afterwards.
 *
 * Usage: MONGO_URL=<...>/BookOn_test node scripts/e2e/reco.e2e.js
 */
const path = require("path");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const { startServer, check, summary, requireTestDb } = require("./harness");

const ROOT = path.join(__dirname, "..", "..");
const PUBLISHER = "E2E Reco Press";
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs" } });
const sim = require(path.join(ROOT, "src", "libs", "reco", "similarity.ts"));

(async () => {
  // ---- the maths, no database
  const v = (o) => new Map(Object.entries(o));
  check("cosine: same vector = 1, disjoint = 0", Math.abs(sim.cosine(v({ a: 3, b: 1 }), v({ a: 3, b: 1 })) - 1) < 1e-9 && sim.cosine(v({ a: 1 }), v({ b: 1 })) === 0);
  check("strongest signal per reader counts", sim.buildVectors([{ member: "m", book: "x", weight: 1 }, { member: "m", book: "x", weight: 3 }]).get("x").get("m") === 3);
  check("'Unknown' author is no author", sim.authorKey("Unknown") === "" && sim.authorKey("Gʻafur  Gʻulom") === "gafur gulom");
  const p = sim.personalize(new Map([["x", 3]]), () => [{ id: "y", score: 0.5, reason: "TOGETHER" }, { id: "z", score: 0.4, reason: "AUTHOR" }], new Set(["z"]));
  check("personalize skips owned books and names the cause", p.length === 1 && p[0].id === "y" && p[0].because === "x");

  const db = await requireTestDb();
  const products = db.collection("products");
  const members = db.collection("members");
  const orders = db.collection("orders");
  const orderItems = db.collection("orderItems");
  const neighbors = db.collection("bookNeighbors");
  const stamp = Date.now().toString(36);
  await products.deleteMany({ productPublisher: PUBLISHER });

  const now = new Date();
  const book = (name, author, collection, extra = {}) => ({
    productStatus: "PROCESS", productCollection: collection, productName: `${name} ${stamp}`, productAuthor: author, productPrice: 10, productLeftCount: 9,
    productLanguage: "UZ", productShelves: [], productImages: [], productViews: 0, productLikes: 0, productPublisher: PUBLISHER, createdAt: now, updatedAt: now, ...extra,
  });
  const ins = await products.insertMany([
    book("Reco Alpha", "Reco Author One", "FICTION"),
    book("Reco Beta", "Reco Author Two", "SCIENCE"),
    book("Reco Gamma", "Reco Author One", "HISTORY"),
    book("Reco Delta", "Reco Author One", "FICTION", { productStatus: "PAUSE" }),
    book("Reco Zeta", "Reco Author Three", "CHILDREN"),
  ]);
  const [X, Y, Z, P, W] = Object.values(ins.insertedIds);
  const S = (id) => String(id);

  const hash = await bcrypt.hash("reco-pass-123", 10);
  const m = await members.insertMany(["a", "b", "d"].map((k) => ({ memberType: "USER", memberStatus: "ACTIVE", memberNick: `reco_${stamp}_${k}`, memberPassword: hash, memberPoints: 0, createdAt: now, updatedAt: now })));
  const [m1, m2, m4] = Object.values(m.insertedIds);
  const createdOrders = [];
  const order = async (memberId, books, status = "PROCESS") => {
    const o = await orders.insertOne({ memberId, orderStatus: status, orderTotal: 10 * books.length, orderDelivery: 0, createdAt: now, updatedAt: now });
    createdOrders.push(o.insertedId);
    await orderItems.insertMany(books.map((b) => ({ orderId: o.insertedId, productId: b, itemQuantity: 1, itemPrice: 10, createdAt: now, updatedAt: now })));
  };

  const server = await startServer(ROOT, 3016);
  const { api } = server;
  const json = (body, cookie) => ({ method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const library = await members.findOne({ memberType: "LIBRARY" });
  await members.updateOne({ _id: library._id }, { $set: { memberPassword: await bcrypt.hash("reco-admin-1", 10) } });

  try {
    // reader m3 signs up through the API (so we have their cookie)
    let res = await fetch(`${api}/member/signup`, json({ memberNick: `reco_${stamp}_c`, memberEmail: `reco_${stamp}@example.com`, memberPassword: "reco-pass-123" }));
    const reader = (res.headers.get("set-cookie") || "").split(";")[0];
    const m3 = (await members.findOne({ memberNick: `reco_${stamp}_c` }))._id;

    await order(m1, [X, Y]);
    await order(m2, [X, Y]);
    await order(m3, [X]);
    await order(m4, [X, W], "DELETE"); // cancelled: must not count

    const login = await fetch(`${api}/admin/login`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ memberNick: library.memberNick, memberPassword: "reco-admin-1" }) });
    const admin = (login.headers.get("set-cookie") || "").split(";")[0];
    res = await fetch(`${api}/admin/recommendations/rebuild`, { method: "POST", headers: { Cookie: admin } });
    const run = await res.json();
    check("admin rebuild runs and reports", res.status === 200 && run.books > 0 && run.interactions > 0 && typeof run.ms === "number", JSON.stringify(run));
    res = await fetch(`${api}/admin/recommendations/rebuild`, { method: "POST" });
    check("rebuild needs the library login", res.status === 401);
    check("neighbors stored for books on sale only", !!(await neighbors.findOne({ _id: X })) && !(await neighbors.findOne({ _id: P })));

    // ---- similar books
    res = await fetch(`${api}/product/${S(X)}/similar`);
    let list = await res.json();
    const ids = list.map((b) => b._id);
    const reasonOf = (id) => list.find((b) => b._id === S(id))?.recommendation?.reason;
    check("bought together comes first, reason TOGETHER", ids[0] === S(Y) && reasonOf(Y) === "TOGETHER", JSON.stringify(list.map((b) => [b.productName, b.recommendation.reason])));
    check("same author is suggested, reason AUTHOR", reasonOf(Z) === "AUTHOR");
    check("paused book, the book itself and cancelled-order links left out", !ids.includes(S(P)) && !ids.includes(S(X)) && !ids.includes(S(W)));
    check("full book data for the cards", list.every((b) => typeof b.productPrice === "number" && b.productStatus === "PROCESS"));
    res = await fetch(`${api}/product/${S(P)}/similar`);
    check("paused book has no similar list (404)", res.status === 404);
    res = await fetch(`${api}/product/not-an-id/similar`);
    check("bad id -> 404", res.status === 404);
    res = await fetch(`${api}/product/${S(X)}/similar?limit=1`);
    check("limit respected", (await res.json()).length === 1);

    // a book added after the rebuild still gets content-based neighbors
    const late = (await products.insertOne(book("Reco Eta", "Reco Author One", "FICTION"))).insertedId;
    res = await fetch(`${api}/product/${S(late)}/similar`);
    list = await res.json();
    check("new book: neighbors on the fly (same author)", res.status === 200 && list.some((b) => b._id === S(X) || b._id === S(Z)), JSON.stringify(list.map((b) => b.productName)));

    // ---- for you
    const forYou = async (query, cookie) => (await fetch(`${api}/product/recommended${query}`, { headers: cookie ? { Cookie: cookie } : {} })).json();
    let reco = await forYou("?limit=8", reader);
    list = reco.items;
    const mine = list.find((b) => b._id === S(Y));
    check("member: from their history", reco.basis === "history", reco.basis);
    check("member: Y recommended because of X", mine?.recommendation?.reason === "BECAUSE" && mine.recommendation.because?._id === S(X), JSON.stringify(mine?.recommendation));
    check("member: already ordered book not recommended", !list.some((b) => b._id === S(X)));

    reco = await forYou(`?seeds=${S(Y)}`);
    list = reco.items;
    check("guest with viewed books: basis seeds, X suggested, Y itself not", reco.basis === "seeds" && list.some((b) => b._id === S(X)) && !list.some((b) => b._id === S(Y)), reco.basis);

    reco = await forYou("?limit=4");
    check("stranger: popular books", reco.basis === "popular" && reco.items.length > 0 && reco.items.length <= 4 && reco.items.every((b) => b.recommendation.reason === "POPULAR"));
    reco = await forYou(`?seeds=abc,123,${"f".repeat(24)}`);
    check("garbage seeds are ignored", reco.basis === "popular");
  } catch (err) {
    check("unexpected error", false, err.stack || String(err));
  } finally {
    const books = await products.find({ productPublisher: PUBLISHER }, { projection: { _id: 1 } }).toArray();
    await neighbors.deleteMany({ _id: { $in: books.map((b) => b._id) } });
    await orderItems.deleteMany({ orderId: { $in: createdOrders } });
    await orders.deleteMany({ _id: { $in: createdOrders } });
    await products.deleteMany({ productPublisher: PUBLISHER });
    await members.deleteMany({ memberNick: { $regex: `^reco_${stamp}_` } });
    await members.updateOne({ _id: library._id }, { $set: { memberPassword: library.memberPassword } });
    await server.stop();
  }
  process.exit(summary());
})();
