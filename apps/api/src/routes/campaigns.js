// apps/api/src/routes/campaigns.js
const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { enqueueCampaign } = require('../services/campaignEnqueue.service');
const { finalizeCampaignIfDone } = require('../services/campaignFinalizer.service');

// Optional scheduler queue (only if you have one)
let schedulerQueue = null;
try {
  schedulerQueue = require('../queues/scheduler.queue');
} catch (_) {
  // no scheduler in this setup — safe to ignore
}

const router = express.Router();
router.use(requireAuth);

/**
 * POST /api/campaigns
 * Create draft (optionally scheduled).
 * Body: { name, templateId, listId, scheduledAt? }
 */
router.post('/campaigns', async (req, res, next) => {
  try {
    const { name, templateId, listId, scheduledAt } = req.body || {};

    if (!name || !templateId || !listId) {
      return res.status(400).json({ message: 'name, templateId and listId are required' });
    }

    // Verify ownership of template and list
    const [tpl, lst] = await Promise.all([
      prisma.messageTemplate.findFirst({ where: { id: Number(templateId), ownerId: req.user.id } }),
      prisma.list.findFirst({ where: { id: Number(listId), ownerId: req.user.id } })
    ]);
    if (!tpl) return res.status(404).json({ message: 'template not found' });
    if (!lst) return res.status(404).json({ message: 'list not found' });

    const data = {
      ownerId: req.user.id,
      createdById: req.user.id,
      name: String(name),
      templateId: tpl.id,
      listId: lst.id,
      status: 'draft'
    };

    if (scheduledAt) {
      data.scheduledAt = new Date(scheduledAt);
      data.status = 'scheduled';
    }

    const campaign = await prisma.campaign.create({ data });
    res.status(201).json(campaign);
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/campaigns
 * (Simple list — most apps should use /api/v1 routes for filters and stats)
 * Query: page=1, pageSize=20
 */
router.get('/campaigns', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));

    const where = { ownerId: req.user.id };

    const [total, items] = await Promise.all([
      prisma.campaign.count({ where }),
      prisma.campaign.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);

    res.json({ total, items, page, pageSize });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/campaigns/:id
 */
router.get('/campaigns/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const c = await prisma.campaign.findFirst({
      where: { id, ownerId: req.user.id }
    });
    if (!c) return res.status(404).json({ message: 'not found' });
    res.json(c);
  } catch (e) {
    next(e);
  }
});

/**
 * PUT /api/campaigns/:id
 * Body: { name?, templateId?, listId?, scheduledAt? (null to unschedule) }
 * - Validates ownership of new template/list.
 * - Handles (un)scheduling (optional schedulerQueue).
 */
router.put('/campaigns/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, templateId, listId, scheduledAt } = req.body || {};

    const campaign = await prisma.campaign.findFirst({
      where: { id, ownerId: req.user.id }
    });
    if (!campaign) return res.status(404).json({ message: 'not found' });

    if (campaign.status === 'sending') {
      return res.status(409).json({ message: 'Cannot edit while sending' });
    }

    const data = {};

    if (typeof name !== 'undefined') data.name = String(name);

    if (typeof templateId !== 'undefined') {
      const tpl = await prisma.messageTemplate.findFirst({
        where: { id: Number(templateId), ownerId: req.user.id }
      });
      if (!tpl) return res.status(404).json({ message: 'template not found' });
      data.templateId = tpl.id;
    }

    if (typeof listId !== 'undefined') {
      const lst = await prisma.list.findFirst({
        where: { id: Number(listId), ownerId: req.user.id }
      });
      if (!lst) return res.status(404).json({ message: 'list not found' });
      data.listId = lst.id;
    }

    if (typeof scheduledAt !== 'undefined') {
      if (scheduledAt) {
        const when = new Date(scheduledAt);
        data.scheduledAt = when;
        data.status = 'scheduled';

        // update scheduled job
        try { await schedulerQueue?.remove(`campaign:schedule:${id}`); } catch(_) {}
        const delay = Math.max(0, when.getTime() - Date.now());
        await schedulerQueue?.add('enqueueCampaign', { campaignId: id }, {
          delay,
          jobId: `campaign:schedule:${id}`
        });
      } else {
        // unschedule
        try { await schedulerQueue?.remove(`campaign:schedule:${id}`); } catch(_) {}
        data.scheduledAt = null;
        if (campaign.status === 'scheduled') data.status = 'draft';
      }
    }

    const updated = await prisma.campaign.update({ where: { id }, data });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

/**
 * DELETE /api/campaigns/:id
 * Allowed unless currently 'sending'
 */
router.delete('/campaigns/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const c = await prisma.campaign.findFirst({
      where: { id, ownerId: req.user.id }
    });
    if (!c) return res.status(404).json({ message: 'not found' });
    if (c.status === 'sending') {
      return res.status(409).json({ message: 'Cannot delete while sending' });
    }
    // cancel scheduled job if any
    try { await schedulerQueue?.remove(`campaign:schedule:${id}`); } catch(_) {}
    await prisma.campaign.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/campaigns/:id/preview
 * Returns first 10 rendered messages (no enqueue)
 */
router.get('/campaigns/:id/preview', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const campaign = await prisma.campaign.findFirst({
      where: { id, ownerId: req.user.id },
      include: {
        template: true,
        list: {
          include: {
            memberships: {
              include: { contact: true }
            }
          }
        }
      }
    });
    if (!campaign) return res.status(404).json({ message: 'not found' });

    const render = (text, contact) =>
      text
        .replace(/\{\{firstName\}\}/g, contact.firstName || '')
        .replace(/\{\{lastName\}\}/g, contact.lastName || '')
        .replace(/\{\{email\}\}/g, contact.email || '');

    const contacts = campaign.list.memberships
      .map(m => m.contact)
      .filter(c => c.isSubscribed);

    const items = contacts.slice(0, 10).map(c => ({
      to: c.phone,
      text: render(campaign.template.text, c)
    }));

    res.json({ items, totalRecipients: contacts.length });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/campaigns/:id/enqueue
 * Transitions to 'sending', debits credits, creates messages and queues jobs.
 */
router.post('/campaigns/:id/enqueue', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const campaign = await prisma.campaign.findFirst({
      where: { id, ownerId: req.user.id }
    });
    if (!campaign) return res.status(404).json({ message: 'not found' });

    if (!['draft', 'scheduled', 'paused'].includes(campaign.status)) {
      return res.status(409).json({ message: 'campaign not in enqueueable status' });
    }

    const result = await enqueueCampaign(id);
    if (result?.ok) return res.json(result);

    if (result?.reason === 'no_valid_recipients') {
      return res.status(400).json({ message: 'no valid recipients in the list' });
    }

    return res.status(500).json({ message: 'enqueue_failed' });
  } catch (e) {
    if (e?.status === 402) return res.status(402).json({ message: 'insufficient credits' });
    next(e);
  }
});

/**
 * GET /api/campaigns/:id/status
 * Returns queued/sent/delivered/failed and the campaign row.
 */
router.get('/campaigns/:id/status', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const c = await prisma.campaign.findFirst({
      where: { id, ownerId: req.user.id }
    });
    if (!c) return res.status(404).json({ message: 'not found' });

    const [queued, sent, delivered, failed] = await Promise.all([
      prisma.campaignMessage.count({ where: { ownerId: req.user.id, campaignId: id, status: 'queued' } }),
      prisma.campaignMessage.count({ where: { ownerId: req.user.id, campaignId: id, status: 'sent' } }),
      prisma.campaignMessage.count({ where: { ownerId: req.user.id, campaignId: id, status: 'delivered' } }),
      prisma.campaignMessage.count({ where: { ownerId: req.user.id, campaignId: id, status: 'failed' } }),
    ]);

    // Opportunistic finalize (if worker/DLR already moved everything out of non-terminal)
    await finalizeCampaignIfDone(id);

    res.json({ campaign: c, metrics: { queued, sent, delivered, failed } });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
