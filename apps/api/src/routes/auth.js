// apps/api/src/routes/auth.js
const express = require('express');
const cookieParser = require('cookie-parser');
const { register, login, refresh, logout } = require('../modules/auth.service');

// Rate limiting helpers (Redis-backed if REDIS_URL set, otherwise in-memory per process)
const { createLimiter, rateLimitByIp, rateLimitByKey } = require('../lib/ratelimit');

const router = express.Router();
router.use(cookieParser());

const REFRESH_COOKIE = 'rt';

// Cookie options (secure in production)
const isProd = process.env.NODE_ENV === 'production';
function setRefreshCookie(res, token, expiresAt) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',     // OK for localhost↔localhost (same-site)
    secure: isProd,      // false in dev, true in prod
    path: '/',           // VERY important: set and clear on the same path
    expires: expiresAt,
  });
}

// ---- Rate limiters ----
// Login: 20 tries / 10m per IP, 8 tries / 10m per email
const loginIpLimiter    = createLimiter({ keyPrefix: 'rl:login:ip',    points: 20,  duration: 600 });
const loginEmailLimiter = createLimiter({ keyPrefix: 'rl:login:email', points: 8,   duration: 600 });

// Register: 5 tries / 10m per IP, 2 / 10m per email
const regIpLimiter      = createLimiter({ keyPrefix: 'rl:reg:ip',      points: 5,   duration: 600 });
const regEmailLimiter   = createLimiter({ keyPrefix: 'rl:reg:email',   points: 2,   duration: 600 });

// Refresh: 120 / 10m per IP
const refreshIpLimiter  = createLimiter({ keyPrefix: 'rl:refresh:ip',  points: 120, duration: 600 });

// Logout: 60 / 10m per IP
const logoutIpLimiter   = createLimiter({ keyPrefix: 'rl:logout:ip',   points: 60,  duration: 600 });

// ---- Helpers ----
function normEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

// ---------- Routes ----------

// Register
router.post(
  '/auth/register',
  rateLimitByIp(regIpLimiter),
  rateLimitByKey(regEmailLimiter, req => normEmail(req.body?.email)),
  async (req, res) => {
    try {
      const email = normEmail(req.body?.email);
      const { password, senderName, company } = req.body || {};
      if (!email || !password) return res.status(400).json({ message: 'email & password required' });

      const user = await register({ email, password, senderName, company });
      res.status(201).json({
        id: user.id,
        email: user.email,
        senderName: user.senderName,
        company: user.company
      });
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  }
);

// Login
router.post(
  '/auth/login',
  rateLimitByIp(loginIpLimiter),
  rateLimitByKey(loginEmailLimiter, req => normEmail(req.body?.email)),
  async (req, res) => {
    try {
      const email = normEmail(req.body?.email);
      const { password } = req.body || {};
      if (!email || !password) return res.status(400).json({ message: 'email & password required' });

      const { user, accessToken, refreshToken, expiresAt } = await login({ email, password });
      setRefreshCookie(res, refreshToken, expiresAt);

      res.json({
        accessToken,
        user: { id: user.id, email: user.email, senderName: user.senderName, company: user.company }
      });
    } catch (e) {
      // Do not leak whether email exists; 401 is fine for both wrong pass/unknown email
      res.status(401).json({ message: e.message });
    }
  }
);

// Refresh
router.post(
  '/auth/refresh',
  rateLimitByIp(refreshIpLimiter),
  async (req, res) => {
    try {
      const token = req.cookies?.[REFRESH_COOKIE];
      if (!token) return res.status(401).json({ message: 'No refresh token' });

      const { accessToken, user } = await refresh(token);
      res.json({
        accessToken,
        user: { id: user.id, email: user.email, senderName: user.senderName, company: user.company }
      });
    } catch (e) {
      res.status(401).json({ message: e.message });
    }
  }
);

// Logout
router.post(
  '/auth/logout',
  rateLimitByIp(logoutIpLimiter),
  async (req, res) => {
    try {
      const token = req.cookies?.[REFRESH_COOKIE];
      if (token) await logout(token);
      res.clearCookie(REFRESH_COOKIE, { path: '/' });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  }
);

module.exports = router;
