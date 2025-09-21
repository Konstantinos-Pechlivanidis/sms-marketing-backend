// apps/api/src/services/campaignEnqueue.service.js
const prisma = require('../lib/prisma');
const { normalizeToE164, isE164 } = require('../lib/phone');

const ALL_LIST_NAME = '[ALL_CONTACTS]';

// Helper: debit wallet (throws { status: 402 } on insufficient credits)
async function debitCredits(ownerId, units, reason, meta) {
  const wallet = await prisma.wallet.findUnique({ where: { ownerId } });
  const balance = wallet?.balance ?? 0;
  if (balance < units) {
    const err = new Error('insufficient credits');
    err.status = 402;
    throw err;
  }
  const newBal = balance - units;
  const txn = await prisma.$transaction([
    prisma.wallet.update({
      where: { ownerId },
      data: { balance: newBal }
    }),
    prisma.creditTransaction.create({
      data: {
        ownerId,
        type: 'debit',
        amount: units,
        balanceAfter: newBal,
        reason: reason || 'campaign enqueue',
        meta: meta || null
      }
    })
  ]);
  return txn;
}

// Render template with simple handlebars-like vars
function renderText(templateText, contact) {
  return templateText
    .replace(/\{\{firstName\}\}/g, contact.firstName || '')
    .replace(/\{\{lastName\}\}/g, contact.lastName || '')
    .replace(/\{\{email\}\}/g, contact.email || '');
}

function smsParts(len) {
  if (len <= 160) return 1;
  return Math.ceil(len / 153);
}

exports.enqueueCampaign = async (campaignId) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      template: true,
      list: {
        include: {
          memberships: { include: { contact: true } }
        }
      },
      owner: true
    }
  });

  if (!campaign) return { ok: false, reason: 'not_found' };

  // Resolve recipients:
  let contacts = [];
  if (campaign.list?.name === ALL_LIST_NAME) {
    contacts = await prisma.contact.findMany({
      where: { ownerId: campaign.ownerId, isSubscribed: true }
    });
  } else {
    contacts = campaign.list?.memberships
      ?.map((m) => m.contact)
      ?.filter((c) => c.isSubscribed) ?? [];
  }

  // Filter valid phone/E.164 (should already be stored as E.164)
  contacts = contacts.filter((c) => c.phone && isE164(c.phone));

  if (!contacts.length) {
    return { ok: false, reason: 'no_valid_recipients' };
  }

  // Render messages + estimate credits
  const messages = contacts.map((c) => {
    const text = renderText(campaign.template.text, c);
    const parts = smsParts(text.length);
    return { contactId: c.id, to: c.phone, text, parts };
  });

  const totalCredits = messages.reduce((acc, m) => acc + m.parts, 0);

  // Debit wallet
  await debitCredits(campaign.ownerId, totalCredits, 'campaign enqueue', {
    campaignId: campaign.id
  });

  // Persist messages and update campaign status
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.campaign.update({
      where: { id: campaign.id },
      data: {
        status: 'sending',
        startedAt: campaign.startedAt ?? now,
        total: messages.length
      }
    });

    // Create CampaignMessage rows
    for (const m of messages) {
      await tx.campaignMessage.create({
        data: {
          ownerId: campaign.ownerId,
          campaignId: campaign.id,
          contactId: m.contactId,
          to: m.to,
          text: m.text,
          trackingId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
          status: 'queued'
        }
      });
    }
  });

  // Here you would push to your provider queue; we return a simple OK for now.
  return { ok: true, queued: messages.length, creditsDebited: totalCredits };
};
