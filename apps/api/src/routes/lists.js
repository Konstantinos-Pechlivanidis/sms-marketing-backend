const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const router = express.Router();

// Create list
router.post('/lists', requireAuth, async (req, res) => {
  try {
    const { name, description } = req.body || {};
    if (!name) return res.status(400).json({ message: 'name required' });
    const l = await prisma.list.create({ data: { name, description } });
    res.status(201).json(l);
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ message: 'name already exists' });
    res.status(400).json({ message: e.message });
  }
});

// List lists
router.get('/lists', requireAuth, async (req, res) => {
  const lists = await prisma.list.findMany({ orderBy: { id: 'desc' } });
  res.json(lists);
});

// Add contact to list
router.post('/lists/:listId/contacts/:contactId', requireAuth, async (req, res) => {
  const listId = Number(req.params.listId);
  const contactId = Number(req.params.contactId);
  try {
    const m = await prisma.listMembership.create({ data: { listId, contactId } });
    res.status(201).json(m);
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ message: 'contact already in list' });
    if (e.code === 'P2003') return res.status(404).json({ message: 'list or contact not found' });
    res.status(400).json({ message: e.message });
  }
});

// Remove contact from list
router.delete('/lists/:listId/contacts/:contactId', requireAuth, async (req, res) => {
  const listId = Number(req.params.listId);
  const contactId = Number(req.params.contactId);
  try {
    await prisma.listMembership.deleteMany({ where: { listId, contactId } });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// Get members of a list
router.get('/lists/:listId/contacts', requireAuth, async (req, res) => {
  const listId = Number(req.params.listId);
  const members = await prisma.listMembership.findMany({
    where: { listId },
    select: { contact: true },
    orderBy: { id: 'desc' }
  });
  res.json(members.map(m => m.contact));
});

module.exports = router;
