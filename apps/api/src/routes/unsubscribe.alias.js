const express = require('express');
const router = express.Router();
const { rateLimitByIp } = require('../lib/ratelimit');
const prisma = require('../lib/prisma');
const crypto = require('crypto');

const byIp = rateLimitByIp('unsub:ip', { points: 20, duration: 60 });

router.post('/unsubscribe', byIp, async (req, res, next) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.json({ ok: true }); // idempotent

    const hash = crypto.createHash('sha256').update(code).digest('hex');
    const contact = await prisma.contact.findFirst({
      where: { unsubscribeTokenHash: hash, isSubscribed: true }
    });
    if (contact) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { isSubscribed: false, unsubscribedAt: new Date() }
      });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
