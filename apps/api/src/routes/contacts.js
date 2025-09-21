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

// System lists (male/female) helpers
// create file ../lib/systemLists.js with ensureSystemListsForOwner & syncGenderMembership
const { ensureSystemListsForOwner, syncGenderMembership } = require('../lib/systemLists');

const router = express.Router();

// =============================
// Config
// =============================
const DEFAULT_COUNTRY = process.env.DEFAULT_PHONE_COUNTRY || 'GR';
const ENROLL_SECRET = process.env.ENROLL_SECRET || 'change-me-now-please';
const ENROLL_CODE_TTL_DAYS = Number(process.env.ENROLL_CODE_TTL_DAYS || 180);

// =============================
// Helpers
// =============================

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

/** Safe parse of a date-like value (YYYY-MM-DD allowed). Returns Date | null | undefined. */
function parseBirthday(val) {
  if (val === null) return null;
  if (typeof val === 'undefined' || val === '') return undefined;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

/** Normalize gender to allowed enum. Returns one of: male|female|other|unknown */
function normalizeGender(g) {
  const s = String(g || '').toLowerCase();
  if (s === 'male' || s === 'm') return 'male';
  if (s === 'female' || s === 'f') return 'female';
  if (s === 'other') return 'other';
  return 'unknown';
}

/** Enrollment Code: HMAC-signed blob "ownerId.timestamp" → base64url(ownerId.ts.sig) */
function signEnrollCode(ownerId) {
  const ts = Date.now();
  const data = `${ownerId}.${ts}`;
  const sig = crypto.createHmac('sha256', ENROLL_SECRET).update(data).digest('hex');
  const token = Buffer.from(`${data}.${sig}`).toString('base64url');
  return token;
}

function verifyEnrollCode(token) {
  try {
    const raw = Buffer.from(String(token), 'base64url').toString('utf8');
    const [ownerIdStr, tsStr, sig] = raw.split('.');
    const ownerId = Number(ownerIdStr);
    const ts = Number(tsStr);
    if (!ownerId || !ts || !sig) return { ok: false, reason: 'malformed' };

    const expect = crypto.createHmac('sha256', ENROLL_SECRET)
      .update(`${ownerId}.${ts}`).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(sig))) {
      return { ok: false, reason: 'bad-signature' };
    }

    const ageDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
    if (ageDays > ENROLL_CODE_TTL_DAYS) {
      return { ok: false, reason: 'expired' };
    }

    return { ok: true, ownerId };
  } catch (_e) {
    return { ok: false, reason: 'decode-failed' };
  }
}

// =============================
// Rate limiters
// =============================

// Write ops (protected): 60 req/min per IP (covers create/update/delete)
const writeIpLimiter = createLimiter({ keyPrefix: 'rl:contacts:write:ip', points: 60, duration: 60 });

// Public unsubscribe: 20 req/min per IP; and per-token 5 / day
const unsubIpLimiter = createLimiter({ keyPrefix: 'rl:unsub:ip', points: 20, duration: 60 });
const unsubTokenLimiter = createLimiter({ keyPrefix: 'rl:unsub:token', points: 5, duration: 86400 });

// Public enrollment: 40 req/min per IP; per-code 100 / day
const enrollIpLimiter = createLimiter({ keyPrefix: 'rl:enroll:ip', points: 40, duration: 60 });
const enrollCodeLimiter = createLimiter({ keyPrefix: 'rl:enroll:code', points: 100, duration: 86400 });

// =============================
// PROTECTED: Create contact
// =============================
router.post(
  '/contacts',
  requireAuth,
  rateLimitByIp(writeIpLimiter),
  async (req, res, next) => {
    try {
      const {
        phone,
        email,
        firstName,
        lastName,
        gender,
        birthday,
      } = req.body || {};

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

      const created = await prisma.contact.create({
        data: {
          ownerId: req.user.id, // <-- SCOPE
          phone: e164,
          email: email || null,
          firstName: firstName || null,
          lastName: lastName || null,
          gender: normalizeGender(gender),
          birthday: parseBirthday(birthday) ?? null,
          unsubscribeTokenHash: hash,
        },
        select: {
          id: true, phone: true, email: true,
          firstName: true, lastName: true,
          gender: true, birthday: true,
          isSubscribed: true, unsubscribedAt: true,
          ownerId: true,
        }
      });

      // Auto-manage Male/Female system lists
      await syncGenderMembership(created);

      res.status(201).json(created);
    } catch (e) {
      if (e.code === 'P2002') {
        return res.status(409).json({ message: 'phone already exists' });
      }
      next(e);
    }
  }
);


// =============================
// PROTECTED: List contacts (with listId, gender, birthday, minConversions)
router.get('/contacts', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '20', 10)));
    const q = (req.query.q || '').toString().trim();
    const sub = (req.query.isSubscribed || '').toString().toLowerCase();

    let listId = req.query.listId ? Number(req.query.listId) : undefined;
    const gender = req.query.gender ? normalizeGender(req.query.gender) : undefined;
    const bFrom = req.query.birthdayFrom ? new Date(req.query.birthdayFrom) : undefined;
    const bTo   = req.query.birthdayTo   ? new Date(req.query.birthdayTo)   : undefined;

    // explicit minConversions param also supported
    let minConversions = req.query.minConversions ? Number(req.query.minConversions) : undefined;
    if (Number.isNaN(minConversions) || minConversions <= 0) minConversions = undefined;

    // If a system list with slug = high-conversions is selected, translate to minConversions=2
    if (listId) {
      const selected = await prisma.list.findFirst({
        where: { id: listId, ownerId: req.user.id },
        select: { id: true, isSystem: true, slug: true }
      });
      if (selected?.isSystem && selected.slug === 'high-conversions') {
        minConversions = minConversions ?? 2; // default
        listId = undefined; // do not filter by membership; we'll use conversions
      }
    }

    const where = { ownerId: req.user.id };

    if (q) {
      where.OR = [
        { phone:     { contains: q, mode: 'insensitive' } },
        { email:     { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName:  { contains: q, mode: 'insensitive' } },
      ];
    }

    if (sub === 'true') where.isSubscribed = true;
    if (sub === 'false') where.isSubscribed = false;

    if (gender && gender !== 'unknown') {
      where.gender = gender;
    }
    if (bFrom || bTo) {
      where.birthday = {};
      if (bFrom && !Number.isNaN(bFrom.getTime())) where.birthday.gte = bFrom;
      if (bTo   && !Number.isNaN(bTo.getTime()))   where.birthday.lte = bTo;
    }

    // Either filter by a normal list membership...
    if (listId) {
      where.listMemberships = { some: { listId } };
    }

    // ...or by conversions (redemptions) >= N (virtual list)
    let convIds = undefined;
    if (minConversions) {
      const groups = await prisma.redemption.groupBy({
        by: ['contactId'],
        where: { ownerId: req.user.id },
        _count: { _all: true },
        having: {
          contactId: { _count: { gte: minConversions } }
        }
      });
      convIds = groups.map(g => g.contactId);
      if (convIds.length === 0) {
        return res.json({ items: [], total: 0, page, pageSize });
      }
      // restrict to those ids
      where.id = { in: convIds };
    }

    const [items, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, phone: true, email: true,
          firstName: true, lastName: true,
          gender: true, birthday: true,
          isSubscribed: true, unsubscribedAt: true,
        }
      }),
      prisma.contact.count({ where })
    ]);

    res.json({ items, total, page, pageSize });
  } catch (e) {
    next(e);
  }
});


// =============================
// PROTECTED: Get one contact
// =============================
router.get('/contacts/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: 'invalid id' });

    const contact = await prisma.contact.findFirst({
      where: { id, ownerId: req.user.id },
      select: {
        id: true, phone: true, email: true,
        firstName: true, lastName: true,
        gender: true, birthday: true,
        isSubscribed: true, unsubscribedAt: true,
      }
    });

    if (!contact) return res.status(404).json({ message: 'not found' });
    res.json(contact);
  } catch (e) {
    next(e);
  }
});

// =============================
// PROTECTED: Update contact
// =============================
router.put(
  '/contacts/:id',
  requireAuth,
  rateLimitByIp(writeIpLimiter),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ message: 'invalid id' });

      const { phone, email, firstName, lastName, isSubscribed, gender, birthday } = req.body || {};
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

      if (typeof email !== 'undefined')     data.email = email || null;
      if (typeof firstName !== 'undefined') data.firstName = firstName || null;
      if (typeof lastName !== 'undefined')  data.lastName  = lastName || null;

      if (typeof gender !== 'undefined') {
        data.gender = normalizeGender(gender);
      }
      if (typeof birthday !== 'undefined') {
        const parsed = parseBirthday(birthday);
        if (parsed === undefined) return res.status(400).json({ message: 'invalid birthday' });
        data.birthday = parsed; // null allowed to clear
      }

      if (typeof isSubscribed !== 'undefined') {
        data.isSubscribed = Boolean(isSubscribed);
        if (data.isSubscribed === false) {
          data.unsubscribedAt = new Date();
        } else {
          data.unsubscribedAt = null;
        }
      }

      // Update with owner scope
      const before = await prisma.contact.findFirst({ where: { id, ownerId: req.user.id } });
      if (!before) return res.status(404).json({ message: 'not found' });

      const updated = await prisma.contact.update({
        where: { id },
        data,
        select: {
          id: true, phone: true, email: true,
          firstName: true, lastName: true,
          gender: true, birthday: true,
          isSubscribed: true, unsubscribedAt: true,
          ownerId: true,
        }
      });

      // If gender changed, re-sync system list membership
      if (before.gender !== updated.gender) {
        await syncGenderMembership(updated);
      }

      res.json(updated);
    } catch (e) {
      if (e.code === 'P2002') return res.status(409).json({ message: 'phone already exists' });
      next(e);
    }
  }
);

// =============================
// PROTECTED: Delete contact
// =============================
router.delete(
  '/contacts/:id',
  requireAuth,
  rateLimitByIp(writeIpLimiter),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ message: 'invalid id' });

      const r = await prisma.contact.deleteMany({
        where: { id, ownerId: req.user.id }
      });

      if (r.count === 0) return res.status(404).json({ message: 'not found' });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);

// =============================
// PUBLIC: Unsubscribe (idempotent)
// =============================
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

// =============================
// PROTECTED: Generate store enroll code (for QR)
// =============================
router.post(
  '/contacts/enroll-code',
  requireAuth,
  async (req, res, next) => {
    try {
      // Ensure system lists exist for this owner (nice to have)
      await ensureSystemListsForOwner(req.user.id);

      const code = signEnrollCode(req.user.id);
      res.json({
        code,
        // Frontend can embed this in a QR that opens a public enroll page
        // e.g., `${APP_PUBLIC_URL}/enroll?code=${code}`
      });
    } catch (e) {
      next(e);
    }
  }
);

// =============================
// PUBLIC: Resolve enroll code (for the public form header)
// =============================
router.get(
  '/contacts/enroll/:code',
  rateLimitByIp(enrollIpLimiter),
  rateLimitByKey(enrollCodeLimiter, (req) => req.params.code || ''),
  async (req, res, next) => {
    try {
      const { code } = req.params;
      const v = verifyEnrollCode(code);
      if (!v.ok) return res.status(400).json({ message: 'invalid code' });

      const owner = await prisma.user.findUnique({
        where: { id: v.ownerId },
        select: { id: true, company: true, senderName: true, email: true }
      });
      if (!owner) return res.status(404).json({ message: 'store not found' });

      // Optionally, ensure system lists exist (lazy)
      await ensureSystemListsForOwner(owner.id);

      res.json({
        ownerId: owner.id,
        storeName: owner.company || owner.senderName || owner.email,
      });
    } catch (e) {
      next(e);
    }
  }
);

// =============================
// PUBLIC: Enroll (create/update) contact for a store by code
// =============================
router.post(
  '/contacts/enroll',
  rateLimitByIp(enrollIpLimiter),
  rateLimitByKey(enrollCodeLimiter, (req) => (req.body?.code || '').slice(0, 256)),
  async (req, res, next) => {
    try {
      const { code, phone, email, firstName, lastName, gender, birthday } = req.body || {};
      if (!code)  return res.status(400).json({ message: 'code required' });
      if (!phone) return res.status(400).json({ message: 'phone required' });

      const v = verifyEnrollCode(code);
      if (!v.ok) return res.status(400).json({ message: 'invalid code' });
      const ownerId = v.ownerId;

      // Normalize phone
      let e164;
      if (isE164(phone)) {
        e164 = phone;
      } else {
        const norm = normalizeToE164(phone, DEFAULT_COUNTRY);
        if (!norm.ok) return res.status(400).json({ message: `invalid phone (${norm.reason})` });
        e164 = norm.e164;
      }

      // Ensure system lists exist
      await ensureSystemListsForOwner(ownerId);

      // Upsert: if the phone already exists for this owner, update fields & resubscribe
      const existing = await prisma.contact.findFirst({
        where: { ownerId, phone: e164 },
        select: { id: true, gender: true, ownerId: true }
      });

      let contact;
      if (existing) {
        contact = await prisma.contact.update({
          where: { id: existing.id },
          data: {
            email: email ?? undefined,
            firstName: firstName ?? undefined,
            lastName: lastName ?? undefined,
            gender: normalizeGender(gender),
            birthday: parseBirthday(birthday),
            isSubscribed: true,
            unsubscribedAt: null,
          },
          select: {
            id: true, phone: true, email: true,
            firstName: true, lastName: true,
            gender: true, birthday: true,
            isSubscribed: true, unsubscribedAt: true,
            ownerId: true,
          }
        });
      } else {
        const { hash } = newUnsubTokenHash();
        contact = await prisma.contact.create({
          data: {
            ownerId,
            phone: e164,
            email: email || null,
            firstName: firstName || null,
            lastName: lastName || null,
            gender: normalizeGender(gender),
            birthday: parseBirthday(birthday) ?? null,
            isSubscribed: true,
            unsubscribeTokenHash: hash,
          },
          select: {
            id: true, phone: true, email: true,
            firstName: true, lastName: true,
            gender: true, birthday: true,
            isSubscribed: true, unsubscribedAt: true,
            ownerId: true,
          }
        });
      }

      // Auto-manage Male/Female list membership
      await syncGenderMembership(contact);

      res.status(existing ? 200 : 201).json(contact);
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
