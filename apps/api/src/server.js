// apps/api/src/server.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const pinoHttp = require("pino-http");
const {
  usePublicRateLimit,
  useAuthRateLimit,
} = require("./middleware/globalRateLimit");

const app = express();

// If behind a reverse proxy (NGINX/Render/etc.), trust X-Forwarded-* headers
app.set("trust proxy", true);

/* =========================
   Logging (per-request)
   ========================= */
app.use(
  pinoHttp({
    genReqId: (req) =>
      req.headers["x-request-id"] ||
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    autoLogging: true,
    customSuccessMessage: (req, res) =>
      `${req.method} ${req.url} -> ${res.statusCode}`,
    customErrorMessage: (req, _res, err) =>
      `error on ${req.method} ${req.url}: ${err.message}`,
  })
);

/* =========================
   Security headers
   ========================= */
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
  })
);

/* =========================
   CORS (allowlist)
   ========================= */
const allowlist = (process.env.CORS_ALLOWLIST || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions = allowlist.length
  ? {
      origin(origin, cb) {
        if (!origin) return cb(null, true); // Postman / server-to-server
        const ok = allowlist.includes(origin);
        cb(ok ? null : new Error("Not allowed by CORS"));
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      optionsSuccessStatus: 204,
    }
  : { origin: true, credentials: true };

app.use(cors(corsOptions));

/* =========================
   Body parsers
   (keep raw body for HMAC verification in webhooks)
   ========================= */
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());

/* =========================
   Health & root
   ========================= */
app.use(require("./routes/health"));
app.get("/", (_req, res) => res.json({ status: "api-ok" }));

/* =========================
   ROUTES
   ========================= */
// Auth (login/register/refresh/logout) -> public, NO auth limiter
app.use("/api", require("./routes/auth"));

// User profile -> authenticated
app.use("/api", useAuthRateLimit, require("./routes/user"));

// Contacts & Lists -> authenticated
app.use("/api", useAuthRateLimit, require("./routes/contacts"));
app.use("/api", useAuthRateLimit, require("./routes/lists"));

// Templates (if yours is auth-protected, keep limiter; if public, move to public)
app.use("/api", useAuthRateLimit, require("./routes/templates"));

// Campaigns -> authenticated
app.use("/api", useAuthRateLimit, require("./routes/campaigns"));

// v1 optimized -> authenticated
app.use("/api/v1", useAuthRateLimit, require("./routes/campaigns.list"));
app.use("/api/v1", useAuthRateLimit, require("./routes/campaigns.stats"));

// Billing -> authenticated
app.use("/api", useAuthRateLimit, require("./routes/billing"));

// Jobs -> authenticated (optional)
app.use("/api", useAuthRateLimit, require("./routes/jobs"));

// Webhooks (public) -> PUBLIC limiter
app.use(usePublicRateLimit, require("./routes/mitto.webhooks"));

// Public tracking
app.use("/tracking", usePublicRateLimit, require("./routes/tracking"));

// Public offer view + Unsubscribe alias (public)
app.use("/api", usePublicRateLimit, require("./routes/tracking.offer"));
app.use("/api", usePublicRateLimit, require("./routes/unsubscribe.alias"));

// Dashboard KPIs -> authenticated
app.use("/api", useAuthRateLimit, require("./routes/dashboard"));

// Automations -> authenticated
app.use("/api", useAuthRateLimit, require("./routes/automations"));

// Swagger UI & OpenAPI JSON
app.use(require("./routes/docs"));

/* =========================
   404 for unknown API/tracking routes
   ========================= */
app.use((req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/tracking")) {
    return res.status(404).json({ message: "Not Found" });
  }
  return next();
});

/* =========================
   Centralized error handler
   ========================= */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  req.log?.error({ err }, "unhandled error");

  let status = 500;
  if (typeof err?.status === "number") status = err.status;
  else if (err?.message && /CORS/i.test(err.message)) status = 403;

  res
    .status(status)
    .json({ message: status === 500 ? "Internal Server Error" : err.message });
});

/* =========================
   START SERVER
   ========================= */
const port = Number(process.env.PORT || 3001);
const server = app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});

/* =========================
   Graceful shutdown
   ========================= */
function shutdown(signal) {
  console.log(`[${signal}] shutting down...`);
  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

module.exports = app;
