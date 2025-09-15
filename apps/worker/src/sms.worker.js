// apps/worker/src/sms.worker.js
require('dotenv').config();

if (process.env.QUEUE_DISABLED === '1') {
  console.warn('[Worker] Disabled via QUEUE_DISABLED=1');
  process.exit(0);
}

const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const prisma = require('../../api/src/lib/prisma');
const { sendSingle } = require('../../api/src/services/mitto.service');
const { ensureFreshUnsubToken } = require('../../api/src/services/unsubToken.service'); // if you have it
const { refund } = require('../../api/src/services/wallet.service'); // << NEW

const url = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new IORedis(url, { maxRetriesPerRequest: null });
connection.on('error', (e) => console.warn('[Redis] connection error:', e.message));

const concurrency = Number(process.env.WORKER_CONCURRENCY || 5);

function isRetryable(err) {
  const status = err?.status;
  if (!status) return true;      // network/timeout
  if (status >= 500) return true; // provider/server error
  if (status === 429) return true; // rate limited
  return false;                    // 4xx hard fail
}

const worker = new Worker(
  'smsQueue',
  async (job) => {
    const { messageId } = job.data;

    const msg = await prisma.campaignMessage.findUnique({
      where: { id: messageId },
      include: {
        campaign: { select: { id: true, ownerId: true, createdById: true } },
        contact:  { select: { id: true, phone: true, unsubscribeTokenHash: true } }
      }
    });
    if (!msg) return;

    try {
      // Build final text: append redeem + unsubscribe links if you already do it
      // (omitted here for brevity; assume text already includes links, or you have existing logic)

      const resp = await sendSingle({
        userId: msg.campaign.createdById,
        destination: msg.to,
        text: msg.text
      });

      const providerId = resp?.messageId || resp?.messages?.[0]?.messageId || null;

      await prisma.campaignMessage.update({
        where: { id: msg.id },
        data: {
          providerMessageId: providerId,
          sentAt: new Date(),
          status: 'sent'
        }
      });
    } catch (e) {
      const retryable = isRetryable(e);
      await prisma.campaignMessage.update({
        where: { id: msg.id },
        data: {
          failedAt: retryable ? null : new Date(),
          status: retryable ? 'queued' : 'failed',
          error: e.message
        }
      });

      // Hard fail → refund 1 credit
      if (!retryable) {
        try {
          await refund(msg.campaign.ownerId, 1, {
            reason: `hardfail:message:${msg.id}`,
            campaignId: msg.campaign.id,
            messageId: msg.id,
            meta: { error: e.message }
          });
        } catch (rf) {
          console.warn('[Wallet] refund failed:', rf?.message);
        }
      }

      if (retryable) throw e;
    }
  },
  { connection, concurrency }
);

worker.on('active', (job) => console.log(`[W] processing ${job.name} ${job.id}`));
worker.on('completed', (job) => console.log(`[W] completed ${job.name} ${job.id}`));
worker.on('failed', (job, err) => console.error(`[W] failed ${job.name} ${job.id}:`, err?.message));
