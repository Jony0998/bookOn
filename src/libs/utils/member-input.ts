import Errors, { HttpCode, Message } from "../types/Errors";

/** Shared validation for signup, profile updates and password reset */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NICK_RE = /^[A-Za-z0-9_]{3,30}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72; // bcrypt ignores bytes past 72

export const normalizeEmail = (value: unknown): string => {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_EMAIL);
  return email;
};

export const assertNick = (value: unknown): string => {
  const nick = typeof value === "string" ? value.trim() : "";
  if (!NICK_RE.test(nick)) throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_NICK);
  return nick;
};

export const assertPassword = (value: unknown): string => {
  if (typeof value !== "string" || value.length < MIN_PASSWORD || Buffer.byteLength(value) > MAX_PASSWORD)
    throw new Errors(HttpCode.BAD_REQUEST, Message.WEAK_PASSWORD);
  return value;
};

/** Phones are kept as digits with an optional leading + */
export const normalizePhone = (value: string): string => {
  const phone = value.replace(/[\s()-]/g, "");
  if (!/^\+?\d{7,15}$/.test(phone)) throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_PHONE);
  return phone;
};

/** Duplicate-key error -> which field clashed */
export const duplicateError = (err: any): Errors | null => {
  if (err?.code !== 11000) return null;
  const field = Object.keys(err.keyPattern || err.keyValue || {})[0];
  if (field === "memberEmail") return new Errors(HttpCode.BAD_REQUEST, Message.USED_EMAIL);
  if (field === "memberNick") return new Errors(HttpCode.BAD_REQUEST, Message.USED_NICK);
  return new Errors(HttpCode.BAD_REQUEST, Message.USED_NICK_PHONE);
};
