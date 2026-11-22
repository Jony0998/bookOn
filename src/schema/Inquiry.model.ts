import mongoose, { Schema } from "mongoose";

/** Who is waiting: NEW = the library must answer, ANSWERED = the reader has an answer */
export enum InquiryStatus {
  NEW = "NEW",
  ANSWERED = "ANSWERED",
  CLOSED = "CLOSED",
}

export enum InquiryTopic {
  ORDER = "ORDER",
  BOOK = "BOOK",
  DELIVERY = "DELIVERY",
  ACCOUNT = "ACCOUNT",
  OTHER = "OTHER",
}

export enum InquirySender {
  READER = "READER",
  LIBRARY = "LIBRARY",
}

const messageSchema = new Schema(
  {
    messageFrom: { type: String, enum: Object.values(InquirySender), required: true },
    messageText: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

/**
 * Reception desk: a question from a reader (signed in or guest) and the
 * conversation with the library. Guests open it with a private link; its key
 * is an HMAC of the id (see Inquiry.service), so nothing secret is stored.
 */
const inquirySchema = new Schema(
  {
    inquiryMember: { type: Schema.Types.ObjectId, ref: "Member" },
    inquiryName: { type: String, required: true, trim: true },
    inquiryEmail: { type: String, trim: true, lowercase: true },
    inquiryPhone: { type: String, trim: true },
    inquiryTopic: { type: String, enum: Object.values(InquiryTopic), default: InquiryTopic.OTHER },
    inquiryOrder: { type: Schema.Types.ObjectId, ref: "Order" },
    inquiryLang: { type: String, enum: ["uz", "ru", "en"], default: "uz" },
    inquiryStatus: { type: String, enum: Object.values(InquiryStatus), default: InquiryStatus.NEW },
    inquiryMessages: { type: [messageSchema], default: [] },
    /** The reader has a library answer they haven't opened yet */
    inquiryReaderUnread: { type: Boolean, default: false },
    /** sha256 of the sender IP, only for rate limiting */
    inquiryIpHash: { type: String },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

inquirySchema.index({ inquiryStatus: 1, lastMessageAt: -1 });
inquirySchema.index({ inquiryMember: 1, lastMessageAt: -1 });
inquirySchema.index({ inquiryIpHash: 1, createdAt: -1 });

export default mongoose.model("Inquiry", inquirySchema, "inquiries");
