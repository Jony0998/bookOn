
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import multer from "multer";
import Errors, { HttpCode, Message } from "./libs/types/Errors";
import { alertScript } from "./libs/utils/alert";
import path from "path";
import router from "./router";
import routerAdmin from "./router-admin";
import morgan from "morgan";
import { MORGAN_FORMAT } from "./libs/types/config";

import session from "express-session";
import ConnectMongoDB from "connect-mongodb-session";
import { T } from "./libs/types/common";
import cookieParser from "cookie-parser";
import http from "http";
import { Server as SocketIOServer, Socket } from "socket.io";

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
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // REST API
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
/** 2-SESSIONS **/
app.use(
  session({
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
  })
);

app.use(function (req, res, next) {
  const sessionInstance = req.session as T;
  res.locals.member = sessionInstance.member;
  next();
});

/** 3-VIEWS **/
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

/** 4-ROUTERS **/
app.use("/admin", routerAdmin); // SSR: EJS
app.use("/", router); // SPA: REACT

/** 5-ERROR HANDLER (upload errors and anything not caught in controllers) **/
app.use(function (err: any, req: Request, res: Response, next: NextFunction) {
  console.log("Error, unhandled:", err?.code || "", err?.message || err);
  if (res.headersSent) return next(err);

  let error = Errors.standard;
  if (err instanceof Errors) error = { code: err.code, message: err.message };
  else if (err instanceof multer.MulterError)
    error = { code: HttpCode.BAD_REQUEST, message: Message.INVALID_FILE };

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

let summaryClients = 0;
io.on("connection", (socket: Socket) => {
  summaryClients++;
  console.log(`${summaryClients} Connection & total`);

  socket.on("disconnect", () => {
    summaryClients--;
    console.log(`${summaryClients} Disconnection & total`);
  });
});

// Listen is called in server.ts after MongoDB connects
export default server;
