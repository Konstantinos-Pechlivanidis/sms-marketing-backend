const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

const SYSTEM_USER_ID = Number(process.env.SYSTEM_USER_ID || 1);

/**
 * NOTE:
 * - Templates are managed by the platform (system user).
 * - Owners can only read & use them in campaigns.
 * - No create/update/delete endpoints for normal users.
 */

// List templates (system-only), with optional search & pagination
router.get('/templates', requireAuth, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '50', 10)));
  const q = (req.query.q || '').toString().trim();

  const where = { ownerId: SYSTEM_USER_ID };
  if (q) where.name = { contains: q, mode: 'insensitive' };

  const [items, total] = await Promise.all([
    prisma.messageTemplate.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, name: true, text: true, createdAt: true, updatedAt: true }
    }),
    prisma.messageTemplate.count({ where })
  ]);

  res.json({ items, total, page, pageSize });
});

// Get one template (system-only)
router.get('/templates/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: 'invalid id' });

  const t = await prisma.messageTemplate.findFirst({
    where: { id, ownerId: SYSTEM_USER_ID },
    select: { id: true, name: true, text: true, createdAt: true, updatedAt: true }
  });
  if (!t) return res.status(404).json({ message: 'not found' });

  res.json(t);
});

// Explicitly block write operations for non-admin users
router.post('/templates', requireAuth, (_req, res) => {
  return res.status(403).json({ message: 'Templates are managed by the platform.' });
});
router.put('/templates/:id', requireAuth, (_req, res) => {
  return res.status(403).json({ message: 'Templates are managed by the platform.' });
});
router.delete('/templates/:id', requireAuth, (_req, res) => {
  return res.status(403).json({ message: 'Templates are managed by the platform.' });
});

module.exports = router;
