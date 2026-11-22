import crypto from "crypto";
import InquiryModel, { InquirySender, InquiryStatus } from "../schema/Inquiry.model";
import OrderModel from "../schema/Order.model";
import Errors, { HttpCode, Message } from "../libs/types/Errors";
import { InquiryInput, parseMessage } from "../libs/utils/inquiry-input";

/** New conversations one sender may open per hour */
export const CREATE_LIMIT_PER_HOUR = 3;
/** Reader messages per conversation in 10 minutes */
const REPLY_LIMIT_PER_10_MIN = 5;
/** Messages a single conversation may hold */
const MAX_MESSAGES = 60;

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

/** Private link key: an HMAC of the id, so it is never stored and can be put in emails */
export const inquiryKey = (id: unknown) =>
  crypto.createHmac("sha256", String(process.env.SESSION_SECRET || "bookon-dev")).update(`inquiry:${String(id)}`).digest("base64url");

const keyMatches = (id: unknown, key: unknown) => {
  if (typeof key !== "string" || key.length !== 43) return false;
  const expected = Buffer.from(inquiryKey(id));
  const given = Buffer.from(key);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
};

const validId = (id: string) => {
  if (!/^[0-9a-f]{24}$/i.test(id)) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);
  return id;
};

/** What the reader is allowed to see (no member id, no IP hash) */
const forReader = (doc: any) => ({
  _id: doc._id,
  inquiryName: doc.inquiryName,
  inquiryEmail: doc.inquiryEmail,
  inquiryTopic: doc.inquiryTopic,
  inquiryOrder: doc.inquiryOrder,
  inquiryStatus: doc.inquiryStatus,
  inquiryReaderUnread: doc.inquiryReaderUnread,
  inquiryMessages: (doc.inquiryMessages || []).map((m: any) => ({ _id: m._id, messageFrom: m.messageFrom, messageText: m.messageText, createdAt: m.createdAt })),
  lastMessageAt: doc.lastMessageAt,
  createdAt: doc.createdAt,
});

interface Reader {
  member?: { _id: any } | null;
  key?: unknown;
}

class InquiryService {
  /*********************** READER ***************************/

  public async create(input: InquiryInput, member: { _id: any } | null, ip: string) {
    const ipHash = sha256(`ip:${ip}`);
    const since = new Date(Date.now() - 3600 * 1000);
    const who: Record<string, unknown>[] = [{ inquiryIpHash: ipHash }];
    if (member) who.push({ inquiryMember: member._id });
    if (input.email) who.push({ inquiryEmail: input.email });
    const recent = await InquiryModel.countDocuments({ createdAt: { $gte: since }, $or: who }).exec();
    if (recent >= CREATE_LIMIT_PER_HOUR) throw new Errors(HttpCode.TOO_MANY_REQUESTS, Message.TOO_MANY_INQUIRIES);

    // An order can only be linked by the reader who placed it
    let order: unknown;
    if (member && input.orderId && (await OrderModel.exists({ _id: input.orderId, memberId: member._id }).exec())) order = input.orderId;

    const doc = await InquiryModel.create({
      inquiryMember: member?._id,
      inquiryName: input.name,
      inquiryEmail: input.email,
      inquiryPhone: input.phone,
      inquiryTopic: input.topic,
      inquiryOrder: order,
      inquiryLang: input.lang,
      inquiryIpHash: ipHash,
      inquiryMessages: [{ messageFrom: InquirySender.READER, messageText: input.message }],
      lastMessageAt: new Date(),
    });
    return { inquiry: forReader(doc.toObject()), key: inquiryKey(doc._id) };
  }

  public async getMine(memberId: any) {
    const docs = await InquiryModel.find({ inquiryMember: memberId }).sort({ lastMessageAt: -1 }).limit(50).lean().exec();
    return docs.map(forReader);
  }

  /** Owner (signed in) or anyone with the private key */
  private async findForReader(id: string, reader: Reader) {
    const doc = await InquiryModel.findById(validId(id)).exec();
    const owner = !!(doc && reader.member && doc.inquiryMember && String(doc.inquiryMember) === String(reader.member._id));
    if (!doc || !(owner || keyMatches(doc._id, reader.key))) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);
    return doc;
  }

  /** Opening the conversation marks the library's answer as read */
  public async getForReader(id: string, reader: Reader) {
    const doc = await this.findForReader(id, reader);
    if (doc.inquiryReaderUnread) {
      doc.inquiryReaderUnread = false;
      await doc.save();
    }
    return forReader(doc.toObject());
  }

  /** A reader message (re)opens the conversation for the library */
  public async readerReply(id: string, reader: Reader, text: unknown) {
    const message = parseMessage(text);
    const doc = await this.findForReader(id, reader);
    const messages = doc.inquiryMessages as any[];
    if (messages.length >= MAX_MESSAGES) throw new Errors(HttpCode.BAD_REQUEST, Message.INQUIRY_TOO_LONG);
    const since = Date.now() - 10 * 60 * 1000;
    const burst = messages.filter((m) => m.messageFrom === InquirySender.READER && new Date(m.createdAt).getTime() > since).length;
    if (burst >= REPLY_LIMIT_PER_10_MIN) throw new Errors(HttpCode.TOO_MANY_REQUESTS, Message.TOO_MANY_REQUESTS);

    messages.push({ messageFrom: InquirySender.READER, messageText: message });
    doc.inquiryStatus = InquiryStatus.NEW;
    doc.inquiryReaderUnread = false;
    doc.lastMessageAt = new Date();
    await doc.save();
    return forReader(doc.toObject());
  }

  /** Header badge for signed-in readers */
  public async unreadCount(memberId: any) {
    return InquiryModel.countDocuments({ inquiryMember: memberId, inquiryReaderUnread: true }).exec();
  }

  /*********************** LIBRARY ***************************/

  public async getAllForAdmin(status?: string) {
    const filter = (Object.values(InquiryStatus) as string[]).includes(String(status)) ? { inquiryStatus: status } : {};
    const [list, counts] = await Promise.all([
      InquiryModel.find(filter, { inquiryIpHash: 0 })
        .sort({ lastMessageAt: -1 })
        .limit(200)
        .populate("inquiryMember", "memberNick memberImage")
        .lean()
        .exec(),
      InquiryModel.aggregate([{ $group: { _id: "$inquiryStatus", n: { $sum: 1 } } }]).exec(),
    ]);
    const count: Record<string, number> = { NEW: 0, ANSWERED: 0, CLOSED: 0 };
    counts.forEach((c: any) => (count[c._id] = c.n));
    return { list, count };
  }

  public async getForAdmin(id: string) {
    const doc = await InquiryModel.findById(validId(id), { inquiryIpHash: 0 })
      .populate("inquiryMember", "memberNick memberImage memberEmail memberPhone")
      .populate("inquiryOrder", "orderTotal orderStatus orderAddress createdAt")
      .lean()
      .exec();
    if (!doc) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);
    return doc;
  }

  public async libraryReply(id: string, text: unknown) {
    const message = parseMessage(text);
    const doc = await InquiryModel.findById(validId(id)).exec();
    if (!doc) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);
    const messages = doc.inquiryMessages as any[];
    if (messages.length >= MAX_MESSAGES) throw new Errors(HttpCode.BAD_REQUEST, Message.INQUIRY_TOO_LONG);
    messages.push({ messageFrom: InquirySender.LIBRARY, messageText: message });
    doc.inquiryStatus = InquiryStatus.ANSWERED;
    doc.inquiryReaderUnread = true;
    doc.lastMessageAt = new Date();
    await doc.save();
    return { doc: doc.toObject(), message };
  }

  public async setStatus(id: string, status: unknown) {
    if (!(Object.values(InquiryStatus) as string[]).includes(String(status))) throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_INPUT);
    const doc = await InquiryModel.findByIdAndUpdate(validId(id), { inquiryStatus: status }, { new: true }).lean().exec();
    if (!doc) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);
    return doc.inquiryStatus;
  }

  public async newCount() {
    return InquiryModel.countDocuments({ inquiryStatus: InquiryStatus.NEW }).exec();
  }
}

export default InquiryService;
