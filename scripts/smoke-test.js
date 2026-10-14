/**
 * Production-safe smoke test (read-only, creates no data).
 * Usage: node scripts/smoke-test.js http://bookon.sale
 */
const BASE = (process.argv[2] || process.env.BASE || "http://localhost:3003").replace(/\/+$/, "");
let failed = 0;

const check = (name, ok, info = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  -> " + info : ""}`);
  if (!ok) failed++;
};

const request = async (method, path) => {
  const res = await fetch(BASE + path, { method, redirect: "manual" });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, headers: res.headers };
};

(async () => {
  console.log(`Smoke test: ${BASE}\n`);

  let r = await request("GET", "/member/library");
  check("GET /member/library 200", r.status === 200, r.status);
  check("library has no password", r.json && r.json.memberPassword === undefined);

  r = await request("GET", "/product/all?page=1&limit=4&order=createdAt");
  check("GET /product/all 200", r.status === 200 && Array.isArray(r.json), r.status);

  r = await request("GET", "/product/all");
  check("GET /product/all without params 200", r.status === 200, r.status);

  r = await request("GET", "/product/all?search=" + encodeURIComponent("(a+)+$["));
  check("regex characters in search do not crash", r.status === 200, r.status);

  r = await request("GET", "/member/top-users");
  check("GET /member/top-users 200", r.status === 200 && Array.isArray(r.json), r.status);
  check("top users hide phone and address",
    Array.isArray(r.json) && r.json.every((m) => m.memberPhone === undefined && m.memberAddress === undefined));

  r = await request("GET", "/member/detail");
  check("GET /member/detail without cookie 401", r.status === 401, r.status);

  r = await request("POST", "/member/logout");
  check("POST /member/logout without cookie 200", r.status === 200, r.status);

  r = await request("GET", "/product/not-an-id");
  check("invalid product id 400", r.status === 400, r.status);

  r = await request("GET", "/admin/product/all");
  check("admin page without session 401", r.status === 401, r.status);

  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("Smoke test crashed:", e.message);
  process.exit(2);
});
