// apps/api/src/services/campaignEnqueue.service.js
const prisma = require('../lib/prisma');
const { debit } = require('./wallet.service');
const crypto = require('node:crypto');

function render(templateText, contact) {
  return (templateText || '')
    .replace(/{{\s*firstName\s*}}/gi, contact.firstName || '')
    .replace(/{{\s*lastName\s*}}/gi, contact.lastName || '')
    .replace(/{{\s*email\s*}}/gi, contact.email || '');
}
function newTrackingId() {
  return crypto.randomBytes(9).toString('base64url');
}

exports.enqueueCampaign = async (campaignId) => {
  // 1) Transaction for status lock + members + messages
  const txResult = await prisma.$transaction(async (tx) => {
    const camp = await tx.campaign.findUnique({
      where: { id: campaignId },
      include: { template: true }
    });
    if (!camp) return { ok: false, reason: 'not_found' };

    if (!['draft', 'scheduled', 'paused'].includes(camp.status)) {
      return { ok: false, reason: `invalid_status:${camp.status}` };
    }

    const upd = await tx.campaign.updateMany({
      where: { id: campaignId, status: { in: ['draft', 'scheduled', 'paused'] } },
      data: { status: 'sending', startedAt: new Date() }
    });
    if (upd.count === 0) {
      return { ok: false, reason: 'already_sending' };
    }

    const members = await tx.listMembership.findMany({
      where: { listId: camp.listId, contact: { isSubscribed: true } },
      include: { contact: true }
    });

    if (!members.length) {
      await tx.campaign.update({
        where: { id: camp.id },
        data: { status: 'failed', finishedAt: new Date(), total: 0 }
      });
      return { ok: false, reason: 'no_recipients' };
    }

    // ==== debit credits here (outside of this tx to avoid nested tx issues) ====
    // We cannot call debit() inside this tx (it uses its own $transaction). So we return needed info.
    return {
      ok: true,
      _needsDebit: { ownerId: camp.ownerId, amount: members.length, campaignId: camp.id },
      _camp: camp,
      _members: members
    };
  });

  if (!txResult.ok) return { ...txResult, enqueuedJobs: 0 };

  // 2) Perform debit (credits) now. If insufficient -> revert campaign to 'draft'.
  const { ownerId, amount, campaignId: campId } = txResult._needsDebit;
  try {
    await debit(ownerId, amount, { reason: `enqueue:campaign:${campId}`, campaignId: campId });
  } catch (e) {
    // revert campaign status if debit failed
    await prisma.campaign.update({
      where: { id: campId },
      data: { status: 'draft', startedAt: null }
    });
    if (e.message === 'INSUFFICIENT_CREDITS') {
      return { ok: false, reason: 'insufficient_credits' };
    }
    throw e;
  }

  // 3) Create messages and set totals
  const camp = txResult._camp;
  const members = txResult._members;

  const messagesData = members.map((m) => ({
    ownerId,
    campaignId: camp.id,
    contactId: m.contactId,
    to: m.contact.phone,
    text: render(camp.template.text, m.contact),
    trackingId: newTrackingId(),
    status: 'queued'
  }));

  await prisma.$transaction([
    prisma.campaign.update({
      where: { id: camp.id },
      data: { total: members.length }
    }),
    prisma.campaignMessage.createMany({
      data: messagesData,
      skipDuplicates: true
    })
  ]);

  // 4) Enqueue jobs
  const smsQueue = require('../queues/sms.queue');
  const toEnqueue = await prisma.campaignMessage.findMany({
    where: { campaignId: camp.id, status: 'queued', providerMessageId: null },
    select: { id: true }
  });

  let enqueuedJobs = 0;
  if (smsQueue) {
    for (const m of toEnqueue) {
      await smsQueue.add('sendSMS', { messageId: m.id }, { jobId: `message:${m.id}` });
      enqueuedJobs++;
    }
  } else {
    console.warn('[Queue] Not available — messages created but not enqueued');
  }

  return { ok: true, created: messagesData.length, enqueuedJobs, campaignId: camp.id };
};
