const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// Create template
router.post('/templates', requireAuth, async (req, res) => {
  try {
    const { name, text } = req.body || {};
    if (!name || !text) return res.status(400).json({ message: 'name & text required' });
    const t = await prisma.messageTemplate.create({ data: { name, text } });
    res.status(201).json(t);
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ message: 'name already exists' });
    res.status(400).json({ message: e.message });
  }
});

// List templates
router.get('/templates', requireAuth, async (_req, res) => {
  const items = await prisma.messageTemplate.findMany({ orderBy: { id: 'desc' } });
  res.json(items);
});

// Get one
router.get('/templates/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const t = await prisma.messageTemplate.findUnique({ where: { id } });
  if (!t) return res.status(404).json({ message: 'not found' });
  res.json(t);
});

// Update
router.put('/templates/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, text } = req.body || {};
    const t = await prisma.messageTemplate.update({ where: { id }, data: { name, text } });
    res.json(t);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ message: 'not found' });
    if (e.code === 'P2002') return res.status(409).json({ message: 'name already exists' });
    res.status(400).json({ message: e.message });
  }
});

// Delete
router.delete('/templates/:id', requireAuth, async (req, res) => {
  try {
    await prisma.messageTemplate.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ message: 'not found' });
    res.status(400).json({ message: e.message });
  }
});

module.exports = router;
