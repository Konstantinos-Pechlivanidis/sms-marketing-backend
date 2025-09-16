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
const { refund } = require('../../api/src/services/wallet.service');

const url = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new IORedis(url, { maxRetriesPerRequest: null });
connection.on('error', (e) => console.warn('[Redis] connection error:', e.message));

const concurrency = Number(process.env.WORKER_CONCURRENCY || 5);

function isRetryable(err) {
  const status = err?.status;
  if (!status) return true;        // network/timeout
  if (status >= 500) return true;  // provider/server error
  if (status === 429) return true; // rate limited
  return false;                    // 4xx hard fail
}

/**
 * If no more messages are in 'queued' for this campaign, mark it completed.
 * This runs after transitioning a message to 'sent' or 'failed'.
 */
async function maybeCompleteCampaign(campaignId) {
  if (!campaignId) return;
  const remaining = await prisma.campaignMessage.count({
    where: { campaignId, status: 'queued' }
  });
  if (remaining === 0) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'completed', finishedAt: new Date() }
    });
  }
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
      // If you build final text (redeem/unsub links), do it here.
      const resp = await sendSingle({
        userId: msg.campaign.createdById,
        destination: msg.to, // NOTE: keep as 'destination' to match your service signature
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

      // Try campaign auto-complete (no queued left)
      await maybeCompleteCampaign(msg.campaign.id);
    } catch (e) {
      const retryable = isRetryable(e);

      await prisma.campaignMessage.update({
        where: { id: msg.id },
        data: {
          failedAt: retryable ? null : new Date(),
          status: retryable ? 'queued' : 'failed',
          error: e?.message?.slice(0, 500) || 'send_failed'
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
        // After a terminal failure, attempt campaign auto-complete
        await maybeCompleteCampaign(msg.campaign.id);
      }

      if (retryable) throw e;
    }
  },
  { connection, concurrency }
);

worker.on('active', (job) => console.log(`[W] processing ${job.name} ${job.id}`));
worker.on('completed', (job) => console.log(`[W] completed ${job.name} ${job.id}`));
worker.on('failed', (job, err) => console.error(`[W] failed ${job.name} ${job.id}:`, err?.message));
