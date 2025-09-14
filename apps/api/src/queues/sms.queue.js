const { Queue } = require('bullmq');
const IORedis = require('ioredis');

if (process.env.QUEUE_DISABLED === '1') {
  console.warn('[Queue] Disabled via QUEUE_DISABLED=1');
  module.exports = null;
  return;
}

let smsQueue = null;
try {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  const connection = new IORedis(url, { maxRetriesPerRequest: null });
  connection.on('error', (e) => console.warn('[Redis] connection error:', e.message));
  smsQueue = new Queue('smsQueue', { connection });
  console.log('[Redis] Queue smsQueue initialized');
} catch (e) {
  console.warn('[Redis] disabled:', e.message);
}
module.exports = smsQueue;
