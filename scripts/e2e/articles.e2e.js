/**
 * End-to-end test of the news/blog feature: admin create/edit/publish/delete,
 * public list/detail/tags, attached books, link-preview page, validation.
 * Only runs against a "*_test" database; removes what it creates.
 *
 * Usage: MONGO_URL=<...>/BookOn_test node scripts/e2e/articles.e2e.js
 */
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const { startServer, check, summary, requireTestDb } = require("./harness");

const ROOT = path.join(__dirname, "..", "..");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

(async () => {
  const db = await requireTestDb();
  const members = db.collection("members");
  const articles = db.collection("articles");
  const products = db.collection("products");
  const library = await members.findOne({ memberType: "LIBRARY" });
  await members.updateOne({ _id: library._id }, { $set: { memberPassword: await bcrypt.hash("news-admin-1", 10), memberStatus: "ACTIVE" } });
  const active = await products.findOne({ productStatus: "PROCESS" });
  const paused = await products.findOne({ productStatus: "PAUSE" });

  const server = await startServer(ROOT);
  const { api } = server;
  const stamp = Date.now().toString(36);
  const title = `Yangi kitoblar ${stamp}: Oʻtkan kunlar`;

  try {
    const login = await fetch(`${api}/admin/login`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ memberNick: library.memberNick, memberPassword: "news-admin-1" }) });
    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
    const admin = (url, init = {}) => fetch(api + url, { redirect: "manual", ...init, headers: { ...(init.headers || {}), Cookie: cookie } });
    const form = (fields, withImage = true) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(fields)) (Array.isArray(v) ? v : [v]).forEach((x) => f.append(k, x));
      if (withImage) f.append("articleImage", new Blob([PNG], { type: "image/png" }), "cover.png");
      return f;
    };
    const body = "Bu oy doʻkonimizga yangi kitoblar keldi.\n\n## Klassika\n\n> Kitob — eng yaxshi sovgʻa.\n\n- Oʻtkan kunlar\n- Shum bola";

    // ---- admin pages need a session
    let res = await fetch(`${api}/admin/article/all`);
    check("admin list requires login", res.status === 401);
    res = await fetch(`${api}/admin/article/create`, { method: "POST", body: form({ articleTitle: title, articleBody: body }) });
    check("admin create requires login", res.status === 401);

    // ---- validation
    res = await admin("/admin/article/create", { method: "POST", body: form({ articleTitle: "ab", articleBody: body }, false) });
    check("short title rejected", (await res.text()).includes("Saqlab boʻlmadi") && !(await articles.findOne({ articleTitle: "ab" })));
    res = await admin("/admin/article/create", { method: "POST", body: form({ articleTitle: `${title} x`, articleBody: body, articleTags: "a1,b2,c3,d4,e5,f6,g7" }, false) });
    check("more than 6 tags rejected", (await res.text()).includes("Saqlab boʻlmadi"));
    res = await admin("/admin/article/create", { method: "POST", body: form({ articleTitle: `${title} y`, articleBody: body, articleProducts: ["not-an-id"] }, false) });
    check("bad book id rejected", (await res.text()).includes("Saqlab boʻlmadi"));

    // ---- create as draft
    res = await admin("/admin/article/create", {
      method: "POST",
      body: form({ articleTitle: title, articleBody: body, articleTags: "Yangi kitoblar, #Klassika", articleLanguage: "UZ", articleProducts: ["", String(active._id), String(paused._id)], intent: "draft" }),
    });
    let doc = await articles.findOne({ articleTitle: title });
    check("draft created and redirected to edit", res.status === 302 && /\/admin\/article\/.+\/edit\?saved=1/.test(res.headers.get("location") || "") && doc?.articleStatus === "DRAFT");
    check("slug transliterated", /^yangi-kitoblar-[a-z0-9]+-otkan-kunlar-[0-9a-f]{4}$/.test(doc.articleSlug), doc.articleSlug);
    check("tags normalised", JSON.stringify(doc.articleTags) === '["yangi kitoblar","klassika"]', JSON.stringify(doc.articleTags));
    check("excerpt auto-filled from body", doc.articleExcerpt.startsWith("Bu oy doʻkonimizga"));
    check("cover saved to uploads/articles", /^uploads\/articles\//.test(doc.articleImage) && fs.existsSync(path.join(ROOT, doc.articleImage)));
    res = await fetch(`${api}/article/${doc.articleSlug}`);
    check("draft is not public", res.status === 404);
    let list = await (await fetch(`${api}/article/all?limit=24`)).json();
    check("draft not listed", !list.some((x) => x.articleSlug === doc.articleSlug));
    const editHtml = await (await admin(`/admin/article/${doc._id}/edit?saved=1`)).text();
    check("edit page renders with saved notice", editHtml.includes("Saqlandi") && editHtml.includes(title));

    // ---- publish
    res = await admin(`/admin/article/${doc._id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ articleStatus: "PUBLISHED" }) });
    doc = await articles.findOne({ _id: doc._id });
    check("publish sets publishedAt", res.status === 200 && doc.articleStatus === "PUBLISHED" && !!doc.publishedAt);
    list = await (await fetch(`${api}/article/all?limit=24`)).json();
    const card = list.find((x) => x.articleSlug === doc.articleSlug);
    check("listed without the body", !!card && !("articleBody" in card));
    const byTag = await (await fetch(`${api}/article/all?tag=klassika`)).json();
    check("tag filter", byTag.some((x) => x.articleSlug === doc.articleSlug));
    const tags = await (await fetch(`${api}/article/tags`)).json();
    check("tags endpoint", tags.some((x) => x.tag === "klassika"));
    res = await fetch(`${api}/article/${doc.articleSlug}`);
    const detail = await res.json();
    check("article detail", res.status === 200 && detail.articleBody === body);
    check("only active books attached publicly", detail.books.length === 1 && String(detail.books[0]._id) === String(active._id));
    check("views counted", (await articles.findOne({ _id: doc._id })).articleViews === 1);

    // ---- link preview page, with HTML in the title escaped
    await articles.updateOne({ _id: doc._id }, { $set: { articleTitle: `${title} <script>alert(1)</script>` } });
    res = await fetch(`${api}/og/news/${doc.articleSlug}`);
    const og = await res.text();
    check("preview page has og tags", res.status === 200 && og.includes('property="og:title"') && og.includes("/uploads/articles/") && og.includes(`/news/${doc.articleSlug}`));
    check("preview page escapes HTML", !og.includes("<script>alert(1)") && og.includes("&lt;script&gt;"));
    check("preview does not count views", (await articles.findOne({ _id: doc._id })).articleViews === 1);
    res = await fetch(`${api}/og/news/no-such-article-zz`, { redirect: "manual" });
    check("unknown preview redirects to /news", res.status === 302 && /\/news$/.test(res.headers.get("location") || ""));

    // ---- update replaces the cover and deletes the old file
    const oldImage = doc.articleImage;
    res = await admin(`/admin/article/${doc._id}`, { method: "POST", body: form({ articleTitle: `${title} v2`, articleBody: body, articleTags: "aksiya" }) });
    doc = await articles.findOne({ _id: doc._id });
    await new Promise((r) => setTimeout(r, 300));
    check("update saves fields and keeps status", res.status === 302 && doc.articleTitle.endsWith("v2") && doc.articleStatus === "PUBLISHED");
    check("new cover replaces the old file", doc.articleImage !== oldImage && !fs.existsSync(path.join(ROOT, oldImage)) && fs.existsSync(path.join(ROOT, doc.articleImage)));
    check("slug stays stable after retitle", /otkan-kunlar/.test(doc.articleSlug));

    // ---- delete
    const image = doc.articleImage;
    res = await admin(`/admin/article/${doc._id}/delete`, { method: "POST" });
    await new Promise((r) => setTimeout(r, 300));
    check("delete removes article and cover", res.status === 200 && !(await articles.findOne({ _id: doc._id })) && !fs.existsSync(path.join(ROOT, image)));
  } finally {
    const leftovers = await articles.find({ articleTitle: { $regex: stamp } }).toArray();
    for (const a of leftovers) if (a.articleImage) fs.rmSync(path.join(ROOT, a.articleImage), { force: true });
    await articles.deleteMany({ articleTitle: { $regex: stamp } });
    await members.updateOne({ _id: library._id }, { $set: { memberPassword: library.memberPassword, memberStatus: library.memberStatus } });
    await server.stop();
  }
  process.exitCode = summary();
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
