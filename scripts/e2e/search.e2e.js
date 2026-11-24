/**
 * End-to-end test of book search: Uzbek text rules (Latin/Cyrillic, apostrophe
 * variants), filters, suggestions, safety — and, when Atlas Search is ready,
 * typo tolerance and relevance. Works on plain MongoDB too (fallback engine).
 * Only runs against a "*_test" database; removes the books it adds.
 *
 * Usage: MONGO_URL=<...>/BookOn_test node scripts/e2e/search.e2e.js
 */
const path = require("path");
const { startServer, check, summary, requireTestDb } = require("./harness");

const ROOT = path.join(__dirname, "..", "..");
const PUBLISHER = "E2E Search Press";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// text rules, straight from the TypeScript source
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs" } });
const text = require(path.join(ROOT, "src", "libs", "search", "text.ts"));

(async () => {
  // ---- pure text rules (no server needed)
  check("normalize: apostrophes, spaces, case", text.normalizeQuery("  Oʻtkan   KUNLAR ") === "o'tkan kunlar");
  check("Cyrillic -> Latin", text.toLatin("ўткан кунлар") === "o'tkan kunlar" && text.toLatin("ер юзи") === "yer yuzi", text.toLatin("ўткан кунлар"));
  check("Latin -> Cyrillic (digraphs first)", text.toCyrillic("o'tkan kunlar") === "ўткан кунлар" && text.toCyrillic("shum bola") === "шум бола", text.toCyrillic("shum bola"));
  check("variants: both scripts, no apostrophes", JSON.stringify(text.queryVariants("Oʻtkan kunlar")) === JSON.stringify(["otkan kunlar", "ўткан кунлар"]), JSON.stringify(text.queryVariants("Oʻtkan kunlar")));
  check("fallback regex ignores apostrophes", text.apostropheInsensitiveRegex("otkan").test("Oʻtkan kunlar") && !text.apostropheInsensitiveRegex("otkan").test("Ota"));
  check("regex input is escaped", text.apostropheInsensitiveRegex("(.*").test("a(.*b") && !text.apostropheInsensitiveRegex("(.*").test("abc"));

  const db = await requireTestDb();
  const products = db.collection("products");
  await products.deleteMany({ productPublisher: PUBLISHER });
  const now = new Date();
  const book = (productName, productAuthor, extra = {}) => ({
    productStatus: "PROCESS", productCollection: "FICTION", productName, productAuthor, productPrice: 10, productLeftCount: 5,
    productLanguage: "UZ", productShelves: [], productImages: [], productViews: 0, productLikes: 0, productPublisher: PUBLISHER,
    productDesc: "E2E search test book.", createdAt: now, updatedAt: now, ...extra,
  });
  const ins = await products.insertMany([
    book("Qorakoʻl hikoyalari", "Gʻayrat Zamonov", { productViews: 5 }),
    book("Ёзги шамол", "Шавкат Рустамов", { productLanguage: "RU" }),
    book("Qorakoʻl sirlari", "Gʻayrat Zamonov", { productStatus: "PAUSE" }),
    book("Tungi bogʻ", "Nodira Xolmatova", { productDesc: "Qorakoʻl qishlogʻidagi bir oila haqida." }),
  ]);
  const [A, B, C, D] = Object.values(ins.insertedIds).map(String);

  const server = await startServer(ROOT, 3015);
  const { api } = server;
  const search = async (q, extra = "") => {
    const res = await fetch(`${api}/product/all?page=1&limit=20&search=${encodeURIComponent(q)}${extra}`);
    return { status: res.status, engine: res.headers.get("x-search-engine"), ids: res.status === 200 ? (await res.json()).map((p) => p._id) : [] };
  };
  const suggest = async (q) => {
    const res = await fetch(`${api}/product/suggest?q=${encodeURIComponent(q)}`);
    return { status: res.status, engine: res.headers.get("x-search-engine"), items: res.status === 200 ? await res.json() : [] };
  };

  try {
    // Atlas indexes new documents within seconds; plain MongoDB never reports "atlas"
    // Atlas Search picks up new documents a few seconds after insert: wait until
    // the index answers AND already contains this run's books
    let engine = "fallback";
    for (let i = 0; i < 40; i++) {
      const r = await search("qorakol hikoyalari");
      engine = r.engine;
      if (engine === "atlas" && r.ids.includes(A)) break;
      if (process.env.SEARCH_ENGINE === "fallback") break;
      if (i >= 5 && engine === "fallback" && !/ready|building/.test(server.log())) break; // no Atlas Search here
      await sleep(3000);
    }
    console.log(`      engine: ${engine}`);
    check("search reports its engine", engine === "atlas" || engine === "fallback");

    // ---- both engines
    let r = await search("qorakol");
    check("no apostrophe finds Qorakoʻl, paused book hidden", r.ids.includes(A) && !r.ids.includes(C), JSON.stringify(r.ids));
    r = await search("Qorako'l hikoyalari");
    check("ASCII apostrophe finds it", r.ids.includes(A));
    r = await search("қоракўл");
    check("Cyrillic query finds a Latin title", r.ids.includes(A), JSON.stringify(r.ids));
    r = await search("yozgi shamol");
    check("Latin query finds a Cyrillic title", r.ids.includes(B), JSON.stringify(r.ids));
    r = await search("Рустамов");
    check("author search (Cyrillic)", r.ids.includes(B));
    r = await search("gayrat zamonov");
    check("author search without apostrophe", r.ids.includes(A));
    r = await search("qorakol", "&productLanguage=RU");
    check("filters still apply", !r.ids.includes(A));
    r = await search("(.*[");
    check("regex characters are harmless", r.status === 200);
    r = await search("qorakol", "&order=productPrice");
    check("explicit order is accepted", r.status === 200 && r.ids.includes(A));

    let s = await suggest("qorak");
    check("suggest: prefix finds the book", s.status === 200 && s.items.some((p) => p._id === A), JSON.stringify(s.items.map((p) => p.productName)));
    check("suggest: small payload (no description), max 6", s.items.length <= 6 && s.items.every((p) => !("productDesc" in p) && Array.isArray(p.productImages) && p.productImages.length <= 1));
    s = await suggest("q");
    check("suggest: 1 letter -> nothing", s.status === 200 && s.items.length === 0);
    const res = await fetch(`${api}/product/all?page=1&limit=3`);
    check("catalog without search unchanged", res.status === 200 && !res.headers.get("x-search-engine"));

    // ---- Atlas Search only: typos and ranking
    if (engine === "atlas") {
      r = await search("qorakol hikoyalri");
      check("typo tolerated (hikoyalri)", r.ids.includes(A), JSON.stringify(r.ids));
      r = await search("zamanov");
      check("typo in author tolerated (zamanov)", r.ids.includes(A));
      r = await search("qorakol");
      check("title match ranks above description match", r.ids.indexOf(A) !== -1 && (r.ids.indexOf(D) === -1 || r.ids.indexOf(A) < r.ids.indexOf(D)), JSON.stringify(r.ids));
      s = await suggest("ёзги ша");
      check("suggest across scripts", s.items.some((p) => p._id === B));
    } else {
      console.log("      (Atlas Search not available here: typo/ranking checks skipped)");
    }
  } catch (err) {
    check("unexpected error", false, err.stack || String(err));
  } finally {
    await products.deleteMany({ productPublisher: PUBLISHER });
    await server.stop();
  }
  process.exit(summary());
})();
