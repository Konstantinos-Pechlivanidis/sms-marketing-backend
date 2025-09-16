// apps/api/src/routes/user.js
const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const prisma = require('../lib/prisma');
const bcrypt = require('bcrypt');

router.use(requireAuth);

// GET /api/me
router.get('/me', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, name: true, company: true, senderName: true }
    });
    const wallet = await prisma.wallet.upsert({
      where: { ownerId: req.user.id },
      update: {},
      create: { ownerId: req.user.id, balance: 0 }
    });
    res.json({ ...user, credits: wallet.balance });
  } catch (e) { next(e); }
});

// PUT /api/user
router.put('/user', async (req, res, next) => {
  try {
    const { name, company, senderName } = req.body;
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { name, company, senderName },
      select: { id: true, email: true, name: true, company: true, senderName: true }
    });
    res.json(updated);
  } catch (e) { next(e); }
});

// PUT /api/user/password
router.put('/user/password', async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const ok = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!ok) return res.status(400).json({ message: 'Invalid current password' });
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
