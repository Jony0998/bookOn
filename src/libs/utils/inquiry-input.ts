import Errors, { HttpCode, Message } from "../types/Errors";
import { InquiryTopic } from "../../schema/Inquiry.model";
import { MailLang, toMailLang } from "./mailer";
import { normalizeEmail, normalizePhone } from "./member-input";

export const MESSAGE_MIN = 5;
export const MESSAGE_MAX = 2000;

export interface InquiryInput {
  name: string;
  email?: string;
  phone?: string;
  topic: InquiryTopic;
  orderId?: string;
  message: string;
  lang: MailLang;
}

const str = (value: unknown) => (typeof value === "string" ? value : "");

/** Message text: trimmed, Windows line endings and runs of blank lines collapsed */
export const parseMessage = (value: unknown): string => {
  const text = str(value).replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < MESSAGE_MIN || text.length > MESSAGE_MAX) throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_MESSAGE);
  return text;
};

/**
 * New reception message. A signed-in reader may leave name/email empty (their
 * account is used); a guest must give a name and an email for the answer.
 */
export const parseInquiryInput = (body: unknown, member?: { memberNick: string; memberEmail?: string } | null): InquiryInput => {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const name = str(b.name).trim() || member?.memberNick || "";
  if (name.length < 2 || name.length > 60) throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_NAME);

  const rawEmail = str(b.email).trim();
  let email: string | undefined;
  if (rawEmail) email = normalizeEmail(rawEmail);
  else if (member?.memberEmail) email = member.memberEmail;
  else if (!member) throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_EMAIL);

  const rawPhone = str(b.phone).trim();
  const phone = rawPhone ? normalizePhone(rawPhone) : undefined;

  const topic = (Object.values(InquiryTopic) as string[]).includes(str(b.topic)) ? (str(b.topic) as InquiryTopic) : InquiryTopic.OTHER;
  const orderId = /^[0-9a-f]{24}$/i.test(str(b.orderId)) ? str(b.orderId) : undefined;

  return { name, email, phone, topic, orderId, message: parseMessage(b.message), lang: toMailLang(b.lang) };
};
