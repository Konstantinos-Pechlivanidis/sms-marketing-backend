// apps/api/src/routes/jobs.js
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const smsQueue = require('../queues/sms.queue');
const schedulerQueue = require('../queues/scheduler.queue');
const router = express.Router();

router.get('/jobs/health', requireAuth, async (_req, res) => {
  const out = {};
  if (smsQueue) out.sms = await smsQueue.getJobCounts();
  else out.sms = 'disabled';

  if (schedulerQueue) out.scheduler = await schedulerQueue.getJobCounts();
  else out.scheduler = 'disabled';

  res.json(out);
});

module.exports = router;
