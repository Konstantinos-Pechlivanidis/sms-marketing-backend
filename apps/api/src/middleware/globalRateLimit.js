// apps/api/src/middleware/globalRateLimit.js
const { createLimiter } = require('../lib/ratelimit');

/**
 * Two limiters:
 *  - publicLimiter: for non-auth routes (e.g., /webhooks, /tracking, /api/unsubscribe)
 *  - authLimiter: for authenticated /api routes
 *
 * Tune points/duration from env if you like.
 */
const PUBLIC_POINTS = Number(process.env.RL_PUBLIC_POINTS || 60);   // req/min per IP
const AUTH_POINTS   = Number(process.env.RL_AUTH_POINTS   || 200);  // req/min per IP

const publicLimiter = createLimiter({
  keyPrefix: 'rl:public',
  points: PUBLIC_POINTS,
  duration: 60
});

const authLimiter = createLimiter({
  keyPrefix: 'rl:auth',
  points: AUTH_POINTS,
  duration: 60
});

function rateLimitByIp(limiter) {
  return async (req, res, next) => {
    try {
      const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
      await limiter.consume(String(ip));
      next();
    } catch {
      res.status(429).json({ message: 'Too Many Requests' });
    }
  };
}

/**
 * Mount helpers:
 *  - usePublicRateLimit  -> for public routers
 *  - useAuthRateLimit    -> for authenticated routers
 */
const usePublicRateLimit = rateLimitByIp(publicLimiter);
const useAuthRateLimit = rateLimitByIp(authLimiter);

module.exports = { usePublicRateLimit, useAuthRateLimit };
