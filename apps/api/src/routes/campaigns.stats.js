const { Router } = require('express');
const requireAuth = require('../middleware/requireAuth');
const { getCampaignStats, getManyCampaignsStats } = require('../services/campaignStats.service');
const { cacheGet, cacheSet } = require('../lib/cache');

const r = Router();

// GET /campaigns/:id/stats
r.get('/campaigns/:id/stats', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: 'invalid id' });

    const ownerId = req.user.id;
    const key = `stats:campaign:v1:${ownerId}:${id}`;    // scoped cache key

    const cached = await cacheGet(key);
    if (cached) return res.json(JSON.parse(cached));

    const stats = await getCampaignStats(id, ownerId);
    const payload = { campaignId: id, ...stats };

    await cacheSet(key, JSON.stringify(payload), 30);    // 30s TTL
    res.json(payload);
  } catch (e) {
    if (e?.code === 'NOT_FOUND') return res.status(404).json({ message: 'not found' });
    next(e);
  }
});

// (optional) GET /campaigns/stats?ids=1,2,3
r.get('/campaigns/stats', requireAuth, async (req, res, next) => {
  try {
    const ownerId = req.user.id;
    const ids = (req.query.ids || '').toString()
      .split(',').map(x => Number(x.trim())).filter(Boolean);

    if (!ids.length) return res.json([]);

    // You could add caching here with a combined key if needed
    const arr = await getManyCampaignsStats(ids, ownerId);
    res.json(arr);
  } catch (e) { next(e); }
});

module.exports = r;
