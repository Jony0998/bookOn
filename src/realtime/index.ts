import { RequestHandler } from "express";
import { Server, Socket } from "socket.io";
import AuthService from "../models/Auth.service";
import InquiryModel, { InquiryStatus } from "../schema/Inquiry.model";
import OrderModel from "../schema/Order.model";
import { OrderStatus } from "../libs/types/enums/order.enum";
import { MemberType } from "../libs/types/enums/member.enum";
import { keyMatches } from "../models/Inquiry.service";

/**
 * Real-time layer (Socket.io). Who a socket is comes from the same cookies as
 * HTTP: the shop JWT (accessToken) for readers, the admin session for the
 * library; guests prove access to a conversation with its private key.
 *
 * Rooms
 *   library            the admin panel: new orders, new questions, replies
 *   member:<id>        one reader's tabs: order status, unread replies
 *   inquiry:<id>       everyone looking at one conversation: messages, typing
 */
export const ROOM = {
  library: "library",
  member: (id: unknown) => `member:${String(id)}`,
  inquiry: (id: unknown) => `inquiry:${String(id)}`,
};

const TYPING_EVERY_MS = 1500;
const MAX_ROOMS_PER_SOCKET = 20;

let io: Server | null = null;
const auth = new AuthService();

const readCookie = (header: string | undefined, name: string) => {
  for (const part of (header || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
};

interface SocketData {
  memberId?: string;
  isLibrary?: boolean;
  lastTyping?: number;
}

/** Wire Socket.io: identity on connect, then the client events below */
export const attachRealtime = (server: Server, session: RequestHandler) => {
  io = server;
  // the admin session cookie is read by the same middleware Express uses
  server.engine.use(session as any);

  server.use(async (socket, next) => {
    const data = socket.data as SocketData;
    const req: any = socket.request;
    if (req.session?.member?.memberType === MemberType.LIBRARY) data.isLibrary = true;
    const token = readCookie(req.headers?.cookie, "accessToken");
    if (token) {
      try {
        data.memberId = String((await auth.checkAuth(token))._id);
      } catch {
        /* expired token: connect as a guest */
      }
    }
    next();
  });

  server.on("connection", (socket: Socket) => {
    const data = socket.data as SocketData;
    if (data.isLibrary) socket.join(ROOM.library);
    if (data.memberId) socket.join(ROOM.member(data.memberId));

    /** Join a conversation: the library, its owner, or anyone with the key */
    socket.on("inquiry:join", async (payload: any, ack?: (r: { ok: boolean }) => void) => {
      const reply = typeof ack === "function" ? ack : () => undefined;
      try {
        const id = String(payload?.id ?? "");
        if (!/^[0-9a-f]{24}$/i.test(id) || socket.rooms.size > MAX_ROOMS_PER_SOCKET) return reply({ ok: false });
        const inquiry = await InquiryModel.findById(id, { inquiryMember: 1 }).lean().exec();
        const owner = !!(inquiry && data.memberId && inquiry.inquiryMember && String(inquiry.inquiryMember) === data.memberId);
        if (!inquiry || !(data.isLibrary || owner || keyMatches(inquiry._id, payload?.key))) return reply({ ok: false });
        socket.join(ROOM.inquiry(id));
        reply({ ok: true });
      } catch {
        reply({ ok: false });
      }
    });

    socket.on("inquiry:leave", (payload: any) => {
      socket.leave(ROOM.inquiry(String(payload?.id ?? "")));
    });

    /** "…is typing": only inside a joined conversation, at most every 1.5 s */
    socket.on("inquiry:typing", (payload: any) => {
      const room = ROOM.inquiry(String(payload?.id ?? ""));
      if (!socket.rooms.has(room)) return;
      const now = Date.now();
      if (data.lastTyping && now - data.lastTyping < TYPING_EVERY_MS) return;
      data.lastTyping = now;
      socket.to(room).emit("inquiry:typing", { inquiryId: String(payload.id), from: data.isLibrary ? "LIBRARY" : "READER" });
    });
  });
};

/* ------------------------------------------------------------------ *
 * Server-side events. Every function is safe to call when Socket.io is
 * not attached (scripts, tests): it simply does nothing. Never throws.
 * ------------------------------------------------------------------ */

const emit = (room: string, event: string, payload: unknown) => {
  try {
    io?.to(room).emit(event, payload);
  } catch {
    /* real-time is best effort; HTTP already succeeded */
  }
};

const counts = async () => {
  const [pendingOrders, newInquiries] = await Promise.all([
    OrderModel.countDocuments({ orderStatus: OrderStatus.PAUSE }).exec(),
    InquiryModel.countDocuments({ inquiryStatus: InquiryStatus.NEW }).exec(),
  ]);
  return { pendingOrders, newInquiries };
};

const shortMessage = (m: any) => ({ _id: String(m._id), messageFrom: m.messageFrom, messageText: m.messageText, createdAt: m.createdAt });

const events = {
  /** A reader placed an order */
  async orderCreated(order: any) {
    if (!io) return;
    emit(ROOM.library, "order:new", { orderId: String(order._id), orderTotal: order.orderTotal, ...(await counts()) });
  },

  /** An order changed status (by the library or by the reader) */
  async orderStatus(order: any, by: "LIBRARY" | "READER") {
    if (!io || !order) return;
    const payload = { orderId: String(order._id), orderStatus: order.orderStatus, by };
    emit(ROOM.member(order.memberId), "order:status", payload);
    emit(ROOM.library, "order:status", { ...payload, ...(await counts()) });
  },

  /** A new question reached the reception */
  async inquiryCreated(inquiry: any) {
    if (!io) return;
    const first = inquiry.inquiryMessages?.[0];
    emit(ROOM.library, "inquiry:new", {
      inquiryId: String(inquiry._id),
      name: inquiry.inquiryName,
      topic: inquiry.inquiryTopic,
      preview: String(first?.messageText ?? "").slice(0, 140),
      ...(await counts()),
    });
  },

  /** A message was added to a conversation (by either side) */
  async inquiryMessage(inquiry: any, memberId?: unknown) {
    if (!io) return;
    const messages = inquiry.inquiryMessages || [];
    const last = messages[messages.length - 1];
    if (!last) return;
    const payload = { inquiryId: String(inquiry._id), message: shortMessage(last), status: inquiry.inquiryStatus };
    emit(ROOM.inquiry(inquiry._id), "inquiry:message", payload);
    if (last.messageFrom === "READER") {
      emit(ROOM.library, "inquiry:reply", { ...payload, name: inquiry.inquiryName, ...(await counts()) });
    } else if (memberId) {
      const unread = await InquiryModel.countDocuments({ inquiryMember: memberId, inquiryReaderUnread: true }).exec();
      emit(ROOM.member(memberId), "inquiry:unread", { unread, inquiryId: String(inquiry._id) });
    }
  },

  /** The library closed or reopened a conversation */
  async inquiryStatus(inquiryId: unknown, status: string) {
    emit(ROOM.inquiry(inquiryId), "inquiry:status", { inquiryId: String(inquiryId), status });
  },
};

type Events = typeof events;
/**
 * Fire-and-forget wrappers for controllers: they return immediately, never
 * delay the HTTP response and never throw (a failed count query is logged).
 */
export const realtime = Object.fromEntries(
  Object.entries(events).map(([name, fn]) => [
    name,
    (...args: unknown[]) => {
      (fn as (...a: unknown[]) => Promise<void>)(...args).catch((err) => console.warn(`[realtime] ${name} failed:`, err?.message || err));
    },
  ])
) as { [K in keyof Events]: (...args: Parameters<Events[K]>) => void };
