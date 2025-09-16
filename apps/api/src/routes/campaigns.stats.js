// apps/api/src/routes/campaigns.stats.js
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { getCampaignStats, getManyCampaignsStats } = require('../services/campaignStats.service');

const router = express.Router();
router.use(requireAuth);

/**
 * GET /api/v1/campaigns/stats?ids=1,2,3
 */
router.get('/campaigns/stats', async (req, res, next) => {
  try {
    const ids = String(req.query.ids || '')
      .split(',')
      .map(s => Number(s.trim()))
      .filter(n => Number.isInteger(n) && n > 0);

    if (!ids.length) return res.json([]);

    const data = await getManyCampaignsStats(ids, req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/v1/campaigns/:id/stats
 */
router.get('/campaigns/:id/stats', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = await getCampaignStats(id, req.user.id);
    res.json(data);
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ message: 'not found' });
    next(e);
  }
});

module.exports = router;
