import nodemailer, { Transporter } from "nodemailer";

/**
 * Transactional email over SMTP (any provider: Resend, Gmail, Mailgun, ...).
 * Env: SMTP_HOST, SMTP_PORT (465 = TLS), SMTP_USER, SMTP_PASS, MAIL_FROM,
 * PUBLIC_URL (site origin used in links, e.g. https://bookon.sale).
 * Shortcut: RESEND_API_KEY alone means Resend's SMTP (smtp.resend.com).
 * With neither, nothing is sent; in development the link is logged instead.
 * MAIL_DISABLED=1 turns sending off whatever else is set (local runs, tests).
 */
// Resend verifies the mail.bookon.sale subdomain (not the bare domain); MAIL_FROM overrides
const DEFAULT_FROM = "BookOn <no-reply@mail.bookon.sale>";

const smtpSettings = () => {
  // Local runs and tests: never send, even when .env holds a real key
  if (process.env.MAIL_DISABLED === "1") return null;
  if (process.env.SMTP_HOST)
    return {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 465,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    };
  if (process.env.RESEND_API_KEY)
    return { host: "smtp.resend.com", port: 465, user: "resend", pass: process.env.RESEND_API_KEY };
  return null;
};
export type MailLang = "uz" | "ru" | "en";
export type MailKind = "verify" | "reset" | "reply";

const isProduction = process.env.NODE_ENV === "production";
let transporter: Transporter | null | undefined;

const getTransporter = (): Transporter | null => {
  if (transporter !== undefined) return transporter;
  const smtp = smtpSettings();
  if (!smtp) {
    transporter = null;
    return null;
  }
  transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  return transporter;
};

export const mailConfigured = () => !!smtpSettings();

export const publicUrl = () => (process.env.PUBLIC_URL || "http://localhost:3000").replace(/\/+$/, "");

export const toMailLang = (value: unknown): MailLang => (value === "ru" || value === "en" ? value : "uz");

const COPY: Record<MailKind, Record<MailLang, { subject: string; title: string; body: string; button: string; note: string }>> = {
  verify: {
    uz: { subject: "BookOn: emailingizni tasdiqlang", title: "Xush kelibsiz, {{nick}}!", body: "BookOn hisobingizni faollashtirish uchun email manzilingizni tasdiqlang.", button: "Emailni tasdiqlash", note: "Havola 48 soat amal qiladi. Agar siz roʻyxatdan oʻtmagan boʻlsangiz, bu xatni eʼtiborsiz qoldiring." },
    ru: { subject: "BookOn: подтвердите email", title: "Добро пожаловать, {{nick}}!", body: "Подтвердите адрес электронной почты, чтобы активировать аккаунт BookOn.", button: "Подтвердить email", note: "Ссылка действует 48 часов. Если вы не регистрировались, просто проигнорируйте это письмо." },
    en: { subject: "BookOn: confirm your email", title: "Welcome, {{nick}}!", body: "Please confirm your email address to activate your BookOn account.", button: "Confirm email", note: "The link is valid for 48 hours. If you didn't sign up, just ignore this email." },
  },
  reset: {
    uz: { subject: "BookOn: parolni tiklash", title: "Salom, {{nick}}!", body: "Parolni tiklash soʻrovi oldik. Yangi parol oʻrnatish uchun tugmani bosing.", button: "Yangi parol oʻrnatish", note: "Havola 1 soat amal qiladi. Agar soʻrovni siz yubormagan boʻlsangiz, bu xatni eʼtiborsiz qoldiring — parolingiz oʻzgarmaydi." },
    ru: { subject: "BookOn: восстановление пароля", title: "Здравствуйте, {{nick}}!", body: "Мы получили запрос на сброс пароля. Нажмите кнопку, чтобы задать новый пароль.", button: "Задать новый пароль", note: "Ссылка действует 1 час. Если вы не запрашивали сброс, проигнорируйте письмо — пароль не изменится." },
    en: { subject: "BookOn: reset your password", title: "Hi {{nick}}!", body: "We received a request to reset your password. Press the button to set a new one.", button: "Set a new password", note: "The link is valid for 1 hour. If you didn't ask for this, ignore this email — your password stays the same." },
  },
  reply: {
    uz: { subject: "BookOn: murojaatingizga javob", title: "Salom, {{nick}}!", body: "BookOn kutubxonasi murojaatingizga javob berdi:", button: "Yozishmani ochish", note: "Javob yozish uchun tugmani bosing. Bu havola faqat sizga tegishli — uni boshqalarga bermang." },
    ru: { subject: "BookOn: ответ на ваше обращение", title: "Здравствуйте, {{nick}}!", body: "Библиотека BookOn ответила на ваше обращение:", button: "Открыть переписку", note: "Нажмите кнопку, чтобы ответить. Эта ссылка только для вас — не передавайте её другим." },
    en: { subject: "BookOn: a reply to your message", title: "Hi {{nick}}!", body: "The BookOn library replied to your message:", button: "Open the conversation", note: "Press the button to reply. This link is only for you — please don't share it." },
  },
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

const render = (kind: MailKind, lang: MailLang, nick: string, link: string, quote?: string) => {
  const c = COPY[kind][lang];
  const title = c.title.replace("{{nick}}", nick);
  const quoteHtml = quote
    ? `<tr><td style="padding-top:16px"><div style="background:#f5efe3;border-left:4px solid #0e7c86;border-radius:12px;padding:16px 18px;font-size:15px;line-height:1.6;white-space:pre-line">${escapeHtml(quote)}</div></td></tr>`
    : "";
  const html = `<!doctype html><html lang="${lang}"><body style="margin:0;background:#fbf7ef;font-family:Arial,Helvetica,sans-serif;color:#1c1a27">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e6ddcb;border-radius:20px;padding:32px">
<tr><td style="font-family:Georgia,serif;font-size:26px;font-weight:bold">Book<span style="color:#0e7c86">On</span></td></tr>
<tr><td style="padding-top:24px;font-family:Georgia,serif;font-size:22px">${escapeHtml(title)}</td></tr>
<tr><td style="padding-top:12px;font-size:16px;line-height:1.6;color:#5b5566">${escapeHtml(c.body)}</td></tr>
${quoteHtml}
<tr><td style="padding-top:24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#0e7c86;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 26px;border-radius:999px">${escapeHtml(c.button)}</a></td></tr>
<tr><td style="padding-top:20px;font-size:13px;line-height:1.6;color:#5b5566">${escapeHtml(c.note)}<br><br><a href="${escapeHtml(link)}" style="color:#0e7c86;word-break:break-all">${escapeHtml(link)}</a></td></tr>
</table></td></tr></table></body></html>`;
  const text = `${title}\n\n${c.body}\n\n${quote ? `${quote}\n\n` : ""}${c.button}: ${link}\n\n${c.note}`;
  return { subject: c.subject, html, text };
};

/** Sends (or, without SMTP in development, logs) a verify/reset/reply email. Never throws. */
export const sendAuthMail = async (kind: MailKind, to: string, nick: string, link: string, lang: MailLang, quote?: string): Promise<boolean> => {
  const mail = render(kind, lang, nick, link, quote);
  const transport = getTransporter();
  if (!transport) {
    if (isProduction) console.warn(`[mail] SMTP not configured, ${kind} email to ${to} not sent`);
    else console.info(`[mail] (dev, not sent) ${kind} -> ${to}: ${link}`);
    return false;
  }
  try {
    await transport.sendMail({
      from: process.env.MAIL_FROM || DEFAULT_FROM,
      to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    return true;
  } catch (err: any) {
    console.error(`[mail] ${kind} email to ${to} failed:`, err?.message || err);
    return false;
  }
};
