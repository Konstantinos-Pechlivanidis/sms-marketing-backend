// apps/api/src/routes/user.js
const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const prisma = require('../lib/prisma');
const bcrypt = require('bcrypt');

router.use(requireAuth);

// GET /api/me
router.get('/me', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: Number(req.user.id) },
      select: { id: true, email: true, name: true, company: true, senderName: true }
    });

    if (!user) {
      return res.status(404).json({ message: 'Not Found' });
    }

    // Ensure wallet exists; don't crash if something goes wrong—default to 0
    const wallet = await prisma.wallet.upsert({
      where: { ownerId: user.id },     // ownerId must be unique in your schema
      update: {},
      create: { ownerId: user.id, balance: 0 }
    }).catch(() => ({ balance: 0 }));

    return res.json({ ...user, credits: wallet?.balance ?? 0 });
  } catch (err) {
    req.log?.error({ err }, 'GET /api/me failed');
    return res.status(500).json({ message: 'Internal Server Error' });
  }
});

// PUT /api/user
router.put('/user', async (req, res, next) => {
  try {
    const { name, company, senderName } = req.body;
    const updated = await prisma.user.update({
      where: { id: Number(req.user.id) },
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
    const user = await prisma.user.findUnique({ where: { id: Number(req.user.id) } });
    if (!user) return res.status(404).json({ message: 'Not Found' });

    const ok = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!ok) return res.status(400).json({ message: 'Invalid current password' });

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
