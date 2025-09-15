// apps/api/src/server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');

// ---- Create app ----
const app = express();

// If behind reverse proxy (Render/NGINX), trust X-Forwarded-* for real IPs
app.set('trust proxy', true);

// ---- Logging (per-request) ----
app.use(
  pinoHttp({
    genReqId: (req, res) =>
      req.headers['x-request-id'] ||
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    autoLogging: true,
    customSuccessMessage: function (req, res) {
      return `${req.method} ${req.url} -> ${res.statusCode}`;
    },
    customErrorMessage: function (req, res, err) {
      return `error on ${req.method} ${req.url}: ${err.message}`;
    },
  })
);

// ---- Security headers ----
app.use(
  helmet({
    // Adjust only if you serve images/assets cross-origin
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// ---- CORS (allowlist from env) ----
const allowlist = (process.env.CORS_ALLOWLIST || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Allow Postman / server-to-server (no Origin)
const corsOptions = allowlist.length
  ? {
      origin(origin, cb) {
        if (!origin) return cb(null, true);
        const ok = allowlist.some((a) => origin.startsWith(a));
        return cb(ok ? null : new Error('Not allowed by CORS'));
      },
      credentials: true,
    }
  : { origin: true, credentials: true };

app.use(cors(corsOptions));

// ---- Body parsers ----
// Keep a raw copy for HMAC verification on webhooks
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// ---- Health route (no auth) ----
app.use(require('./routes/health'));

// ---- Public landing (simple) ----
app.get('/', (_req, res) => res.json({ status: 'api-ok' }));

// ========= ROUTES MOUNTING =========
// Suggest grouping under /api; keep /tracking public

// Auth (login/register/refresh)
app.use('/api', require('./routes/auth'));

// Me (sample protected echo is inside auth route file normally; if not, keep your /me as before)
const requireAuth = require('./middleware/requireAuth');
app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.user }));

// Contacts & Lists
app.use('/api', require('./routes/contacts'));
app.use('/api', require('./routes/lists'));

// Templates (system + owner)
app.use('/api', require('./routes/templates'));

// Campaigns (CRUD, preview, enqueue, schedule)
app.use('/api', require('./routes/campaigns'));

// Campaigns stats & list (versioned)
app.use('/api/v1', require('./routes/campaigns.stats'));
app.use('/api/v1', require('./routes/campaigns.list'));

// Billing (wallet, packages, purchases)
app.use('/api', require('./routes/billing'));

// Queue/Jobs health
app.use('/api', require('./routes/jobs'));

// Webhooks (Mitto) — must come after rawBody middleware
app.use(require('./routes/mitto.webhooks'));

// Public tracking endpoints (QR redeem check etc.)
app.use('/tracking', require('./routes/tracking'));

// ========= ERROR HANDLERS =========

// 404 for unknown API routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/tracking')) {
    return res.status(404).json({ message: 'Not Found' });
  }
  return next();
});

// Centralized error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  // CORS errors / custom thrown errors will land here
  req.log?.error({ err }, 'unhandled error');
  const status =
    err.status ||
    (err.message && err.message.includes('CORS')) ? 403 : 500;
  res.status(status).json({
    message:
      status === 500 ? 'Internal Server Error' : err.message || 'Error',
  });
});

// ========= START SERVER =========
const port = Number(process.env.PORT || 3001);
const server = app.listen(port, () => {
  // use pino-http logger if present
  const logger = app?.logger || console;
  logger.info
    ? logger.info(`API running on http://localhost:${port}`)
    : console.log(`API running on http://localhost:${port}`);
});

// Graceful shutdown (SIGTERM/SIGINT)
function shutdown(signal) {
  console.log(`[${signal}] shutting down...`);
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
  // Force-exit after 10s if not closed
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
