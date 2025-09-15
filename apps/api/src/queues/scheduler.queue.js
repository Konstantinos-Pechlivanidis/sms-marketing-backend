// apps/api/src/queues/scheduler.queue.js
const { Queue } = require('bullmq');
const IORedis = require('ioredis');

if (process.env.QUEUE_DISABLED === '1') {
  module.exports = null;
  return;
}

const url = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new IORedis(url, { maxRetriesPerRequest: null });

const schedulerQueue = new Queue('schedulerQueue', {
  connection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: false
  }
});

module.exports = schedulerQueue;
