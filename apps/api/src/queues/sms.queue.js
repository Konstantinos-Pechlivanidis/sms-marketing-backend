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

  const attempts = Number(process.env.QUEUE_ATTEMPTS || 5);
  const backoff = Number(process.env.QUEUE_BACKOFF_MS || 3000);
  const limiter = {
    max: Number(process.env.QUEUE_RATE_MAX || 20),
    duration: Number(process.env.QUEUE_RATE_DURATION_MS || 1000)
  };

  smsQueue = new Queue('smsQueue', {
    connection,
    defaultJobOptions: {
      attempts,
      backoff: { type: 'exponential', delay: backoff },
      removeOnComplete: 1000,
      removeOnFail: false
    },
    limiter
  });

  console.log('[Redis] Queue smsQueue initialized with attempts=%d backoff=%dms limiter=%o',
    attempts, backoff, limiter);
} catch (e) {
  console.warn('[Redis] disabled:', e.message);
}

module.exports = smsQueue;
