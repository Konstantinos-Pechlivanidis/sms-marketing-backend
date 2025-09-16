const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const prisma = require('../lib/prisma');

router.use(requireAuth);

// GET /api/automations
router.get('/automations', async (req, res, next) => {
  try {
    const list = await prisma.automation.findMany({
      where: { ownerId: req.user.id },
      orderBy: { createdAt: 'desc' }
    });
    res.json(list);
  } catch (e) { next(e); }
});

// PUT /api/automations/:id
router.put('/automations/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { title, message, trigger } = req.body;
    const updated = await prisma.automation.update({
      where: { id },
      data: { title, message, trigger },
    });
    if (updated.ownerId !== req.user.id) return res.status(404).json({ message: 'Not found' });
    res.json(updated);
  } catch (e) { next(e); }
});

// PUT /api/automations/:id/status
router.put('/automations/:id/status', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { isActive } = req.body;
    const updated = await prisma.automation.update({
      where: { id },
      data: { isActive: !!isActive },
    });
    if (updated.ownerId !== req.user.id) return res.status(404).json({ message: 'Not found' });
    res.json({ id: updated.id, isActive: updated.isActive });
  } catch (e) { next(e); }
});

module.exports = router;
