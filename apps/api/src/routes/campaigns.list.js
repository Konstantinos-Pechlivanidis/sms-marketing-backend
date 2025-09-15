const { Router } = require('express');
const requireAuth = require('../middleware/requireAuth');
const { listCampaigns } = require('../services/campaignsList.service');
// optional tiny cache (no-op if REDIS_URL not set, per your wrapper)
const { cacheGet, cacheSet } = require('../lib/cache');

const r = Router();

// GET /campaigns
r.get('/campaigns', requireAuth, async (req, res, next) => {
  try {
    const {
      page, pageSize, q, status, dateFrom, dateTo, orderBy, order, withStats
    } = req.query;

    const ownerId = req.user.id; // << SCOPE (1 user = 1 store)

    const safeOrderBy = ['createdAt','scheduledAt','startedAt','finishedAt','name','status'].includes(orderBy)
      ? orderBy : 'createdAt';
    const safeOrder = (order === 'asc' || order === 'desc') ? order : 'desc';
    const wantStats = String(withStats ?? 'true') !== 'false';

    // Optional cache key (short TTL)
    const key = `campaigns:list:v1:${ownerId}:${page||1}:${pageSize||10}:${q||''}:${status||''}:${dateFrom||''}:${dateTo||''}:${safeOrderBy}:${safeOrder}:${wantStats}`;
    const cached = await cacheGet(key);
    if (cached) return res.json(JSON.parse(cached));

    const out = await listCampaigns({
      ownerId,               // << pass owner scope to service
      page,
      pageSize,
      q,
      status,
      dateFrom,
      dateTo,
      orderBy: safeOrderBy,
      order: safeOrder,
      withStats: wantStats
    });

    const payload = {
      page: Number(page || 1),
      pageSize: Number(pageSize || 10),
      total: out.total,
      items: out.items
    };

    // Short TTL to reduce DB pressure on dashboards
    await cacheSet(key, JSON.stringify(payload), 20);

    res.json(payload);
  } catch (e) { next(e); }
});

module.exports = r;
