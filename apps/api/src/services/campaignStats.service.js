const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Utility: safe division
function rate(numer, denom) {
  return denom > 0 ? Number((numer / denom).toFixed(4)) : 0;
}

async function getFirstSentAt(campaignId, ownerId) {
  const first = await prisma.campaignMessage.findFirst({
    where: { ownerId, campaignId, sentAt: { not: null } },
    orderBy: { sentAt: 'asc' },
    select: { sentAt: true }
  });
  return first?.sentAt || null;
}

/**
 * Scoped stats for a single campaign that belongs to `ownerId`.
 * Throws { code: 'NOT_FOUND' } if the campaign doesn't belong to owner.
 */
exports.getCampaignStats = async (campaignId, ownerId) => {
  if (!ownerId) throw new Error('ownerId is required');

  // Ensure the campaign belongs to owner (avoid leaking existence)
  const owned = await prisma.campaign.findFirst({
    where: { id: campaignId, ownerId },
    select: { id: true }
  });
  if (!owned) {
    const err = new Error('campaign not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  // base counts (scoped)
  const [sent, delivered, failed, redemptions] = await Promise.all([
    prisma.campaignMessage.count({
      where: {
        ownerId,
        campaignId,
        status: { in: ['sent', 'delivered', 'failed'] }
      }
    }),
    prisma.campaignMessage.count({
      where: { ownerId, campaignId, status: 'delivered' }
    }),
    prisma.campaignMessage.count({
      where: { ownerId, campaignId, status: 'failed' }
    }),
    prisma.redemption.count({
      where: { ownerId, campaignId }
    })
  ]);

  // recipients (distinct contacts) — scoped via campaignMessage.ownerId
  const recipients = await prisma.campaignMessage.groupBy({
    by: ['contactId'],
    where: { ownerId, campaignId }
  });
  const recipientIds = recipients.map(r => r.contactId);

  // firstSentAt for unsubscribe window
  const firstSentAt = await getFirstSentAt(campaignId, ownerId);

  // unsubscribes among recipients since the campaign started sending
  let unsubscribes = 0;
  if (recipientIds.length && firstSentAt) {
    unsubscribes = await prisma.contact.count({
      where: {
        ownerId,                          // << scope
        id: { in: recipientIds },
        unsubscribedAt: { gte: firstSentAt }
      }
    });
  }

  return {
    sent,
    delivered,
    failed,
    redemptions,
    unsubscribes,
    deliveredRate: rate(delivered, sent),
    conversionRate: rate(redemptions, delivered),
    firstSentAt
  };
};

/**
 * Optional: bulk scoped stats for multiple campaignIds
 */
exports.getManyCampaignsStats = async (campaignIds, ownerId) => {
  if (!ownerId) throw new Error('ownerId is required');
  if (!campaignIds?.length) return [];

  // Aggregate counts in fewer queries for performance (scoped)
  const msgs = await prisma.campaignMessage.groupBy({
    by: ['campaignId', 'status'],
    where: { ownerId, campaignId: { in: campaignIds } },
    _count: { _all: true }
  });

  const red = await prisma.redemption.groupBy({
    by: ['campaignId'],
    where: { ownerId, campaignId: { in: campaignIds } },
    _count: { _all: true }
  });

  // Shape into per-campaign summary
  const map = new Map();
  for (const id of campaignIds) map.set(id, { sent:0, delivered:0, failed:0, redemptions:0 });

  for (const row of msgs) {
    const entry = map.get(row.campaignId);
    if (!entry) continue;
    if (row.status === 'delivered') entry.delivered += row._count._all;
    if (row.status === 'failed') entry.failed += row._count._all;
    if (['sent','delivered','failed'].includes(row.status)) entry.sent += row._count._all;
  }
  for (const row of red) {
    const entry = map.get(row.campaignId);
    if (entry) entry.redemptions = row._count._all;
  }

  // compute rates
  const out = [];
  for (const [id, v] of map.entries()) {
    out.push({
      campaignId: id,
      ...v,
      deliveredRate: rate(v.delivered, v.sent),
      conversionRate: rate(v.redemptions, v.delivered)
    });
  }
  return out;
};
