// apps/worker/src/scheduler.worker.js
require('dotenv').config();

if (process.env.QUEUE_DISABLED === '1') {
  console.warn('[SchedulerWorker] Disabled via QUEUE_DISABLED=1');
  process.exit(0);
}

const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const { enqueueCampaign } = require('../../api/src/services/campaignEnqueue.service');

const url = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new IORedis(url, { maxRetriesPerRequest: null });
connection.on('error', (e) => console.warn('[Redis] scheduler connection error:', e.message));

const concurrency = Number(process.env.SCHEDULER_CONCURRENCY || 2);

const worker = new Worker(
  'schedulerQueue',
  async (job) => {
    if (job.name !== 'enqueueCampaign') return;
    const { campaignId } = job.data || {};
    if (!campaignId) return;

    const result = await enqueueCampaign(Number(campaignId));
    if (!result.ok) {
      console.warn('[Scheduler] enqueueCampaign result:', result);
    } else {
      console.log('[Scheduler] Enqueued campaign', campaignId, 'jobs:', result.enqueuedJobs);
    }
  },
  { connection, concurrency }
);

worker.on('active', (job) => console.log(`[Scheduler] processing ${job.name} ${job.id}`));
worker.on('completed', (job) => console.log(`[Scheduler] completed ${job.name} ${job.id}`));
worker.on('failed', (job, err) => console.error(`[Scheduler] failed ${job.name} ${job.id}:`, err?.message));
