// apps/api/src/lib/cache.js
const IORedis = require("ioredis");

const url = process.env.REDIS_URL; // μην βάζεις default εδώ
let redis = null;
let enabled = false;

if (url && url !== "disabled") {
  redis = new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: true });
  redis.on("error", (e) => console.warn("[Redis cache] error:", e.message));

  // Προσπάθησε να συνδεθείς, αν αποτύχει => απενεργοποιούμε ήσυχα το cache
  redis
    .connect()
    .then(() => {
      enabled = true;
      console.log("[Redis cache] connected");
    })
    .catch((e) => {
      console.warn("[Redis cache] connect failed; cache disabled:", e.message);
    });
}

// Safe no-op wrappers
async function cacheGet(key) {
  if (!enabled) return null;
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}
async function cacheSet(key, value, ttlSec = 30) {
  if (!enabled) return false;
  try {
    await redis.set(key, value, "EX", ttlSec);
    return true;
  } catch {
    return false;
  }
}
async function cacheDel(key) {
  if (!enabled) return 0;
  try {
    return await redis.del(key);
  } catch {
    return 0;
  }
}

async function cacheDelPrefix(prefix) {
  if (!enabled) return 0;
  let deleted = 0;
  try {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        `${prefix}*`,
        "COUNT",
        200
      );
      cursor = next;
      if (keys && keys.length) {
        const n = await redis.del(keys);
        deleted += n;
      }
    } while (cursor !== "0");
  } catch {
    /* ignore */
  }
  return deleted;
}

module.exports = { cacheGet, cacheSet, cacheDel, cacheDelPrefix };
