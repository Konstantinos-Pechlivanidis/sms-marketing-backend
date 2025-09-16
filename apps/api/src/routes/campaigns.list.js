// apps/api/src/routes/campaigns.list.js
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { listCampaigns } = require('../services/campaignsList.service');

const router = express.Router();
router.use(requireAuth);

/**
 * GET /api/v1/campaigns
 * Query:
 *  - page=1
 *  - pageSize=20
 *  - q (search by name)
 *  - status (draft|scheduled|sending|paused|completed|failed)
 *  - dateFrom, dateTo (ISO)
 *  - orderBy (createdAt|startedAt|finishedAt), order (asc|desc)
 *  - withStats=true|false
 */
router.get('/campaigns', async (req, res, next) => {
  try {
    const {
      page = 1,
      pageSize = 20,
      q,
      status,
      dateFrom,
      dateTo,
      orderBy = 'createdAt',
      order = 'desc',
      withStats = 'true'
    } = req.query;

    const result = await listCampaigns({
      ownerId: req.user.id,
      page, pageSize, q, status, dateFrom, dateTo,
      orderBy, order,
      withStats: String(withStats).toLowerCase() !== 'false'
    });

    res.json(result);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
