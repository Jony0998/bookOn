/**
 * End-to-end test of the admin product form: book fields, validation,
 * mass-assignment protection, shelves, uploads and the public catalog filters.
 * Only runs against a "*_test" database; restores the library password after.
 *
 * Usage: MONGO_URL=<...>/BookOn_test node scripts/e2e/admin-products.e2e.js
 */
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const { startServer, check, summary, requireTestDb } = require("./harness");

const ROOT = path.join(__dirname, "..", "..");
const PASSWORD = "e2e-admin-pass";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

(async () => {
  const db = await requireTestDb();
  const products = db.collection("products");
  const membersCol = db.collection("members");
  const library = await membersCol.findOne({ memberType: "LIBRARY" }, { projection: { memberNick: 1, memberPassword: 1, memberStatus: 1 } });
  if (!library) throw new Error("test DB has no LIBRARY member");
  await membersCol.updateOne({ _id: library._id }, { $set: { memberPassword: await bcrypt.hash(PASSWORD, 10), memberStatus: "ACTIVE" } });

  const server = await startServer(ROOT);
  const { api } = server;
  const createdNames = ["E2E Book", "E2E Book 2"];
  let target;

  try {
    const login = await fetch(`${api}/admin/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ memberNick: library.memberNick, memberPassword: PASSWORD }),
    });
    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
    check("admin login sets session", cookie.startsWith("connect.sid="));
    const admin = (url, init = {}) => fetch(api + url, { ...init, headers: { ...(init.headers || {}), Cookie: cookie } });
    const post = (url, body, auth = true) =>
      (auth ? admin : (u, i) => fetch(api + u, i))(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

    const html = await (await admin("/admin/product/all")).text();
    check("admin products page renders", html.includes("Muallif") && html.includes("edit-product-modal") && html.includes("Bosh sahifadagi javonlar") && html.includes("ad-side"));
    const dash = await admin("/admin");
    const dashHtml = await dash.text();
    check("dashboard renders with stats", dash.status === 200 && dashHtml.includes("Umumiy tushum") && dashHtml.includes("Buyurtmalar oqimi"));
    const ordersPage = await admin("/admin/order/all?status=PAUSE");
    check("orders page renders", ordersPage.status === 200 && (await ordersPage.text()).includes("Buyurtmalar"));
    const anonDash = await fetch(`${api}/admin`, { redirect: "manual" });
    check("dashboard requires login", anonDash.status === 302 && /\/admin\/login/.test(anonDash.headers.get("location") || ""));
    const anonOrders = await fetch(`${api}/admin/order/all`);
    check("orders page requires login", anonOrders.status === 401);

    target = await products.findOne({ productStatus: "PROCESS" });
    const id = String(target._id);
    const full = {
      productName: target.productName, productAuthor: "E2E Author", productPrice: "20", productDiscountPrice: "15",
      productLeftCount: "7", productCollection: target.productCollection, productLanguage: "RU",
      productIsbn: "978-0-13-468599-1", productPublisher: "E2E Pub", productPublishYear: "2020",
      productPages: "320", productDesc: "desc", productViews: "9999", productShelves: ["GROWTH"],
    };
    let res = await post(`/admin/product/${id}`, full);
    let doc = await products.findOne({ _id: target._id });
    check("full edit saves", res.status === 200 && doc.productAuthor === "E2E Author" && doc.productLanguage === "RU" && doc.productPages === 320);
    check("ISBN normalized", doc.productIsbn === "9780134685991", doc.productIsbn);
    check("views not mass-assignable", doc.productViews !== 9999);
    check("shelves saved", JSON.stringify(doc.productShelves) === '["GROWTH"]');

    for (const [name, patch] of [
      ["discount >= price rejected", { productDiscountPrice: "25" }],
      ["bad ISBN rejected", { productIsbn: "12345" }],
      ["clearing author rejected", { productAuthor: "" }],
      ["bad language rejected", { productLanguage: "XX" }],
      ["bad shelf rejected", { productShelves: ["NOPE"] }],
    ]) {
      res = await post(`/admin/product/${id}`, { ...full, ...patch });
      check(name, res.status === 400, `status ${res.status}`);
    }
    res = await post(`/admin/product/${id}`, { productPrice: "10" });
    check("price below existing discount rejected", res.status === 400);

    res = await post(`/admin/product/${id}`, { ...full, productIsbn: "", productDiscountPrice: "", productPages: "", productShelves: [] });
    doc = await products.findOne({ _id: target._id });
    check("clearing optional fields unsets them", res.status === 200 && !("productIsbn" in doc) && !("productDiscountPrice" in doc) && doc.productShelves.length === 0);

    res = await post(`/admin/product/${id}`, { productStatus: "PROCESS", productShelves: ["CLASSIC"] });
    check("partial update keeps other fields", res.status === 200 && (await products.findOne({ _id: target._id })).productAuthor === "E2E Author");
    res = await post(`/admin/product/${id}`, { productStatus: "PAUSE" }, false);
    check("unauthenticated update blocked", res.status === 401, `status ${res.status}`);

    const byAuthor = await (await fetch(`${api}/product/all?search=e2e%20auth&limit=50`)).json();
    check("public search matches author", byAuthor.some((p) => String(p._id) === id));
    const byShelf = await (await fetch(`${api}/product/all?shelf=CLASSIC&limit=50`)).json();
    check("public shelf filter", byShelf.some((p) => String(p._id) === id) && byShelf.every((p) => p.productShelves.includes("CLASSIC")));
    const byLang = await (await fetch(`${api}/product/all?productLanguage=RU&limit=50`)).json();
    check("public language filter", byLang.length > 0 && byLang.every((p) => p.productLanguage === "RU"));

    const uploads = path.join(ROOT, "uploads", "products");
    fs.mkdirSync(uploads, { recursive: true });
    const makeForm = (extra = {}) => {
      const form = new FormData();
      const fields = { productStatus: "PAUSE", productName: "E2E Book", productAuthor: "E2E Writer", productPrice: "12.5", productLeftCount: "3", productCollection: "FICTION", productLanguage: "EN", productDesc: "x", productIsbn: "", productShelves: "", ...extra };
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      form.append("productShelves", "UZBEK_LIT");
      form.append("productImages", new Blob([PNG], { type: "image/png" }), "cover.png");
      return form;
    };
    const before = fs.readdirSync(uploads).length;
    let text = await (await admin("/admin/product/create", { method: "POST", body: makeForm() })).text();
    const created = await products.findOne({ productName: "E2E Book" });
    check("create with book fields + shelves", text.includes("Kitob qoʻshildi") && created?.productPrice === 12.5 && JSON.stringify(created?.productShelves) === '["UZBEK_LIT"]');
    text = await (await admin("/admin/product/create", { method: "POST", body: makeForm() })).text();
    await new Promise((r) => setTimeout(r, 300));
    check("duplicate create rejected", text.includes("already exists"));
    check("rejected upload removed from disk", fs.readdirSync(uploads).length === before + 1);
    text = await (await admin("/admin/product/create", { method: "POST", body: makeForm({ productName: "E2E Book 2", productAuthor: "" }) })).text();
    check("create without author rejected", text.includes("Invalid input"));

    for (const p of created?.productImages || []) fs.rmSync(path.join(ROOT, p), { force: true });
  } finally {
    await products.deleteMany({ productName: { $in: createdNames } });
    if (target) await products.replaceOne({ _id: target._id }, target);
    await membersCol.updateOne({ _id: library._id }, { $set: { memberPassword: library.memberPassword, memberStatus: library.memberStatus } });
    await server.stop();
  }
  process.exitCode = summary();
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
