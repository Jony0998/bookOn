/**
 * End-to-end test of email signup, login, verification and password reset.
 * Starts its own server; only runs against a database whose name ends in "_test".
 *
 * Usage: MONGO_URL=<...>/BookOn_test node scripts/e2e/auth.e2e.js
 * Without SMTP the dev server logs the emailed links, which this test reads.
 */
const path = require("path");
const { startServer, check, summary, requireTestDb } = require("./harness");

const ROOT = path.join(__dirname, "..", "..");

(async () => {
  const db = await requireTestDb();
  const members = db.collection("members");
  const stamp = Date.now().toString(36);
  const nick = `e2e_${stamp}`;
  const email = `e2e.${stamp}@example.com`;
  const server = await startServer(ROOT);
  const { api } = server;
  const json = (body, cookie) => ({
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  const linkFromLog = async (kind) => {
    for (let i = 0; i < 20; i++) {
      const match = [...server.log().matchAll(new RegExp(`\\[mail\\] \\(dev, not sent\\) ${kind} -> \\S+: (\\S+)`, "g"))].pop();
      if (match) return new URL(match[1]).searchParams.get("token");
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  };

  try {
    // ---- signup validation
    let res = await fetch(`${api}/member/signup`, json({ memberNick: nick, memberEmail: "not-an-email", memberPassword: "longenough1" }));
    check("signup rejects bad email", res.status === 400);
    res = await fetch(`${api}/member/signup`, json({ memberNick: nick, memberEmail: email, memberPassword: "short" }));
    check("signup rejects short password", res.status === 400);
    res = await fetch(`${api}/member/signup`, json({ memberNick: "a b", memberEmail: email, memberPassword: "longenough1" }));
    check("signup rejects bad username", res.status === 400);

    // ---- signup
    res = await fetch(`${api}/member/signup`, json({ memberNick: nick, memberEmail: email.toUpperCase(), memberPassword: "longenough1", memberEmailVerified: true, memberPoints: 999, lang: "ru" }));
    let body = await res.json();
    const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
    check("signup succeeds without phone", res.status === 201 && !!cookie, `status ${res.status}`);
    check("email stored lowercase", body.member?.memberEmail === email);
    check("client cannot pre-verify or add points", body.member?.memberEmailVerified === false && body.member?.memberPoints === 0);
    check("password never returned", !("memberPassword" in body.member) || !body.member.memberPassword);

    res = await fetch(`${api}/member/signup`, json({ memberNick: `${nick}x`, memberEmail: email, memberPassword: "longenough1" }));
    body = await res.json();
    check("duplicate email -> clear message", res.status === 400 && /email/i.test(body.message), body.message);
    res = await fetch(`${api}/member/signup`, json({ memberNick: nick, memberEmail: `x${email}`, memberPassword: "longenough1" }));
    body = await res.json();
    check("duplicate username -> clear message", res.status === 400 && /username/i.test(body.message), body.message);

    // ---- verification
    const verifyToken = await linkFromLog("verify");
    check("verification link generated", !!verifyToken);
    res = await fetch(`${api}/member/resend-verification`, json({}, cookie));
    check("resend within a minute is throttled", res.status === 429, `status ${res.status}`);
    res = await fetch(`${api}/member/verify-email`, json({ token: "x".repeat(43) }));
    check("bogus verify token rejected", res.status === 400);
    res = await fetch(`${api}/member/verify-email`, json({ token: verifyToken }));
    check("verify email", res.status === 200);
    res = await fetch(`${api}/member/verify-email`, json({ token: verifyToken }));
    check("verify token is single-use", res.status === 400);
    check("member marked verified", (await members.findOne({ memberNick: nick })).memberEmailVerified === true);

    // ---- login
    res = await fetch(`${api}/member/login`, json({ login: email.toUpperCase(), memberPassword: "longenough1" }));
    check("login by email (any case)", res.status === 200);
    res = await fetch(`${api}/member/login`, json({ login: nick, memberPassword: "longenough1" }));
    check("login by username", res.status === 200);
    res = await fetch(`${api}/member/login`, json({ memberNick: nick, memberPassword: "longenough1" }));
    check("old clients (memberNick) still log in", res.status === 200);
    res = await fetch(`${api}/member/login`, json({ login: email, memberPassword: "wrong-password" }));
    const wrongPass = await res.json();
    res = await fetch(`${api}/member/login`, json({ login: `nobody.${stamp}@example.com`, memberPassword: "wrong-password" }));
    const noUser = await res.json();
    check("same error for unknown user and wrong password", res.status === 401 && wrongPass.message === noUser.message);
    res = await fetch(`${api}/member/login`, json({ login: { $ne: null }, memberPassword: { $ne: null } }));
    check("operator injection does not log in", res.status === 401);

    // ---- forgot / reset
    res = await fetch(`${api}/member/forgot-password`, json({ memberEmail: `nobody.${stamp}@example.com` }));
    check("forgot: unknown email gets same answer", res.status === 200 && (await res.json()).sent === true);
    res = await fetch(`${api}/member/forgot-password`, json({ memberEmail: email, lang: "en" }));
    check("forgot: known email", res.status === 200);
    const resetToken = await linkFromLog("reset");
    check("reset link generated", !!resetToken);
    res = await fetch(`${api}/member/reset-password`, json({ token: resetToken, memberPassword: "short" }));
    check("reset rejects weak password (token kept)", res.status === 400);
    res = await fetch(`${api}/member/reset-password`, json({ token: resetToken, memberPassword: "brand-new-pass" }));
    check("reset password", res.status === 200);
    res = await fetch(`${api}/member/reset-password`, json({ token: resetToken, memberPassword: "another-pass-1" }));
    check("reset token is single-use", res.status === 400);
    res = await fetch(`${api}/member/login`, json({ login: email, memberPassword: "longenough1" }));
    check("old password no longer works", res.status === 401);
    res = await fetch(`${api}/member/login`, json({ login: email, memberPassword: "brand-new-pass" }));
    check("new password works", res.status === 200);

    // ---- profile email change
    const newEmail = `e2e.changed.${stamp}@example.com`;
    const form = new FormData();
    form.append("memberNick", nick);
    form.append("memberEmail", newEmail);
    form.append("memberPhone", "");
    res = await fetch(`${api}/member/update`, { method: "POST", headers: { Cookie: cookie }, body: form });
    body = await res.json();
    check("changing email resets verification", res.status === 200 && body.memberEmail === newEmail && body.memberEmailVerified === false, `status ${res.status}`);
    check("empty phone is removed, not stored", !("memberPhone" in body));

    // ---- regression: an old free-text phone ("Jony") must not block saving other fields
    await members.updateOne({ memberNick: nick }, { $set: { memberPhone: `legacy ${stamp}` } });
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const legacy = new FormData();
    legacy.append("memberNick", nick);
    legacy.append("memberPhone", `legacy ${stamp}`);
    legacy.append("memberDesc", "Kitobsevar");
    legacy.append("memberImage", new Blob([png], { type: "image/png" }), "me.png");
    res = await fetch(`${api}/member/update`, { method: "POST", headers: { Cookie: cookie }, body: legacy });
    body = await res.json();
    const saved = await members.findOne({ memberNick: nick });
    check("legacy phone does not block saving desc + photo", res.status === 200 && saved.memberDesc === "Kitobsevar" && /^uploads\/members\//.test(saved.memberImage || ""), `status ${res.status}`);
    const fsMod = require("fs");
    check("uploaded photo is on disk", !!saved.memberImage && fsMod.existsSync(path.join(ROOT, saved.memberImage)));
    const badPhone = new FormData();
    badPhone.append("memberNick", nick);
    badPhone.append("memberPhone", "12ab");
    res = await fetch(`${api}/member/update`, { method: "POST", headers: { Cookie: cookie }, body: badPhone });
    body = await res.json();
    check("changing to a bad phone gives a phone-specific error", res.status === 400 && /phone/i.test(body.message), body.message);
    if (saved.memberImage) fsMod.rmSync(path.join(ROOT, saved.memberImage), { force: true });

    // ---- change password while signed in
    res = await fetch(`${api}/member/change-password`, json({ currentPassword: "wrong-one", newPassword: "changed-pass-1" }, cookie));
    check("change password needs the current one", res.status === 400);
    res = await fetch(`${api}/member/change-password`, json({ currentPassword: "brand-new-pass", newPassword: "short" }, cookie));
    check("change password rejects weak new one", res.status === 400);
    res = await fetch(`${api}/member/change-password`, json({ currentPassword: "brand-new-pass", newPassword: "changed-pass-1" }));
    check("change password needs login", res.status === 401);
    res = await fetch(`${api}/member/change-password`, json({ currentPassword: "brand-new-pass", newPassword: "changed-pass-1" }, cookie));
    check("change password", res.status === 200);
    res = await fetch(`${api}/member/login`, json({ login: nick, memberPassword: "changed-pass-1" }));
    check("login with changed password", res.status === 200);

    // ---- public endpoints never leak emails
    const library = await (await fetch(`${api}/member/library`)).json();
    const top = await (await fetch(`${api}/member/top-users`)).json();
    check("library card has no email/status", !("memberEmail" in library) && !("memberStatus" in library));
    check("top users have no email", top.every((m) => !("memberEmail" in m)));
  } finally {
    await members.deleteMany({ memberNick: { $in: [nick, `${nick}x`] } });
    await server.stop();
  }
  process.exitCode = summary();
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
