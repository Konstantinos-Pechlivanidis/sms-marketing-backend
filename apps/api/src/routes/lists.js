const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { scoped } = require('../lib/policies');

const router = express.Router();

/* =========================================================
 * POST /lists  (protected)
 * Create a list scoped to the authenticated owner.
 * Uniqueness: @@unique([ownerId, name]) in Prisma
 * ========================================================= */
router.post('/lists', requireAuth, async (req, res) => {
  try {
    const { name, description } = req.body || {};
    if (!name) return res.status(400).json({ message: 'name required' });

    const l = await prisma.list.create({
      data: {
        ownerId: req.user.id,       // << SCOPE
        name,
        description: description || null
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
 * q searches by name (case-insensitive)
 * ========================================================= */
router.get('/lists', requireAuth, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '50', 10)));
  const q = (req.query.q || '').toString().trim();

  const where = { ...scoped(req.user.id) };
  if (q) where.name = { contains: q, mode: 'insensitive' };

  const [items, total] = await Promise.all([
    prisma.list.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.list.count({ where })
  ]);

  res.json({ items, total, page, pageSize });
});

/* =========================================================
 * GET /lists/:listId  (protected)
 * Fetch a single list (scoped)
 * ========================================================= */
router.get('/lists/:listId', requireAuth, async (req, res) => {
  const listId = Number(req.params.listId);
  if (!listId) return res.status(400).json({ message: 'invalid listId' });

  const list = await prisma.list.findFirst({
    where: { id: listId, ownerId: req.user.id } // << SCOPE
  });
  if (!list) return res.status(404).json({ message: 'not found' });

  res.json(list);
});

/* =========================================================
 * POST /lists/:listId/contacts/:contactId  (protected)
 * Add a contact to a list (scoped). Validates both belong to owner.
 * Idempotency: relies on @@unique([listId, contactId]) at DB level.
 * ========================================================= */
router.post('/lists/:listId/contacts/:contactId', requireAuth, async (req, res) => {
  const listId = Number(req.params.listId);
  const contactId = Number(req.params.contactId);
  if (!listId || !contactId) return res.status(400).json({ message: 'invalid ids' });

  try {
    // Validate ownership of both resources
    const [list, contact] = await Promise.all([
      prisma.list.findFirst({ where: { id: listId, ownerId: req.user.id } }),
      prisma.contact.findFirst({ where: { id: contactId, ownerId: req.user.id } })
    ]);
    if (!list || !contact) return res.status(404).json({ message: 'list or contact not found' });

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
 * Remove a contact from a list (scoped).
 * ========================================================= */
router.delete('/lists/:listId/contacts/:contactId', requireAuth, async (req, res) => {
  const listId = Number(req.params.listId);
  const contactId = Number(req.params.contactId);
  if (!listId || !contactId) return res.status(400).json({ message: 'invalid ids' });

  // Validate list ownership
  const list = await prisma.list.findFirst({ where: { id: listId, ownerId: req.user.id } });
  if (!list) return res.status(404).json({ message: 'list not found' });

  await prisma.listMembership.deleteMany({ where: { listId, contactId } });
  res.json({ ok: true });
});

/* =========================================================
 * GET /lists/:listId/contacts  (protected)
 * Get members of a list (scoped).
 * Optional filters:
 *  - isSubscribed: "true" | "false"
 *  - page/pageSize (pagination)
 * ========================================================= */
router.get('/lists/:listId/contacts', requireAuth, async (req, res) => {
  const listId = Number(req.params.listId);
  if (!listId) return res.status(400).json({ message: 'invalid listId' });

  // Ensure the list belongs to the owner
  const list = await prisma.list.findFirst({ where: { id: listId, ownerId: req.user.id } });
  if (!list) return res.status(404).json({ message: 'list not found' });

  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize || '50', 10)));
  const sub = (req.query.isSubscribed || '').toString().toLowerCase();

  // Build where for membership + contact filter
  const whereMembership = { listId };
  const whereContact = {};
  if (sub === 'true') whereContact.isSubscribed = true;
  if (sub === 'false') whereContact.isSubscribed = false;

  const [members, total] = await Promise.all([
    prisma.listMembership.findMany({
      where: whereMembership,
      include: { contact: { where: whereContact } }, // filter on contact fields
      orderBy: { id: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.listMembership.count({
      where: {
        listId,
        ...(sub === 'true' || sub === 'false'
          ? { contact: { isSubscribed: sub === 'true' } }
          : {})
      }
    })
  ]);

  // map to contacts, removing nulls (if include filtered out)
  const items = members.map(m => m.contact).filter(Boolean);

  res.json({ items, total, page, pageSize });
});

module.exports = router;
