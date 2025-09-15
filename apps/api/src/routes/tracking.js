const { Router } = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { cacheDel } = require('../lib/cache'); // safe no-op if Redis off

// Rate limit helpers (Redis-backed if REDIS_URL set, else per-process memory)
const { createLimiter, rateLimitByIp, rateLimitByKey } = require('../lib/ratelimit');

const router = Router();

// ---- Rate limiters ----
const redeemIpLimiter = createLimiter({ keyPrefix: 'rl:track:ip', points: 60, duration: 60 });         // 60/min/IP
const redeemIdLimiter = createLimiter({ keyPrefix: 'rl:track:id', points: 10, duration: 60 });         // 10/min/trackingId
const redeemPostIpLimiter = createLimiter({ keyPrefix: 'rl:track:post:ip', points: 30, duration: 60 }); // 30/min/IP

// OPTIONAL: tiny sanity check to avoid crazy inputs
function isPlausibleTrackingId(s) {
  if (!s || typeof s !== 'string') return false;
  // your generator makes ~12-char base64url; allow 6..64 for safety
  return s.length >= 6 && s.length <= 64;
}

/**
 * PUBLIC: GET /tracking/redeem/:trackingId
 * Returns only existence & redemption state — no IDs are leaked.
 */
router.get(
  '/redeem/:trackingId',
  rateLimitByIp(redeemIpLimiter),
  rateLimitByKey(redeemIdLimiter, (req) => `tid:${req.params.trackingId}`),
  async (req, res, next) => {
    try {
      const { trackingId } = req.params;
      if (!isPlausibleTrackingId(trackingId)) {
        // return 404 to avoid info leak patterns
        return res.status(404).json({ exists: false });
      }

      const msg = await prisma.campaignMessage.findUnique({
        where: { trackingId },
        include: { redemption: true }
      });

      if (!msg) {
        return res.status(404).json({ exists: false });
      }

      res.json({
        exists: true,
        alreadyRedeemed: !!msg.redemption
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PROTECTED: POST /tracking/redeem
 * Body: { trackingId }
 * - Only the message owner can redeem.
 * - Idempotent: prevents double redemptions.
 * - Invalidates campaign stats cache.
 */
router.post(
  '/redeem',
  requireAuth,
  rateLimitByIp(redeemPostIpLimiter),
  async (req, res, next) => {
    try {
      const { trackingId } = req.body || {};
      if (!trackingId) {
        return res.status(400).json({ message: 'trackingId required' });
      }
      if (!isPlausibleTrackingId(trackingId)) {
        return res.status(400).json({ message: 'invalid trackingId' });
      }

      // Find message by trackingId
      const msg = await prisma.campaignMessage.findUnique({ where: { trackingId } });
      if (!msg) {
        // do not leak existence across tenants
        return res.json({ status: 'not_found_or_forbidden', trackingId });
      }

      // OWNER SCOPE: allow redeem only if message belongs to the user
      if (msg.ownerId !== req.user.id) {
        return res.json({ status: 'not_found_or_forbidden', trackingId });
      }

      // Idempotent
      const existing = await prisma.redemption.findUnique({ where: { messageId: msg.id } });
      if (existing) {
        return res.json({
          status: 'already_redeemed',
          trackingId,
          messageId: msg.id,
          campaignId: msg.campaignId,
          contactId: msg.contactId,
          redeemedAt: existing.redeemedAt
        });
      }

      // Create redemption (scoped)
      const rdm = await prisma.redemption.create({
        data: {
          ownerId: req.user.id,
          messageId: msg.id,
          campaignId: msg.campaignId,
          contactId: msg.contactId,
          redeemedByUserId: req.user.id,
          evidenceJson: { ip: req.ip }
        }
      });

      // Cache invalidation → refresh campaign stats in UI
      try {
        const key = `stats:campaign:v1:${req.user.id}:${msg.campaignId}`;
        await cacheDel(key);
      } catch (_) {}

      res.json({
        status: 'redeemed',
        trackingId,
        messageId: msg.id,
        campaignId: msg.campaignId,
        contactId: msg.contactId,
        redeemedAt: rdm.redeemedAt
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
