export const AUTH_TIMER = 24;
export const MORGAN_FORMAT = `:method :url :response-time  [:status] \n`;

import mongoose from "mongoose";
import Errors, { HttpCode, Message } from "./Errors";

export const shapeIntoMongooseObjectId = (target: any) => {
  if (typeof target !== "string") return target;
  // Invalid ids from clients must become 400, not a 500 crash
  if (!mongoose.Types.ObjectId.isValid(target))
    throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_INPUT);
  return new mongoose.Types.ObjectId(target);
};

/** Copy only the allowed string fields from untrusted input */
export const pickFields = <K extends string>(
  source: any,
  allowed: readonly K[]
): Partial<Record<K, string>> => {
  const result: Partial<Record<K, string>> = {};
  if (!source || typeof source !== "object") return result;
  for (const key of allowed) {
    const value = source[key];
    if (typeof value === "string") result[key] = value.trim();
  }
  return result;
};
