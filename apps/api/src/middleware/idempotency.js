// Simple in-memory idempotency cache (swap to Redis if you like)
// Key: userId + header "Idempotency-Key", TTL: 5 minutes
const cache = new Map();

function nowSec() { return Math.floor(Date.now() / 1000); }

function setWithTTL(key, value, ttlSec) {
  const expires = nowSec() + ttlSec;
  cache.set(key, { value, expires });
}

function getValid(key) {
  const rec = cache.get(key);
  if (!rec) return null;
  if (rec.expires <= nowSec()) { cache.delete(key); return null; }
  return rec.value;
}

// Express middleware:
// - Reads "Idempotency-Key" header (required for protection)
// - If seen for this user in last 5 min, returns the previous response payload
// - Otherwise, lets the request pass and stores the result (call saveIdempotency on success)
function requireIdempotencyKey(req, res, next) {
  const key = req.get('Idempotency-Key');
  if (!key) return res.status(400).json({ message: 'Idempotency-Key header required' });

  const userId = req.user?.id || 'public';
  const cacheKey = `idem:${userId}:${key}`;
  const prev = getValid(cacheKey);
  if (prev) return res.status(prev.status || 200).json(prev.body);

  // attach helper so route can persist the response
  res.saveIdempotency = (body, status = 200, ttlSec = 300) => {
    setWithTTL(cacheKey, { body, status }, ttlSec);
  };
  next();
}

module.exports = { requireIdempotencyKey };
