// apps/api/src/services/campaignStats.service.js
const prisma = require('../lib/prisma');

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

exports.getCampaignStats = async (campaignId, ownerId) => {
  if (!ownerId) throw new Error('ownerId is required');

  const owned = await prisma.campaign.findFirst({
    where: { id: campaignId, ownerId },
    select: { id: true }
  });
  if (!owned) {
    const err = new Error('campaign not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const [sent, delivered, failed, redemptions] = await Promise.all([
    prisma.campaignMessage.count({
      where: { ownerId, campaignId, status: { in: ['sent','delivered','failed'] } }
    }),
    prisma.campaignMessage.count({ where: { ownerId, campaignId, status: 'delivered' } }),
    prisma.campaignMessage.count({ where: { ownerId, campaignId, status: 'failed' } }),
    prisma.redemption.count({ where: { ownerId, campaignId } })
  ]);

  // recipients who later unsubscribed, starting from first sent timestamp
  const firstSentAt = await getFirstSentAt(campaignId, ownerId);
  let unsubscribes = 0;
  if (firstSentAt) {
    const recipients = await prisma.campaignMessage.findMany({
      where: { ownerId, campaignId },
      select: { contactId: true },
      distinct: ['contactId']
    });
    const ids = recipients.map(r => r.contactId);
    if (ids.length) {
      unsubscribes = await prisma.contact.count({
        where: { ownerId, id: { in: ids }, unsubscribedAt: { gte: firstSentAt } }
      });
    }
  }

  return {
    campaignId,
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

exports.getManyCampaignsStats = async (campaignIds, ownerId) => {
  if (!ownerId) throw new Error('ownerId is required');
  if (!campaignIds?.length) return [];

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

  const map = new Map(campaignIds.map(id => [id, { sent:0, delivered:0, failed:0, redemptions:0 }]));
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

  return [...map.entries()].map(([id, v]) => ({
    campaignId: id,
    ...v,
    deliveredRate: rate(v.delivered, v.sent),
    conversionRate: rate(v.redemptions, v.delivered)
  }));
};
