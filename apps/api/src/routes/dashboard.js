// apps/api/src/routes/dashboard.js
const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { createLimiter, rateLimitByIp } = require('../lib/ratelimit');

const router = express.Router();

// 60 req/min per IP for this analytics endpoint (cheap guard)
const kpiLimiter = createLimiter({ keyPrefix: 'rl:dashboard:kpis', points: 60, duration: 60 });

router.use(requireAuth);

/**
 * GET /api/dashboard/kpis
 * Returns aggregate metrics for the authenticated owner.
 *
 * Response:
 * {
 *   totalCampaigns, totalMessages, sent, delivered, failed,
 *   deliveredRate, conversion, conversionRate
 * }
 */
router.get('/dashboard/kpis', rateLimitByIp(kpiLimiter), async (req, res, next) => {
  try {
    const ownerId = req.user.id;

    // Parallel queries for speed
    const [
      totalCampaigns,
      totalMessages,
      byStatus,
      redemptionsAgg
    ] = await Promise.all([
      prisma.campaign.count({ where: { ownerId } }),
      prisma.campaignMessage.count({ where: { ownerId } }),
      prisma.campaignMessage.groupBy({
        by: ['status'],
        where: { ownerId },
        _count: { _all: true }
      }),
      prisma.redemption.aggregate({
        where: { ownerId },
        _sum: { visits: true }
      })
    ]);

    const counts = Object.fromEntries(byStatus.map(s => [s.status, s._count._all]));
    const sent = (counts.sent || 0) + (counts.delivered || 0); // sent includes delivered
    const delivered = counts.delivered || 0;
    const failed = counts.failed || 0;

    const conversion = redemptionsAgg._sum.visits || 0;
    const deliveredRate = sent ? delivered / sent : 0;
    const conversionRate = delivered ? conversion / delivered : 0;

    res.json({
      totalCampaigns,
      totalMessages,
      sent,
      delivered,
      failed,
      deliveredRate,
      conversion,
      conversionRate
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
