const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const router = express.Router();

// Create
router.post('/contacts', requireAuth, async (req, res) => {
  try {
    const { phone, email, firstName, lastName } = req.body || {};
    if (!phone) return res.status(400).json({ message: 'phone required' });
    const c = await prisma.contact.create({ data: { phone, email, firstName, lastName } });
    res.status(201).json(c);
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ message: 'phone already exists' });
    res.status(400).json({ message: e.message });
  }
});

// List (paginated)
router.get('/contacts', requireAuth, async (req, res) => {
  const take = Math.min(parseInt(req.query.take || '20', 10), 100);
  const skip = parseInt(req.query.skip || '0', 10);
  const [items, total] = await Promise.all([
    prisma.contact.findMany({ take, skip, orderBy: { id: 'desc' } }),
    prisma.contact.count()
  ]);
  res.json({ items, total, skip, take });
});

// Get one
router.get('/contacts/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const c = await prisma.contact.findUnique({ where: { id } });
  if (!c) return res.status(404).json({ message: 'not found' });
  res.json(c);
});

// Update
router.put('/contacts/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { phone, email, firstName, lastName } = req.body || {};
    const c = await prisma.contact.update({ where: { id }, data: { phone, email, firstName, lastName } });
    res.json(c);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ message: 'not found' });
    if (e.code === 'P2002') return res.status(409).json({ message: 'phone already exists' });
    res.status(400).json({ message: e.message });
  }
});

// Delete
router.delete('/contacts/:id', requireAuth, async (req, res) => {
  try {
    await prisma.contact.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ message: 'not found' });
    res.status(400).json({ message: e.message });
  }
});

module.exports = router;
