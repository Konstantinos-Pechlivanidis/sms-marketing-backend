// apps/api/src/services/campaignsList.service.js
const prisma = require('../lib/prisma');

function rate(numer, denom) {
  return denom > 0 ? Number((numer / denom).toFixed(4)) : 0;
}

exports.listCampaigns = async ({
  ownerId, page = 1, pageSize = 20, q, status, dateFrom, dateTo,
  orderBy = 'createdAt', order = 'desc', withStats = true
}) => {
  if (!ownerId) throw new Error('ownerId is required');

  page = Math.max(1, Number(page));
  pageSize = Math.min(100, Math.max(1, Number(pageSize)));

  const where = { ownerId };
  if (q) where.name = { contains: q, mode: 'insensitive' };
  if (status) where.status = status;
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
  }

  const [total, campaigns] = await Promise.all([
    prisma.campaign.count({ where }),
    prisma.campaign.findMany({
      where,
      orderBy: { [orderBy]: order },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, name: true, status: true,
        createdAt: true, scheduledAt: true, startedAt: true, finishedAt: true
      }
    })
  ]);

  if (!withStats || campaigns.length === 0) return { total, items: campaigns };

  const ids = campaigns.map(c => c.id);

  const msgs = await prisma.campaignMessage.groupBy({
    by: ['campaignId', 'status'],
    where: { ownerId, campaignId: { in: ids } },
    _count: { _all: true }
  });

  const reds = await prisma.redemption.groupBy({
    by: ['campaignId'],
    where: { ownerId, campaignId: { in: ids } },
    _count: { _all: true }
  });

  const statsMap = new Map(ids.map(id => [id, { sent:0, delivered:0, failed:0, redemptions:0 }]));
  for (const row of msgs) {
    const s = statsMap.get(row.campaignId);
    if (!s) continue;
    if (row.status === 'delivered') s.delivered += row._count._all;
    if (row.status === 'failed') s.failed += row._count._all;
    if (['sent','delivered','failed'].includes(row.status)) s.sent += row._count._all;
  }
  for (const row of reds) {
    const s = statsMap.get(row.campaignId);
    if (s) s.redemptions = row._count._all;
  }

  const items = campaigns.map(c => {
    const s = statsMap.get(c.id);
    return {
      ...c,
      stats: {
        ...s,
        deliveredRate: rate(s.delivered, s.sent),
        conversionRate: rate(s.redemptions, s.delivered)
      }
    };
  });

  return { total, items };
};
