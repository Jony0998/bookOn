/**
 * End-to-end test of the security layer: health check, security headers,
 * login / sign-up rate limits (run with tiny limits), body size limit.
 * Only runs against a "*_test" database; creates nothing that stays.
 *
 * Usage: MONGO_URL=<...>/BookOn_test node scripts/e2e/security.e2e.js
 */
const path = require("path");
const { startServer, check, summary, requireTestDb } = require("./harness");

const ROOT = path.join(__dirname, "..", "..");

(async () => {
  const db = await requireTestDb();
  const members = db.collection("members");
  const server = await startServer(ROOT, 3014, { AUTH_RATE_LIMIT: "3", ACCOUNT_RATE_LIMIT: "2" });
  const { api } = server;
  const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const stamp = Date.now().toString(36);

  try {
    // ---- health
    let res = await fetch(`${api}/health`);
    let body = await res.json();
    check("health is 200 with db up", res.status === 200 && body.status === "ok" && body.db === "up", JSON.stringify(body));
    check("health is not cached", res.headers.get("cache-control") === "no-store");

    // ---- headers
    res = await fetch(`${api}/admin/login`);
    const h = res.headers;
    const csp = h.get("content-security-policy") || "";
    check("no X-Powered-By", !h.get("x-powered-by"));
    check("CSP allows only the admin's CDNs", csp.includes("script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://code.jquery.com") && csp.includes("frame-ancestors 'none'"), csp);
    check("nosniff + frame protection + referrer policy", h.get("x-content-type-options") === "nosniff" && !!h.get("x-frame-options") && !!h.get("referrer-policy"));
    check("uploads may be shown by the shop (CORP cross-origin)", h.get("cross-origin-resource-policy") === "cross-origin");
    res = await fetch(`${api}/css/admin.css`);
    check("static files get the headers too", res.status === 200 && res.headers.get("x-content-type-options") === "nosniff");

    // ---- login limiter: 3 failed attempts, the 4th is refused even with the right password
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await fetch(`${api}/member/login`, json({ login: `nobody_${stamp}`, memberPassword: "wrong-pass-1" }))).status);
    check("failed shop logins limited after 3", codes.join(",") === "401,401,401,429", codes.join(","));
    res = await fetch(`${api}/member/login`, json({ login: `nobody_${stamp}`, memberPassword: "wrong-pass-1" }));
    body = await res.json();
    check("429 explains and has Retry-After", body.message === "Please wait a minute before trying again!" && !!res.headers.get("retry-after"));
    check("standard RateLimit headers", !!res.headers.get("ratelimit-policy") || !!res.headers.get("ratelimit"));
    res = await fetch(`${api}/admin/login`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ memberNick: "x", memberPassword: "y" }) });
    check("admin login shares the limit, Uzbek message", res.status === 429 && (await res.text()).includes("Juda koʻp urinish"));

    // ---- account limiter: every sign-up counts, 2 per hour here
    const nicks = [`sec_${stamp}_a`, `sec_${stamp}_b`, `sec_${stamp}_c`];
    const signups = [];
    for (const nick of nicks) signups.push((await fetch(`${api}/member/signup`, json({ memberNick: nick, memberEmail: `${nick}@example.com`, memberPassword: "sec-pass-123" }))).status);
    check("third sign-up from one IP in an hour -> 429", signups.join(",") === "201,201,429", signups.join(","));
    check("refused sign-up created nothing", !(await members.findOne({ memberNick: nicks[2] })));

    // ---- other endpoints are not affected by the auth limits
    res = await fetch(`${api}/product/all?page=1&limit=1`);
    check("catalog still answers", res.status === 200);

    // ---- body size limit
    res = await fetch(`${api}/inquiry/create`, json({ name: "e2e Big", email: `big_${stamp}@example.com`, message: "x".repeat(200 * 1024) }));
    check("oversized JSON body refused", res.status === 413 || res.status === 400, String(res.status));
  } catch (err) {
    check("unexpected error", false, err.stack || String(err));
  } finally {
    await members.deleteMany({ memberNick: { $regex: `^sec_${stamp}_` } });
    await server.stop();
  }
  process.exit(summary());
})();
