// apps/api/src/services/campaignEnqueue.service.js
const crypto = require('node:crypto');
const prisma = require('../lib/prisma');
const { debit } = require('../services/wallet.service');

// Optional BullMQ/Redis. We load lazily to avoid connection errors when disabled.
let Queue, IORedis;
try {
  Queue = require('bullmq').Queue;
  IORedis = require('ioredis');
} catch (_) {
  // bullmq/ioredis not installed — that's okay for QUEUE_DISABLED mode
}

const QUEUE_DISABLED = process.env.QUEUE_DISABLED === '1';
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

let smsQueue = null;
let producerConn = null;
let queueInitTried = false;

async function getQueue() {
  if (QUEUE_DISABLED) return null;
  if (smsQueue || queueInitTried) return smsQueue;
  queueInitTried = true;

  // If deps are missing, bail quietly
  if (!Queue || !IORedis) return null;

  try {
    // Basic sanity: if REDIS_URL is obviously unset, don't try
    if (!REDIS_URL || !/^redis(s)?:\/\//i.test(REDIS_URL)) return null;

    producerConn = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    producerConn.on('error', (e) => {
      // Downgrade to debug-level: avoid noisy console in dev
      console.debug('[Redis] producer connection issue:', e?.message);
    });

    smsQueue = new Queue('smsQueue', { connection: producerConn });
    return smsQueue;
  } catch (_) {
    // Fail open: treat as no queue
    smsQueue = null;
    return null;
  }
}

function renderText(text, contact) {
  return String(text || '')
    .replace(/\{\{firstName\}\}/g, contact.firstName || '')
    .replace(/\{\{lastName\}\}/g, contact.lastName || '')
    .replace(/\{\{email\}\}/g, contact.email || '');
}

function newTrackingId() {
  return crypto.randomBytes(12).toString('hex'); // 24 chars
}

/**
 * Enqueue a campaign:
 *  - Validates enqueueable
 *  - Collects subscribed recipients
 *  - Debits credits atomically
 *  - Creates CampaignMessage rows (status=queued)
 *  - Tries to add BullMQ jobs (if queue available)
 */
async function enqueueCampaign(campaignId) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: Number(campaignId) },
    include: {
      template: true,
      list: {
        include: {
          memberships: { include: { contact: true } }
        }
      }
    }
  });

  if (!campaign) return { ok: false, reason: 'not_found' };

  if (!['draft', 'scheduled', 'paused'].includes(campaign.status)) {
    return { ok: false, reason: 'not_enqueueable' };
  }

  // Build recipients: subscribed & has phone
  const contacts = campaign.list.memberships
    .map(m => m.contact)
    .filter(c => c?.isSubscribed && c?.phone);

  // Unique by contactId
  const seen = new Set();
  const recipients = [];
  for (const c of contacts) {
    if (!seen.has(c.id)) { seen.add(c.id); recipients.push(c); }
  }

  if (recipients.length === 0) {
    return { ok: false, reason: 'no_valid_recipients' };
  }

  const now = new Date();
  const CHUNK = 500;

  const result = await prisma.$transaction(async (tx) => {
    // 1) Debit credits for N recipients
    await debit(campaign.ownerId, recipients.length, {
      reason: `enqueue:campaign:${campaign.id}`,
      campaignId: campaign.id
    });

    // 2) Flip campaign -> sending
    await tx.campaign.update({
      where: { id: campaign.id },
      data: {
        status: 'sending',
        startedAt: now,
        total: recipients.length,
        scheduledAt: null
      }
    });

    // 3) Create messages and collect their IDs
    let createdCount = 0;
    const createdIds = [];

    for (let i = 0; i < recipients.length; i += CHUNK) {
      const slice = recipients.slice(i, i + CHUNK);
      for (const contact of slice) {
        const text = renderText(campaign.template.text, contact);
        const trackingId = newTrackingId();
        const msg = await tx.campaignMessage.create({
          data: {
            ownerId: campaign.ownerId,
            campaignId: campaign.id,
            contactId: contact.id,
            to: contact.phone,
            text,
            trackingId,
            status: 'queued'
          },
          select: { id: true }
        });
        createdIds.push(msg.id);
      }
      createdCount += slice.length;
    }

    return { createdCount, createdIds };
  });

  // 4) Try to queue jobs (best effort)
  const q = await getQueue();
  if (q && result.createdIds.length) {
    try {
      const jobs = result.createdIds.map((id) => ({
        name: 'send',
        data: { messageId: id },
        opts: { removeOnComplete: 1000, removeOnFail: 5000 }
      }));
      await q.addBulk(jobs);
      return { ok: true, total: recipients.length, enqueued: result.createdCount };
    } catch (e) {
      // Queue is down -> leave messages queued, allow retry later
      console.debug('[Queue] addBulk failed; leaving messages queued:', e?.message);
      return { ok: true, total: recipients.length, enqueued: 0, queueDisabled: true };
    }
  }

  // No queue available (disabled or missing)
  return { ok: true, total: recipients.length, enqueued: 0, queueDisabled: true };
}

module.exports = { enqueueCampaign };
