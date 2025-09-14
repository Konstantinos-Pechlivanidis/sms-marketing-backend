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

const url = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new IORedis(url, { maxRetriesPerRequest: null });
connection.on('error', (e) => console.warn('[Redis] connection error:', e.message));

const worker = new Worker(
  'smsQueue',
  async (job) => {
    const { messageId } = job.data;

    const msg = await prisma.campaignMessage.findUnique({
      where: { id: messageId },
      include: { campaign: { select: { createdById: true } } }
    });
    if (!msg) return;

    try {
      const resp = await sendSingle({
        userId: msg.campaign.createdById,
        destination: msg.to,
        text: msg.text
      });

      // Single-send: συνήθως έρχεται ως { messageId: "..." }
      // Bulk: messages[0].messageId — καλύπτουμε και τις 2 περιπτώσεις.
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
      await prisma.campaignMessage.update({
        where: { id: msg.id },
        data: {
          failedAt: new Date(),
          status: 'failed',
          error: e.message
        }
      });
      throw e; // επιτρέπει retry από BullMQ (όταν το ενεργοποιήσουμε)
    }
  },
  { connection }
);

worker.on('completed', (job) => console.log(`Job ${job.id} completed`));
worker.on('failed', (job, err) => console.error(`Job ${job.id} failed:`, err));
