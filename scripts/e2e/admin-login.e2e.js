/**
 * End-to-end test of the admin panel login: by email, by username in any
 * letter case, wrong password / unknown login / non-library accounts refused.
 * Only runs against a "*_test" database; restores what it touches.
 *
 * Usage: MONGO_URL=<...>/BookOn_test node scripts/e2e/admin-login.e2e.js
 */
const path = require("path");
const bcrypt = require("bcrypt");
const { startServer, check, summary, requireTestDb } = require("./harness");

const ROOT = path.join(__dirname, "..", "..");

(async () => {
  const db = await requireTestDb();
  const members = db.collection("members");
  const library = await members.findOne({ memberType: "LIBRARY" });
  const email = `library_${Date.now().toString(36)}@example.com`;
  await members.updateOne({ _id: library._id }, { $set: { memberPassword: await bcrypt.hash("login-admin-1", 10), memberEmail: email, memberStatus: "ACTIVE" } });
  const reader = await members.findOne({ memberType: "USER", memberEmail: { $exists: true } });
  const readerHash = reader?.memberPassword;
  if (reader) await members.updateOne({ _id: reader._id }, { $set: { memberPassword: await bcrypt.hash("login-admin-1", 10) } });

  const server = await startServer(ROOT);
  const login = (memberNick, memberPassword) =>
    fetch(`${server.api}/admin/login`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ memberNick, memberPassword }) });
  const ok = async (res) => res.status === 302 && (res.headers.get("set-cookie") || "").includes("connect.sid=");
  const refused = async (res) => res.status === 200 && (await res.text()).includes("parol notoʻgʻri");

  try {
    check("login page asks for email or username", (await (await fetch(`${server.api}/admin/login`)).text()).includes("Email yoki foydalanuvchi nomi"));
    check("by username (exact)", await ok(await login(library.memberNick, "login-admin-1")));
    check("by username, other case", await ok(await login(library.memberNick.toUpperCase(), "login-admin-1")));
    check("by email, mixed case and spaces", await ok(await login(`  ${email.toUpperCase()} `, "login-admin-1")));
    check("wrong password refused", await refused(await login(email, "wrong-password")));
    check("unknown login refused with the same message", await refused(await login("nobody_here_xyz", "login-admin-1")));
    check("regex characters are literal", await refused(await login(".*", "login-admin-1")));
    check("empty password refused", await refused(await login(email, "")));
    if (reader) check("reader account can't open the admin panel", await refused(await login(reader.memberEmail, "login-admin-1")));
  } catch (err) {
    check("unexpected error", false, err.stack || String(err));
  } finally {
    await members.updateOne({ _id: library._id }, { $set: { memberPassword: library.memberPassword, ...(library.memberEmail ? { memberEmail: library.memberEmail } : {}) }, ...(library.memberEmail ? {} : { $unset: { memberEmail: "" } }) });
    if (reader) await members.updateOne({ _id: reader._id }, { $set: { memberPassword: readerHash } });
    await server.stop();
  }
  process.exit(summary());
})();
