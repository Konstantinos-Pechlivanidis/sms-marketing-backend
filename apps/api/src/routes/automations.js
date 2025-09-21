// apps/api/src/routes/automations.js
const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const prisma = require('../lib/prisma');
const { ensureSystemAutomationsForOwner, SYS } = require('../lib/automations.system');
const { canonicalizeName, hasNamedayOn } = require('../lib/namedays');

router.use(requireAuth);

// Ensure system automations exist for this owner
async function ensure(req) {
  await ensureSystemAutomationsForOwner(req.user.id);
}

// GET /api/automations
router.get('/automations', async (req, res, next) => {
  try {
    await ensure(req);
    const list = await prisma.automation.findMany({
      where: { ownerId: req.user.id },
      orderBy: [{ isSystem: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true, ownerId: true, title: true, message: true,
        isActive: true, trigger: true, isSystem: true, systemSlug: true,
        createdAt: true, updatedAt: true,
      }
    });
    res.json(list);
  } catch (e) { next(e); }
});

// PUT /api/automations/:id  (edit title/message; for system: block trigger/systemSlug)
router.put('/automations/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { title, message, trigger } = req.body;

    const a = await prisma.automation.findUnique({ where: { id } });
    if (!a || a.ownerId !== req.user.id) return res.status(404).json({ message: 'Not found' });

    // System automations: don't allow changing trigger/systemSlug
    if (a.isSystem && typeof trigger !== 'undefined' && trigger !== a.trigger) {
      return res.status(400).json({ message: 'Cannot change trigger of a system automation' });
    }

    const updated = await prisma.automation.update({
      where: { id },
      data: {
        title: typeof title === 'string' ? title : undefined,
        message: typeof message === 'string' ? message : undefined,
        trigger: a.isSystem ? a.trigger : (typeof trigger === 'string' ? trigger : undefined)
      },
      select: {
        id: true, ownerId: true, title: true, message: true,
        isActive: true, trigger: true, isSystem: true, systemSlug: true,
        createdAt: true, updatedAt: true,
      }
    });

    res.json(updated);
  } catch (e) { next(e); }
});

// PUT /api/automations/:id/status
router.put('/automations/:id/status', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { isActive } = req.body;
    const a = await prisma.automation.findUnique({ where: { id } });
    if (!a || a.ownerId !== req.user.id) return res.status(404).json({ message: 'Not found' });

    const updated = await prisma.automation.update({
      where: { id },
      data: { isActive: !!isActive },
      select: { id: true, isActive: true }
    });
    res.json(updated);
  } catch (e) { next(e); }
});

/**
 * PREVIEW — Birthday (who matches a specific date)
 * GET /api/automations/preview/birthday?date=YYYY-MM-DD
 */
router.get('/automations/preview/birthday', async (req, res, next) => {
  try {
    const dateStr = String(req.query.date || '');
    const d = dateStr ? new Date(dateStr + 'T00:00:00Z') : new Date();
    if (Number.isNaN(d.getTime())) return res.status(400).json({ message: 'invalid date' });

    const month = d.getUTCMonth(); // 0-based
    const day = d.getUTCDate();

    const contacts = await prisma.contact.findMany({
      where: {
        ownerId: req.user.id,
        isSubscribed: true,
        birthday: { not: null },
      },
      select: { id: true, firstName: true, phone: true, birthday: true }
    });

    const matches = contacts.filter(c => {
      const b = c.birthday;
      return b && (b.getUTCMonth() === month) && (b.getUTCDate() === day);
    });

    res.json({ date: dateStr || d.toISOString().slice(0,10), total: matches.length, items: matches.slice(0, 200) });
  } catch (e) { next(e); }
});

/**
 * PREVIEW — Name day (who matches a specific date)
 * GET /api/automations/preview/nameday?date=YYYY-MM-DD
 */
router.get('/automations/preview/nameday', async (req, res, next) => {
  try {
    const dateStr = String(req.query.date || '');
    const d = dateStr ? new Date(dateStr + 'T00:00:00Z') : new Date();
    if (Number.isNaN(d.getTime())) return res.status(400).json({ message: 'invalid date' });

    const contacts = await prisma.contact.findMany({
      where: {
        ownerId: req.user.id,
        isSubscribed: true,
        firstName: { not: null }
      },
      select: { id: true, firstName: true, phone: true }
    });

    const matches = contacts.filter(c => hasNamedayOn(c.firstName, d));
    res.json({ date: dateStr || d.toISOString().slice(0,10), total: matches.length, items: matches.slice(0, 200) });
  } catch (e) { next(e); }
});

module.exports = router;
