// apps/api/src/routes/campaigns.js
const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { enqueueCampaign } = require('../services/campaignEnqueue.service');
const { finalizeCampaignIfDone } = require('../services/campaignFinalizer.service');

// Optional scheduler queue (only if you have one)
let schedulerQueue = null;
try { schedulerQueue = require('../queues/scheduler.queue'); } catch (_) {}

const router = express.Router();
router.use(requireAuth);

// ------------------------------------------------------------------
// Constants/helpers
// ------------------------------------------------------------------
const ALL_LIST_NAME = '[ALL_CONTACTS]'; // virtual audience marker
const ADHOC_PREFIX = 'AdHoc';           // prefix for on-the-fly templates

async function ensureAllContactsList(ownerId) {
  // We keep a real List row to satisfy FK constraint,
  // but we won't use memberships for it in enqueue/preview.
  let lst = await prisma.list.findFirst({
    where: { ownerId, name: ALL_LIST_NAME },
    select: { id: true, name: true }
  });
  if (!lst) {
    lst = await prisma.list.create({
      data: {
        ownerId,
        name: ALL_LIST_NAME,
        description: 'Virtual audience: all subscribed contacts (no memberships needed)'
      },
      select: { id: true, name: true }
    });
  }
  return lst;
}

async function resolveListId(ownerId, listId) {
  // Accept numeric ID or special tokens
  if (listId === 'ALL' || listId === 'all' || listId === '*') {
    const lst = await ensureAllContactsList(ownerId);
    return lst.id;
  }
  const id = Number(listId);
  if (!id) return null;
  return id;
}

async function upsertAdhocTemplate({ ownerId, campaignName, text, existingTemplateId }) {
  if (!text || !text.trim()) {
    const err = new Error('text required');
    err.status = 400;
    throw err;
  }

  // If current template is already an AdHoc we own, update it (nice UX when editing)
  if (existingTemplateId) {
    const tpl = await prisma.messageTemplate.findFirst({
      where: { id: existingTemplateId, ownerId }
    });
    if (tpl && tpl.name.startsWith(`${ADHOC_PREFIX} - `)) {
      const updated = await prisma.messageTemplate.update({
        where: { id: tpl.id },
        data: { text }
      });
      return updated.id;
    }
  }

  // Else create a new one
  const niceName = `${ADHOC_PREFIX} - ${campaignName} - ${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}`;
  const created = await prisma.messageTemplate.create({
    data: {
      ownerId,
      name: niceName,
      text
    }
  });
  return created.id;
}

// ------------------------------------------------------------------
// POST /api/campaigns
// Body: { name, templateId?, text?, listId | "ALL", scheduledAt? }
// Rules:
//  - Require name and audience (listId or "ALL")
//  - Require either templateId OR text (ad-hoc)
// ------------------------------------------------------------------
router.post('/campaigns', async (req, res, next) => {
  try {
    let { name, templateId, text, listId, scheduledAt } = req.body || {};
    name = String(name || '').trim();

    if (!name) return res.status(400).json({ message: 'name is required' });
    if (!templateId && !text) {
      return res.status(400).json({ message: 'Provide templateId or text' });
    }

    // Resolve audience
    const resolvedListId = await resolveListId(req.user.id, listId);
    if (!resolvedListId) return res.status(400).json({ message: 'listId (or "ALL") is required' });

    // Verify list ownership
    const list = await prisma.list.findFirst({ where: { id: resolvedListId, ownerId: req.user.id } });
    if (!list) return res.status(404).json({ message: 'list not found' });

    // Resolve template
    let resolvedTemplateId = Number(templateId) || null;
    if (resolvedTemplateId) {
      const tpl = await prisma.messageTemplate.findFirst({ where: { id: resolvedTemplateId, ownerId: req.user.id } });
      if (!tpl) return res.status(404).json({ message: 'template not found' });
    } else {
      resolvedTemplateId = await upsertAdhocTemplate({
        ownerId: req.user.id,
        campaignName: name,
        text
      });
    }

    const data = {
      ownerId: req.user.id,
      createdById: req.user.id,
      name,
      templateId: resolvedTemplateId,
      listId: resolvedListId,
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

// ------------------------------------------------------------------
// GET /api/campaigns (simple paged list)
// ------------------------------------------------------------------
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

// ------------------------------------------------------------------
// GET /api/campaigns/:id
// ------------------------------------------------------------------
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

// ------------------------------------------------------------------
// PUT /api/campaigns/:id
// Body: { name?, templateId?, text?, listId? | "ALL", scheduledAt? (null unschedule) }
//  - If text provided, we upsert ad-hoc template and re-link
//  - If listId is "ALL", we auto-resolve special list
// ------------------------------------------------------------------
router.put('/campaigns/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    let { name, templateId, text, listId, scheduledAt } = req.body || {};

    const campaign = await prisma.campaign.findFirst({
      where: { id, ownerId: req.user.id }
    });
    if (!campaign) return res.status(404).json({ message: 'not found' });

    if (campaign.status === 'sending') {
      return res.status(409).json({ message: 'Cannot edit while sending' });
    }

    const data = {};

    if (typeof name !== 'undefined') data.name = String(name);

    // Audience update
    if (typeof listId !== 'undefined') {
      const resolvedListId = await resolveListId(req.user.id, listId);
      if (!resolvedListId) return res.status(400).json({ message: 'invalid listId' });
      const lst = await prisma.list.findFirst({ where: { id: resolvedListId, ownerId: req.user.id } });
      if (!lst) return res.status(404).json({ message: 'list not found' });
      data.listId = resolvedListId;
    }

    // Template update path
    if (typeof text !== 'undefined' && text !== null) {
      // provided ad-hoc text should override/set a template
      const newTplId = await upsertAdhocTemplate({
        ownerId: req.user.id,
        campaignName: data.name || campaign.name,
        text,
        existingTemplateId: campaign.templateId
      });
      data.templateId = newTplId;
    } else if (typeof templateId !== 'undefined') {
      const newTplId = Number(templateId);
      if (!newTplId) return res.status(400).json({ message: 'invalid templateId' });
      const tpl = await prisma.messageTemplate.findFirst({ where: { id: newTplId, ownerId: req.user.id } });
      if (!tpl) return res.status(404).json({ message: 'template not found' });
      data.templateId = newTplId;
    }

    // Scheduling
    if (typeof scheduledAt !== 'undefined') {
      if (scheduledAt) {
        const when = new Date(scheduledAt);
        data.scheduledAt = when;
        data.status = 'scheduled';
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

// ------------------------------------------------------------------
// DELETE /api/campaigns/:id
// ------------------------------------------------------------------
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
    try { await schedulerQueue?.remove(`campaign:schedule:${id}`); } catch(_) {}
    await prisma.campaign.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------------------------------
// GET /api/campaigns/:id/preview
//  - If list is [ALL_CONTACTS], we preview against all subscribed contacts
// ------------------------------------------------------------------
router.get('/campaigns/:id/preview', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const campaign = await prisma.campaign.findFirst({
      where: { id, ownerId: req.user.id },
      include: {
        template: true,
        list: {
          include: {
            memberships: { include: { contact: true } }
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

    let contacts = [];
    if (campaign.list?.name === ALL_LIST_NAME) {
      contacts = await prisma.contact.findMany({
        where: { ownerId: req.user.id, isSubscribed: true },
        orderBy: { id: 'desc' },
        take: 200 // safety cap for preview
      });
    } else {
      contacts = campaign.list.memberships
        .map((m) => m.contact)
        .filter((c) => c.isSubscribed);
    }

    const items = contacts.slice(0, 10).map((c) => ({
      to: c.phone,
      text: render(campaign.template.text, c)
    }));

    res.json({ items, totalRecipients: contacts.length });
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------------------------------
// POST /api/campaigns/:id/enqueue
// ------------------------------------------------------------------
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
      return res.status(400).json({ message: 'no valid recipients in the audience' });
    }

    return res.status(500).json({ message: 'enqueue_failed' });
  } catch (e) {
    if (e?.status === 402) return res.status(402).json({ message: 'insufficient credits' });
    next(e);
  }
});

// ------------------------------------------------------------------
// GET /api/campaigns/:id/status
// ------------------------------------------------------------------
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

    await finalizeCampaignIfDone(id);

    res.json({ campaign: c, metrics: { queued, sent, delivered, failed } });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
