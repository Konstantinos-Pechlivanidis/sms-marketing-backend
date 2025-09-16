// apps/api/src/routes/contacts.js
const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const crypto = require('node:crypto');
const { scoped } = require('../lib/policies');

// Rate limit helpers (Redis-backed if REDIS_URL set, else per-process memory)
const { createLimiter, rateLimitByIp, rateLimitByKey } = require('../lib/ratelimit');

// Strong phone validation / normalization
const { normalizeToE164, isE164 } = require('../lib/phone');

const router = express.Router();

// Default country for parsing non-E.164 inputs (can be overridden via env)
const DEFAULT_COUNTRY = process.env.DEFAULT_PHONE_COUNTRY || 'GR';

/** Create a random raw token and return its SHA-256 hex hash (for storage). */
function newUnsubTokenHash() {
  const raw = crypto.randomBytes(16).toString('hex'); // 32-char raw token
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

/** Hash helper for incoming public tokens */
function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/* -------------------- Rate limiters -------------------- */
// Write ops (protected): 60 req/min per IP (covers create/update/delete)
const writeIpLimiter = createLimiter({ keyPrefix: 'rl:contacts:write:ip', points: 60, duration: 60 });

// Public unsubscribe: 20 req/min per IP
const unsubIpLimiter = createLimiter({ keyPrefix: 'rl:unsub:ip', points: 20, duration: 60 });
// Public unsubscribe per token: 5 req / 24h
const unsubTokenLimiter = createLimiter({ keyPrefix: 'rl:unsub:token', points: 5, duration: 86400 });

/* ---------------------------------------------------------
 * POST /contacts  (protected)
 * Create a contact scoped to the authenticated owner.
 * Stores phone in strict E.164 format.
 * --------------------------------------------------------- */
router.post(
  '/contacts',
  requireAuth,
  rateLimitByIp(writeIpLimiter),
  async (req, res, next) => {
    try {
      const { phone, email, firstName, lastName } = req.body || {};
      if (!phone) return res.status(400).json({ message: 'phone required' });

      // Normalize & validate to E.164
      let e164;
      if (isE164(phone)) {
        e164 = phone;
      } else {
        const norm = normalizeToE164(phone, DEFAULT_COUNTRY);
        if (!norm.ok) {
          return res.status(400).json({ message: `invalid phone (${norm.reason})` });
        }
        e164 = norm.e164;
      }

      // Prepare unsubscribe token hash if absent; we don't return raw token here.
      const { hash } = newUnsubTokenHash();

      const contact = await prisma.contact.create({
        data: {
          ownerId: req.user.id, // <-- SCOPE
          phone: e164,
          email: email || null,
          firstName: firstName || null,
          lastName: lastName || null,
          unsubscribeTokenHash: hash // store only the hash (raw can be rotated later)
        }
      });

      res.status(201).json(contact);
    } catch (e) {
      // P2002 => unique violation (unique per ownerId, phone)
      if (e.code === 'P2002') {
        return res.status(409).json({ message: 'phone already exists' });
      }
      next(e);
    }
  }
);

/* ---------------------------------------------------------
 * GET /contacts  (protected)
 * List contacts (paginated + search).
 * --------------------------------------------------------- */
router.get('/contacts', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '20', 10)));
    const q = (req.query.q || '').toString().trim();
    const sub = (req.query.isSubscribed || '').toString().toLowerCase();

    const where = { ...scoped(req.user.id) };

    if (q) {
      // Searching against stored E.164 phones still works with "contains",
      // and also supports name/email searches.
      where.OR = [
        { phone: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (sub === 'true') where.isSubscribed = true;
    if (sub === 'false') where.isSubscribed = false;

    const [items, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.contact.count({ where })
    ]);

    res.json({ items, total, page, pageSize });
  } catch (e) {
    next(e);
  }
});

/* ---------------------------------------------------------
 * GET /contacts/:id  (protected)
 * Fetch one contact scoped to owner.
 * --------------------------------------------------------- */
router.get('/contacts/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: 'invalid id' });

    const contact = await prisma.contact.findFirst({
      where: { id, ownerId: req.user.id } // SCOPE
    });

    if (!contact) return res.status(404).json({ message: 'not found' });
    res.json(contact);
  } catch (e) {
    next(e);
  }
});

/* ---------------------------------------------------------
 * PUT /contacts/:id  (protected)
 * Update a contact (scoped). Phone is re-validated and stored as E.164.
 * --------------------------------------------------------- */
router.put(
  '/contacts/:id',
  requireAuth,
  rateLimitByIp(writeIpLimiter),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ message: 'invalid id' });

      const { phone, email, firstName, lastName, isSubscribed } = req.body || {};
      const data = {};

      if (typeof phone !== 'undefined') {
        if (phone === null || phone === '') {
          return res.status(400).json({ message: 'phone cannot be empty' });
        }
        let e164;
        if (isE164(phone)) {
          e164 = phone;
        } else {
          const norm = normalizeToE164(phone, DEFAULT_COUNTRY);
          if (!norm.ok) return res.status(400).json({ message: `invalid phone (${norm.reason})` });
          e164 = norm.e164;
        }
        data.phone = e164;
      }

      if (typeof email !== 'undefined') data.email = email || null;
      if (typeof firstName !== 'undefined') data.firstName = firstName || null;
      if (typeof lastName !== 'undefined') data.lastName = lastName || null;

      // Optional allow toggling isSubscribed from admin
      if (typeof isSubscribed !== 'undefined') {
        data.isSubscribed = Boolean(isSubscribed);
        if (data.isSubscribed === false) {
          data.unsubscribedAt = new Date(); // mark time when admin unsubscribes
        } else {
          data.unsubscribedAt = null;
        }
      }

      // Guard owner scope
      const r = await prisma.contact.updateMany({
        where: { id, ownerId: req.user.id },
        data
      });

      if (r.count === 0) return res.status(404).json({ message: 'not found' });

      const updated = await prisma.contact.findFirst({
        where: { id, ownerId: req.user.id }
      });

      res.json(updated);
    } catch (e) {
      if (e.code === 'P2002') return res.status(409).json({ message: 'phone already exists' });
      next(e);
    }
  }
);

/* ---------------------------------------------------------
 * DELETE /contacts/:id  (protected)
 * Safe delete via deleteMany with owner scope.
 * --------------------------------------------------------- */
router.delete(
  '/contacts/:id',
  requireAuth,
  rateLimitByIp(writeIpLimiter),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ message: 'invalid id' });

      const r = await prisma.contact.deleteMany({
        where: { id, ownerId: req.user.id } // SCOPE
      });

      if (r.count === 0) return res.status(404).json({ message: 'not found' });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);

/* ---------------------------------------------------------
 * POST /contacts/unsubscribe  (public)
 * Body: { token: "<raw token>" }
 * We only store SHA-256(token) in DB; this endpoint compares hashes.
 * Idempotent: always returns { ok: true } to avoid leaking existence.
 * --------------------------------------------------------- */
router.post(
  '/contacts/unsubscribe',
  rateLimitByIp(unsubIpLimiter),
  rateLimitByKey(unsubTokenLimiter, (req) => (req.body?.token || '').slice(0, 64)),
  async (req, res, next) => {
    try {
      const { token } = req.body || {};
      if (!token) return res.status(400).json({ message: 'token required' });

      const hash = sha256Hex(token);

      const contact = await prisma.contact.findFirst({
        where: { unsubscribeTokenHash: hash, isSubscribed: true }
      });

      if (!contact) return res.json({ ok: true }); // idempotent/no-leak

      await prisma.contact.update({
        where: { id: contact.id },
        data: { isSubscribed: false, unsubscribedAt: new Date() }
      });

      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
