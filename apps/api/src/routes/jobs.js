const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const smsQueue = require('../queues/sms.queue');
const router = express.Router();

router.get('/jobs/health', requireAuth, async (_req, res) => {
  if (!smsQueue) return res.json({ queue: 'disabled' });
  const counts = await smsQueue.getJobCounts();
  res.json({ queue: 'ok', counts });
});

module.exports = router;
