const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { rateLimitByKey } = require('../lib/ratelimit');

const limitByTracking = rateLimitByKey('offer:trk', { points: 20, duration: 60 }); // 20/min per trackingId

router.get('/tracking/offer/:trackingId', limitByTracking, async (req, res, next) => {
  try {
    const { trackingId } = req.params;
    if (!trackingId || trackingId.length < 4) return res.status(404).json({ message: 'Not found' });

    const msg = await prisma.campaignMessage.findFirst({
      where: { trackingId },
      include: { campaign: { include: { owner: true } } }
    });
    if (!msg) return res.status(404).json({ message: 'Not found' });

    // idempotent "visit" logging (create if not exists)
    await prisma.redemption.upsert({
      where: { messageId: msg.id }, // unique index
      update: { lastVisitedAt: new Date(), visits: { increment: 1 } },
      create: { messageId: msg.id, campaignId: msg.campaignId, ownerId: msg.ownerId, visits: 1, lastVisitedAt: new Date() }
    });

    const storeName = msg.campaign?.owner?.company || msg.campaign?.name || 'Our Store';
    const offerText = msg.text; // ή παράγουμε preview από template

    res.json({ trackingId, storeName, offerText });
  } catch (e) { next(e); }
});

module.exports = router;
