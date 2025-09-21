// apps/api/src/routes/lists.js
const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { ensureSystemListsForOwner, SLUG } = require('../lib/systemLists');

const router = express.Router();

/* =========================================================
 * Helpers
 * ========================================================= */
const RESERVED_NAMES = new Set(['male', 'female', 'high conversions', 'high conversions (≥2)']);

/* =========================================================
 * POST /lists  (protected)
 * Create a list scoped to the authenticated owner.
 * Blocks reserved/system names.
 * ========================================================= */
router.post('/lists', requireAuth, async (req, res) => {
  try {
    const { name, description } = req.body || {};
    if (!name) return res.status(400).json({ message: 'name required' });

    // Prevent creating manual lists that collide with system lists
    const lower = String(name).trim().toLowerCase();
    if (RESERVED_NAMES.has(lower)) {
      return res.status(409).json({ message: 'reserved list name' });
    }

    const l = await prisma.list.create({
      data: {
        ownerId: req.user.id,
        name,
        description: description || null,
        isSystem: false,
        slug: null,
      },
      select: {
        id: true, name: true, description: true, isSystem: true, slug: true,
        createdAt: true, updatedAt: true,
      }
    });

    res.status(201).json(l);
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ message: 'name already exists' });
    res.status(400).json({ message: e.message || 'bad request' });
  }
});

/* =========================================================
 * GET /lists  (protected)
 * List owner’s lists. Optional: page/pageSize/q
 * Ensures system lists exist (male/female/high-conversions).
 * ========================================================= */
router.get('/lists', requireAuth, async (req, res, next) => {
  try {
    await ensureSystemListsForOwner(req.user.id);

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '50', 10)));
    const q = (req.query.q || '').toString().trim();

    const where = { ownerId: req.user.id };
    if (q) where.name = { contains: q, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      prisma.list.findMany({
        where,
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, name: true, description: true, isSystem: true, slug: true,
          createdAt: true, updatedAt: true,
        }
      }),
      prisma.list.count({ where }),
    ]);

    res.json({ items, total, page, pageSize });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
 * GET /lists/:listId  (protected)
 * Fetch a single list (scoped)
 * ========================================================= */
router.get('/lists/:listId', requireAuth, async (req, res) => {
  const listId = Number(req.params.listId);
  if (!listId) return res.status(400).json({ message: 'invalid listId' });

  const list = await prisma.list.findFirst({
    where: { id: listId, ownerId: req.user.id },
    select: { id: true, name: true, description: true, isSystem: true, slug: true }
  });
  if (!list) return res.status(404).json({ message: 'not found' });

  res.json(list);
});

/* =========================================================
 * POST /lists/:listId/contacts/:contactId  (protected)
 * Add a contact to a list (scoped). System lists are automatic → block.
 * Idempotency: relies on @@unique([listId, contactId]) at DB level.
 * ========================================================= */
router.post('/lists/:listId/contacts/:contactId', requireAuth, async (req, res) => {
  const listId = Number(req.params.listId);
  const contactId = Number(req.params.contactId);
  if (!listId || !contactId) return res.status(400).json({ message: 'invalid ids' });

  try {
    // Validate ownership of both resources
    const [list, contact] = await Promise.all([
      prisma.list.findFirst({
        where: { id: listId, ownerId: req.user.id },
        select: { id: true, isSystem: true, slug: true }
      }),
      prisma.contact.findFirst({ where: { id: contactId, ownerId: req.user.id } })
    ]);
    if (!list || !contact) return res.status(404).json({ message: 'list or contact not found' });

    if (list.isSystem) {
      return res.status(409).json({ message: 'System list membership is automatic' });
    }

    const m = await prisma.listMembership.create({ data: { listId, contactId } });
    res.status(201).json(m);
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ message: 'contact already in list' });
    if (e.code === 'P2003') return res.status(404).json({ message: 'list or contact not found' });
    res.status(400).json({ message: e.message || 'bad request' });
  }
});

/* =========================================================
 * DELETE /lists/:listId/contacts/:contactId  (protected)
 * Remove a contact from a list (scoped). System lists are automatic → block.
 * ========================================================= */
router.delete('/lists/:listId/contacts/:contactId', requireAuth, async (req, res) => {
  const listId = Number(req.params.listId);
  const contactId = Number(req.params.contactId);
  if (!listId || !contactId) return res.status(400).json({ message: 'invalid ids' });

  const list = await prisma.list.findFirst({
    where: { id: listId, ownerId: req.user.id },
    select: { id: true, isSystem: true }
  });
  if (!list) return res.status(404).json({ message: 'list not found' });

  if (list.isSystem) {
    return res.status(409).json({ message: 'System list membership is automatic' });
  }

  await prisma.listMembership.deleteMany({ where: { listId, contactId } });
  res.json({ ok: true });
});

/* =========================================================
 * GET /lists/:listId/contacts  (protected)
 * Get members of a list (scoped).
 * Supports "virtual" High Conversions: if slug === 'high-conversions',
 * we compute by redemptions count (>= ?minConversions, default 2).
 * Optional filters:
 *  - isSubscribed: "true" | "false"
 *  - page/pageSize (pagination)
 * ========================================================= */
router.get('/lists/:listId/contacts', requireAuth, async (req, res, next) => {
  try {
    const listId = Number(req.params.listId);
    if (!listId) return res.status(400).json({ message: 'invalid listId' });

    const list = await prisma.list.findFirst({
      where: { id: listId, ownerId: req.user.id },
      select: { id: true, isSystem: true, slug: true }
    });
    if (!list) return res.status(404).json({ message: 'list not found' });

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize || '50', 10)));
    const sub = (req.query.isSubscribed || '').toString().toLowerCase();

    const subFilter =
      sub === 'true' ? true :
      sub === 'false' ? false :
      undefined;

    // Virtual list: High Conversions (slug)
    if (list.slug === SLUG.HIGH) {
      let minConversions = req.query.minConversions ? Number(req.query.minConversions) : 2;
      if (!Number.isFinite(minConversions) || minConversions < 1) minConversions = 2;

      // groupBy redemptions → contact ids with count >= min
      const groups = await prisma.redemption.groupBy({
        by: ['contactId'],
        where: { ownerId: req.user.id },
        _count: { _all: true },
        having: { contactId: { _count: { gte: minConversions } } }
      });
      const convIds = groups.map(g => g.contactId);
      if (convIds.length === 0) {
        return res.json({ items: [], total: 0, page, pageSize });
      }

      const whereContact = {
        id: { in: convIds },
        ownerId: req.user.id,
        ...(typeof subFilter === 'boolean' ? { isSubscribed: subFilter } : {})
      };

      const [items, total] = await Promise.all([
        prisma.contact.findMany({
          where: whereContact,
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
        prisma.contact.count({ where: whereContact }),
      ]);

      return res.json({ items, total, page, pageSize });
    }

    // Normal / System (male/female) lists → membership-based
    const membershipWhere = {
      listId,
      ...(typeof subFilter === 'boolean' ? { contact: { isSubscribed: subFilter } } : {})
    };

    const [members, total] = await Promise.all([
      prisma.listMembership.findMany({
        where: membershipWhere,
        include: {
          contact: {
            select: {
              id: true, phone: true, email: true,
              firstName: true, lastName: true,
              gender: true, birthday: true,
              isSubscribed: true, unsubscribedAt: true,
            }
          }
        },
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.listMembership.count({ where: membershipWhere })
    ]);

    const items = members.map(m => m.contact).filter(Boolean);
    res.json({ items, total, page, pageSize });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
