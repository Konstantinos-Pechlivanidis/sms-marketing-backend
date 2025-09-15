const { Router } = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { cacheDel } = require('../lib/cache'); // safe no-op αν δεν υπάρχει Redis

const router = Router();

// OPTIONAL: tiny sanity check to avoid crazy inputs
function isPlausibleTrackingId(s) {
  if (!s || typeof s !== 'string') return false;
  // your generator makes ~12-char base64url; επιτρέπουμε 6..64 για ασφάλεια
  return s.length >= 6 && s.length <= 64;
}

/**
 * PUBLIC: GET /tracking/redeem/:trackingId
 * Επιστρέφει μόνο ύπαρξη & αν έχει εξαργυρωθεί — δεν εκθέτουμε IDs.
 */
router.get('/redeem/:trackingId', async (req, res, next) => {
  try {
    const { trackingId } = req.params;
    if (!isPlausibleTrackingId(trackingId)) {
      return res.status(404).json({ exists: false }); // μην κάνεις 400→ μη διαρρεύσει info
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
});

/**
 * PROTECTED: POST /tracking/redeem
 * Body: { trackingId }
 * - Μόνο ο owner του μηνύματος μπορεί να κάνει redeem.
 * - Γράφει Redemption με ownerId + αποτρέπουμε διπλές εξαργυρώσεις.
 * - Κάνει cache invalidation στα stats της καμπάνιας.
 */
router.post('/redeem', requireAuth, async (req, res, next) => {
  try {
    const { trackingId } = req.body || {};
    if (!trackingId) {
      return res.status(400).json({ message: 'trackingId required' });
    }
    if (!isPlausibleTrackingId(trackingId)) {
      return res.status(400).json({ message: 'invalid trackingId' });
    }

    // Βρες μήνυμα από trackingId
    const msg = await prisma.campaignMessage.findUnique({ where: { trackingId } });
    if (!msg) {
      // Μην διαρρέεις ύπαρξη σε άλλους tenants
      return res.json({ status: 'not_found_or_forbidden', trackingId });
    }

    // OWNER SCOPE: επιτρέπεται redeem μόνο αν το μήνυμα είναι του χρήστη
    if (msg.ownerId !== req.user.id) {
      return res.json({ status: 'not_found_or_forbidden', trackingId });
    }

    // Idempotent: ήδη εξαργυρώθηκε;
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

    // Δημιούργησε redemption (scoped)
    const rdm = await prisma.redemption.create({
      data: {
        ownerId: req.user.id,         // << NEW: scope owner
        messageId: msg.id,
        campaignId: msg.campaignId,
        contactId: msg.contactId,
        redeemedByUserId: req.user.id,
        evidenceJson: { ip: req.ip }
      }
    });

    // Cache invalidation → να φρεσκάρουν τα stats της καμπάνιας στο UI
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
});

module.exports = router;
