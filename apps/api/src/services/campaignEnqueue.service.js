// apps/api/src/services/campaignEnqueue.service.js
const crypto = require('node:crypto');
const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const prisma = require('../lib/prisma');
const { debit } = require('../services/wallet.service'); // assumes you have debit(); you already use refund() in worker

// Reuse Redis from env (same as worker)
const url = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new IORedis(url, { maxRetriesPerRequest: null });
connection.on('error', (e) => console.warn('[Redis] producer connection error:', e.message));

const smsQueue = new Queue('smsQueue', { connection });

function renderText(text, contact) {
  return String(text || '')
    .replace(/\{\{firstName\}\}/g, contact.firstName || '')
    .replace(/\{\{lastName\}\}/g, contact.lastName || '')
    .replace(/\{\{email\}\}/g, contact.email || '');
}

// simple unique token for trackingId
function newTrackingId() {
  return crypto.randomBytes(12).toString('hex'); // 24 chars
}

/**
 * Enqueue a campaign:
 *  - Validates campaign is owned by someone and is enqueueable
 *  - Builds recipient set from the campaign's list (subscribed contacts only)
 *  - Debits wallet atomically for N credits
 *  - Creates N CampaignMessage rows
 *  - Adds N jobs to BullMQ (payload: { messageId })
 */
async function enqueueCampaign(campaignId) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: Number(campaignId) },
    include: {
      template: true,
      list: {
        include: {
          memberships: {
            include: { contact: true }
          }
        }
      }
    }
  });

  if (!campaign) return { ok: false, reason: 'not_found' };

  if (!['draft', 'scheduled', 'paused'].includes(campaign.status)) {
    return { ok: false, reason: 'not_enqueueable' };
  }

  // Build recipients: subscribed, has phone
  const contacts = campaign.list.memberships
    .map(m => m.contact)
    .filter(c => c?.isSubscribed && c?.phone);

  // Unique by contactId (defensive)
  const seen = new Set();
  const recipients = [];
  for (const c of contacts) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      recipients.push(c);
    }
  }

  if (recipients.length === 0) {
    return { ok: false, reason: 'no_valid_recipients' };
  }

  const now = new Date();

  // All-or-nothing: debit credits, flip campaign to sending, create messages
  // We avoid createMany -> no IDs returned; we want IDs for queue jobs.
  // Chunk inserts to keep memory stable for large lists.
  const CHUNK = 500;

  const result = await prisma.$transaction(async (tx) => {
    // 1) Debit credits
    await debit(campaign.ownerId, recipients.length, {
      reason: `enqueue:campaign:${campaign.id}`,
      campaignId: campaign.id
    });

    // 2) Update campaign -> sending
    await tx.campaign.update({
      where: { id: campaign.id },
      data: {
        status: 'sending',
        startedAt: now,
        total: recipients.length,
        // when enqueuing a previously scheduled campaign, clear scheduledAt
        scheduledAt: null
      }
    });

    // 3) Create messages (in chunks), queue jobs
    let createdCount = 0;

    for (let i = 0; i < recipients.length; i += CHUNK) {
      const slice = recipients.slice(i, i + CHUNK);

      // Insert one-by-one to get IDs immediately (OK for MVP; chunked to reduce round-trips)
      const createdIds = [];
      for (const contact of slice) {
        const text = renderText(campaign.template.text, contact);
        const trackingId = newTrackingId();

        const msg = await tx.campaignMessage.create({
          data: {
            ownerId: campaign.ownerId,
            campaignId: campaign.id,
            contactId: contact.id,
            to: contact.phone,   // already normalized to E.164 by contacts API
            text,
            trackingId,
            status: 'queued'
          },
          select: { id: true }
        });

        createdIds.push(msg.id);
      }

      // Queue jobs for this chunk
      const jobs = createdIds.map((id) => ({
        name: 'send',
        data: { messageId: id },
        opts: { removeOnComplete: 1000, removeOnFail: 5000 }
      }));
      await smsQueue.addBulk(jobs);

      createdCount += createdIds.length;
    }

    return { createdCount };
  });

  return {
    ok: true,
    total: recipients.length,
    enqueued: result.createdCount
  };
}

module.exports = { enqueueCampaign };
