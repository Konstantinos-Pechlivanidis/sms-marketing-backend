// apps/api/src/lib/ratelimit.js
const { RateLimiterRedis, RateLimiterMemory } = require('rate-limiter-flexible');
const IORedis = require('ioredis');

let redis = null;
const url = process.env.REDIS_URL;
if (url && url !== 'disabled') {
  redis = new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: true });
  redis.on('error', (e) => console.warn('[RateLimit] Redis error:', e.message));
  redis.connect().catch((e) => console.warn('[RateLimit] Redis connect failed:', e.message));
}

/**
 * Create a rate limiter with Redis if available, else in-memory (per-process).
 */
function createLimiter({ keyPrefix, points, duration, blockDuration = 0, insuranceLimiter = true }) {
  if (redis) {
    const redisLimiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix,
      points,
      duration,
      blockDuration, // seconds to block when consumed more than points
      execEvenly: false,
      insuranceLimiter: insuranceLimiter
        ? new RateLimiterMemory({ keyPrefix: `${keyPrefix}:mem`, points, duration })
        : undefined
    });
    return redisLimiter;
  }
  // Fallback for dev (not suitable for multi-instance prod by itself)
  return new RateLimiterMemory({ keyPrefix: `${keyPrefix}:mem`, points, duration });
}

/**
 * Middleware factory: limit by IP.
 */
function rateLimitByIp(limiter) {
  return async function (req, res, next) {
    try {
      const key = req.ip || req.headers['x-forwarded-for'] || 'unknown';
      await limiter.consume(key);
      return next();
    } catch (rl) {
      const ms = rl?.msBeforeNext ?? 60_000;
      res.set('Retry-After', Math.ceil(ms / 1000));
      return res.status(429).json({ message: 'Too many requests' });
    }
  };
}

/**
 * Middleware factory: limit by custom key (e.g. email, token).
 * keyFn(req) should return a string key.
 */
function rateLimitByKey(limiter, keyFn) {
  return async function (req, res, next) {
    try {
      const key = String(keyFn(req) || req.ip || 'unknown');
      await limiter.consume(key);
      return next();
    } catch (rl) {
      const ms = rl?.msBeforeNext ?? 60_000;
      res.set('Retry-After', Math.ceil(ms / 1000));
      return res.status(429).json({ message: 'Too many requests' });
    }
  };
}

module.exports = { createLimiter, rateLimitByIp, rateLimitByKey };
