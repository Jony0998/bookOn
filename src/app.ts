
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import multer from "multer";
import Errors, { HttpCode, Message } from "./libs/types/Errors";
import { alertScript } from "./libs/utils/alert";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import router from "./router";
import routerAdmin from "./router-admin";
import morgan from "morgan";
import { MORGAN_FORMAT } from "./libs/types/config";

import session from "express-session";
import ConnectMongoDB from "connect-mongodb-session";
import { T } from "./libs/types/common";
import cookieParser from "cookie-parser";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import { attachRealtime } from "./realtime";
import mongoose from "mongoose";
import { apiLimiter, securityHeaders } from "./libs/security";

const MongoDBStore = ConnectMongoDB(session);
const store = new MongoDBStore({
  uri: String(process.env.MONGO_URL),
  collection: "sessions",
}); 

/** 1-ENTRANCE **/
const app = express();
const isProduction = process.env.NODE_ENV === "production";
// Behind nginx: trust X-Forwarded-Proto so req.secure reflects HTTPS
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(securityHeaders);

/**
 * Health check for uptime monitors and the deploy script: 200 when the API
 * and its database answer, 503 otherwise. Reveals nothing sensitive.
 */
const startedAt = new Date();
app.get("/health", async (req, res) => {
  let db = mongoose.connection.readyState === 1;
  if (db) {
    try {
      await mongoose.connection.db.admin().ping();
    } catch {
      db = false;
    }
  }
  res.set("Cache-Control", "no-store");
  res.status(db ? 200 : 503).json({
    status: db ? "ok" : "degraded",
    db: db ? "up" : "down",
    version: process.env.APP_VERSION || "dev",
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});
app.use(
  express.static(path.join(__dirname, "public"), {
    maxAge: isProduction ? "1d" : 0,
  })
);
app.use(
  "/uploads",
  express.static(path.join(__dirname, "../uploads"), {
    // Uploaded files must never be sniffed/executed as HTML or scripts
    setHeaders: (res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'");
    },
  })
);
// Static files above are never rate limited; everything below is
app.use(apiLimiter);
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.use(express.json({ limit: "100kb" })); // REST API
// FRONTEND_URL may list several origins: "https://bookon.sale,https://www.bookon.sale"
const allowedOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOrigin = allowedOrigins.length ? allowedOrigins : true; // dev: allow all

app.use(
  cors({
    credentials: true,
    origin: corsOrigin,
  })
);
app.use(cookieParser());
app.use(morgan(MORGAN_FORMAT));
/** 2-SESSIONS (shared with Socket.io, see realtime/) **/
const sessionMiddleware = session({
    secret: String(process.env.SESSION_SECRET),
    cookie: {
      maxAge: 1000 * 3600 * 6, // 6hr
      httpOnly: true,
      sameSite: "lax",
      secure: "auto", // secure over HTTPS, still works on plain http in dev
    },
    store: store,
    resave: true, //
    saveUninitialized: false, // no session documents for anonymous visitors
  });
app.use(sessionMiddleware);

app.use(function (req, res, next) {
  const sessionInstance = req.session as T;
  res.locals.member = sessionInstance.member;
  next();
});

/** 3-VIEWS **/
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

/**
 * Static files are cached for a day in production, so a deploy that changes
 * admin.css would keep showing the old styles. Templates link through asset(),
 * which adds a content hash: same file -> same URL (cached), new file -> new URL.
 */
const assetVersions = new Map<string, string>();
app.locals.asset = (file: string) => {
  let version = assetVersions.get(file);
  if (!version) {
    try {
      version = crypto.createHash("sha1").update(fs.readFileSync(path.join(__dirname, "public", file))).digest("hex").slice(0, 10);
    } catch {
      version = Date.now().toString(36);
    }
    assetVersions.set(file, version);
  }
  return `${file}?v=${version}`;
};

/** Formatting helpers for the admin templates (Uzbek, same rules as the shop) */
const UZ_MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
app.locals.money = (value: number) => {
  const n = Math.round((Number(value) || 0) * 100) / 100;
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
};
app.locals.date = (value: Date | string) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : `${d.getDate()}-${UZ_MONTHS[d.getMonth()]}, ${d.getFullYear()}`;
};
app.locals.dateTime = (value: Date | string) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getDate()}-${UZ_MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
app.locals.orderNo = (id: unknown) => `#${String(id).slice(-6).toUpperCase()}`;
app.locals.STATUS_LABEL = { PAUSE: "Kutilmoqda", PROCESS: "Yoʻlda", FINISH: "Yetkazildi", DELETE: "Bekor qilingan", ACTIVE: "Faol", BLOCK: "Bloklangan" };
app.locals.GENRE_LABEL = {
  FICTION: "Badiiy", NON_FICTION: "Ilmiy-ommabop", SCIENCE: "Ilmiy", HISTORY: "Tarix", BIOGRAPHY: "Biografiya",
  CHILDREN: "Bolalar uchun", TEXTBOOK: "Darsliklar", REFERENCE: "Maʼlumotnomalar", RELIGION: "Diniy", OTHER: "Boshqa",
};

/** 4-ROUTERS **/
app.use("/admin", routerAdmin); // SSR: EJS
app.use("/", router); // SPA: REACT

/** 5-ERROR HANDLER (upload errors and anything not caught in controllers) **/
app.use(function (err: any, req: Request, res: Response, next: NextFunction) {
  console.log("Error, unhandled:", err?.code || "", err?.message || err);
  if (res.headersSent) return next(err);

  let error: { code: number; message: string } = Errors.standard;
  if (err instanceof Errors) error = { code: err.code, message: err.message };
  else if (err instanceof multer.MulterError)
    error = { code: HttpCode.BAD_REQUEST, message: Message.INVALID_FILE };
  // body-parser: request body over the limit, or broken JSON
  else if (err?.type === "entity.too.large") error = { code: 413, message: "Request is too large!" };
  else if (err?.type === "entity.parse.failed") error = { code: HttpCode.BAD_REQUEST, message: Message.INVALID_INPUT };

  if (req.originalUrl.startsWith("/admin")) {
    const back = req.originalUrl.startsWith("/admin/signup") ? "/admin/signup" : "/admin/product/all";
    res.status(error.code).send(alertScript(error.message, back));
  } else {
    res.status(error.code).json(error);
  }
});

const server = http.createServer(app);
const io = new SocketIOServer(server,{
  cors: {
    origin: corsOrigin,
    credentials: true,
  },
});

// Live updates: order status, reception chat, admin notifications
attachRealtime(io, sessionMiddleware);

// Listen is called in server.ts after MongoDB connects
export default server;
