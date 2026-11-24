import helmet from "helmet";
import rateLimit, { Options } from "express-rate-limit";
import { Request } from "express";
import { HttpCode, Message } from "./types/Errors";
import { alertScript } from "./utils/alert";

/**
 * Security headers. The CSP lists exactly what the admin pages load (Google
 * Fonts, Bootstrap/axios/icons from jsDelivr, jQuery). Inline <script> blocks
 * and onerror/onclick attributes are still allowed because the EJS templates
 * use them; scripts from any other origin are blocked.
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://code.jquery.com"],
      "script-src-attr": ["'unsafe-inline'"],
      "style-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
      "font-src": ["'self'", "data:", "https://cdn.jsdelivr.net", "https://fonts.gstatic.com"],
      "img-src": ["'self'", "data:", "blob:"],
      "connect-src": ["'self'"],
      "form-action": ["'self'"],
      "frame-ancestors": ["'none'"],
      "object-src": ["'none'"],
      // nginx terminates HTTPS; locally the admin runs on plain http
      "upgrade-insecure-requests": null,
    },
  },
  // The shop (another port in development) shows /uploads images and calls the API
  crossOriginResourcePolicy: { policy: "cross-origin" },
  // OAuth-style popups are not used; keep the default same-origin opener policy
  crossOriginEmbedderPolicy: false,
});

const limitFromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const tooMany: Options["handler"] = (req, res) => {
  res.setHeader("Retry-After", String(Math.ceil(Number(res.getHeader("RateLimit-Reset") || 60))));
  if (req.originalUrl.startsWith("/admin"))
    res.status(HttpCode.TOO_MANY_REQUESTS).send(alertScript("Juda koʻp urinish. 15 daqiqadan keyin qayta urinib koʻring.", "/admin/login"));
  else res.status(HttpCode.TOO_MANY_REQUESTS).json({ code: HttpCode.TOO_MANY_REQUESTS, message: Message.TOO_MANY_REQUESTS });
};

/**
 * Sign-in, sign-up and password emails: AUTH_RATE_LIMIT attempts per IP per
 * 15 minutes (default 30). Successful logins don't count, so a library that
 * types its password right is never locked out by its own visits.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: () => limitFromEnv("AUTH_RATE_LIMIT", 30),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: tooMany,
});

/**
 * Sign-up and password emails cost us an email each and create accounts, so
 * every request counts: ACCOUNT_RATE_LIMIT per IP per hour (default 20).
 */
export const accountLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: () => limitFromEnv("ACCOUNT_RATE_LIMIT", 20),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: tooMany,
});

/** Everything else on the API: a generous per-IP ceiling against scraping and floods */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: () => limitFromEnv("API_RATE_LIMIT", 600),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // static files and uploads are served before this and never counted
  skip: (req: Request) => req.path === "/health",
  handler: tooMany,
});
