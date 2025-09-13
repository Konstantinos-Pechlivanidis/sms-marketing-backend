const express = require('express');
const prisma = require('../lib/prisma');

const router = express.Router();

// Basic liveness
router.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});

// Readiness (DB ping)
router.get('/readiness', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready' });
  } catch (err) {
    res.status(500).json({ status: 'error', error: String(err) });
  }
});

module.exports = router;
