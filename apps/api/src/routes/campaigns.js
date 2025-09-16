// apps/api/src/routes/campaigns.js
const express = require("express");
const prisma = require("../lib/prisma");
const requireAuth = require("../middleware/requireAuth");
const schedulerQueue = require("../queues/scheduler.queue");
const { enqueueCampaign } = require("../services/campaignEnqueue.service");

const router = express.Router();

const SYSTEM_USER_ID = Number(process.env.SYSTEM_USER_ID || 1);

// Minimal placeholder rendering for preview
function render(templateText, contact) {
  return (templateText || "")
    .replace(/{{\s*firstName\s*}}/gi, contact.firstName || "")
    .replace(/{{\s*lastName\s*}}/gi, contact.lastName || "")
    .replace(/{{\s*email\s*}}/gi, contact.email || "");
}
function msUntil(dateStr) {
  const when = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.max(0, when - now);
}

/* =========================================================
 * POST /campaigns (protected)
 * Create a campaign (draft or scheduled).
 * - Validates ownership of template (owner or system) & list (owner).
 * - Pre-computes total = subscribed members count at creation time.
 * - If scheduledAt provided -> status 'scheduled' + delayed job.
 * ========================================================= */
router.post("/campaigns", requireAuth, async (req, res) => {
  try {
    const { name, templateId, listId, scheduledAt } = req.body || {};
    if (!name || !templateId || !listId) {
      return res
        .status(400)
        .json({ message: "name, templateId, listId required" });
    }

    // Validate template (system or owner) & list ownership
    const [tpl, lst] = await Promise.all([
      prisma.messageTemplate.findFirst({
        where: {
          id: Number(templateId),
          ownerId: { in: [req.user.id, SYSTEM_USER_ID] },
        },
      }),
      prisma.list.findFirst({
        where: { id: Number(listId), ownerId: req.user.id },
      }),
    ]);
    if (!tpl) return res.status(404).json({ message: "template not found" });
    if (!lst) return res.status(404).json({ message: "list not found" });

    // Count subscribed members now (informational)
    const total = await prisma.listMembership.count({
      where: { listId: Number(listId), contact: { isSubscribed: true } },
    });

    const initialStatus = scheduledAt ? "scheduled" : "draft";

    const campaign = await prisma.campaign.create({
      data: {
        ownerId: req.user.id,
        name,
        templateId: Number(templateId),
        listId: Number(listId),
        status: initialStatus,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        createdById: req.user.id,
        total,
      },
      include: { template: true, list: true },
    });

    // If scheduled -> add delayed scheduler job
    if (campaign.status === "scheduled" && schedulerQueue) {
      const delay = msUntil(campaign.scheduledAt);
      await schedulerQueue.add(
        "enqueueCampaign",
        { campaignId: campaign.id },
        { jobId: `campaign:schedule:${campaign.id}`, delay }
      );
    }

    res.status(201).json(campaign);
  } catch (e) {
    res.status(400).json({ message: e.message || "bad request" });
  }
});

/* =========================================================
 * GET /campaigns (protected)
 * Paginated list of campaigns (scoped).
 * Query: take (<=100), skip
 * ========================================================= */
router.get("/campaigns", requireAuth, async (req, res) => {
  const take = Math.min(parseInt(req.query.take || "20", 10), 100);
  const skip = parseInt(req.query.skip || "0", 10);

  const [items, total] = await Promise.all([
    prisma.campaign.findMany({
      where: { ownerId: req.user.id },
      take,
      skip,
      orderBy: { id: "desc" },
      include: { template: true, list: true },
    }),
    prisma.campaign.count({ where: { ownerId: req.user.id } }),
  ]);

  res.json({ items, total, skip, take });
});

/* =========================================================
 * GET /campaigns/:id (protected)
 * Fetch one campaign (scoped).
 * ========================================================= */
router.get("/campaigns/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "invalid id" });

  const c = await prisma.campaign.findFirst({
    where: { id, ownerId: req.user.id },
    include: { template: true, list: true },
  });
  if (!c) return res.status(404).json({ message: "not found" });

  res.json(c);
});

/* =========================================================
 * GET /campaigns/:id/preview (protected)
 * Return first 10 rendered messages for preview (scoped).
 * Only for subscribed contacts at the time of preview.
 * ========================================================= */
router.get("/campaigns/:id/preview", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "invalid id" });

  const c = await prisma.campaign.findFirst({
    where: { id, ownerId: req.user.id },
    include: { template: true },
  });
  if (!c) return res.status(404).json({ message: "not found" });

  const members = await prisma.listMembership.findMany({
    where: { listId: c.listId, contact: { isSubscribed: true } },
    include: { contact: true },
    take: 10,
  });

  const sample = members.map((m) => ({
    to: m.contact.phone,
    text: render(c.template.text, m.contact),
  }));

  res.json({ sample, count: sample.length });
});

/* =========================================================
 * POST /campaigns/:id/enqueue (protected)
 * Manual enqueue using service (idempotent, scoped).
 * ========================================================= */
router.post("/campaigns/:id/enqueue", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "invalid id" });

  const camp = await prisma.campaign.findFirst({
    where: { id, ownerId: req.user.id },
  });
  if (!camp) return res.status(404).json({ message: "not found" });

  const result = await enqueueCampaign(id);
  if (!result.ok) {
    // map reasons -> proper responses
    if (result.reason?.startsWith("invalid_status")) {
      return res.status(409).json({ message: result.reason });
    }
    if (result.reason === "no_recipients") {
      return res
        .status(400)
        .json({ message: "list has no subscribed members" });
    }
    if (result.reason === "already_sending") {
      return res.status(409).json({ message: "already sending" });
    }
    if (result.reason === "not_found") {
      return res.status(404).json({ message: "not found" });
    }
    if (result.reason === "insufficient_credits") {
      return res.status(402).json({ message: "insufficient_credits" }); // 402 Payment Required (semantically ok)
    }
    return res.status(400).json({ message: result.reason || "cannot enqueue" });
  }

  res.json({ queued: result.created, enqueuedJobs: result.enqueuedJobs });
});

/* =========================================================
 * POST /campaigns/:id/schedule (protected)
 * Set or change scheduledAt and create/update delayed job (scoped).
 * Body: { scheduledAt }
 * ========================================================= */
router.post("/campaigns/:id/schedule", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { scheduledAt } = req.body || {};
  if (!id) return res.status(400).json({ message: "invalid id" });
  if (!scheduledAt)
    return res.status(400).json({ message: "scheduledAt required" });

  const camp = await prisma.campaign.findFirst({
    where: { id, ownerId: req.user.id },
  });
  if (!camp) return res.status(404).json({ message: "not found" });

  const updated = await prisma.campaign.update({
    where: { id },
    data: { status: "scheduled", scheduledAt: new Date(scheduledAt) },
  });

  if (schedulerQueue) {
    const delay = msUntil(updated.scheduledAt);
    await schedulerQueue.add(
      "enqueueCampaign",
      { campaignId: id },
      { jobId: `campaign:schedule:${id}`, delay }
    );
  }

  res.json({ ok: true, scheduledAt: updated.scheduledAt });
});

/* =========================================================
 * POST /campaigns/:id/unschedule (protected)
 * Remove scheduledAt and cancel delayed job (scoped).
 * ========================================================= */
router.post("/campaigns/:id/unschedule", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "invalid id" });

  const camp = await prisma.campaign.findFirst({
    where: { id, ownerId: req.user.id },
  });
  if (!camp) return res.status(404).json({ message: "not found" });

  await prisma.campaign.update({
    where: { id },
    data: { status: "draft", scheduledAt: null },
  });

  if (schedulerQueue) {
    try {
      await schedulerQueue.remove(`campaign:schedule:${id}`);
    } catch (_) {}
  }

  res.json({ ok: true });
});

/* =========================================================
 * GET /campaigns/:id/status (protected)
 * Lightweight metrics (scoped).
 * ========================================================= */
router.get("/campaigns/:id/status", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "invalid id" });

  const c = await prisma.campaign.findFirst({
    where: { id, ownerId: req.user.id },
  });
  if (!c) return res.status(404).json({ message: "not found" });

  const [queued, sent, failed, delivered] = await Promise.all([
    prisma.campaignMessage.count({
      where: { ownerId: req.user.id, campaignId: id, status: "queued" },
    }),
    prisma.campaignMessage.count({
      where: { ownerId: req.user.id, campaignId: id, status: "sent" },
    }),
    prisma.campaignMessage.count({
      where: { ownerId: req.user.id, campaignId: id, status: "failed" },
    }),
    prisma.campaignMessage.count({
      where: { ownerId: req.user.id, campaignId: id, status: "delivered" },
    }),
  ]);

  res.json({ campaign: c, metrics: { queued, sent, delivered, failed } });
});

/* =========================================================
 * POST /campaigns/:id/fake-send (protected, dev only)
 * Force-advance N queued -> sent (scoped). Auto-complete if none left.
 * ========================================================= */
router.post("/campaigns/:id/fake-send", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "invalid id" });

  const owned = await prisma.campaign.findFirst({
    where: { id, ownerId: req.user.id },
  });
  if (!owned) return res.status(404).json({ message: "not found" });

  const limit = Math.min(Number(req.body?.limit || 50), 500);

  const queued = await prisma.campaignMessage.findMany({
    where: { ownerId: req.user.id, campaignId: id, status: "queued" },
    take: limit,
    orderBy: { id: "asc" },
  });
  if (!queued.length) return res.json({ updated: 0 });

  const ids = queued.map((m) => m.id);

  await prisma.campaignMessage.updateMany({
    where: { id: { in: ids } },
    data: { status: "sent", sentAt: new Date() },
  });

  const remainingQueued = await prisma.campaignMessage.count({
    where: { ownerId: req.user.id, campaignId: id, status: "queued" },
  });

  if (remainingQueued === 0) {
    await prisma.campaign.update({
      where: { id },
      data: { status: "completed", finishedAt: new Date() },
    });
  }

  res.json({ updated: ids.length, remainingQueued });
});

// PUT /api/campaigns/:id
router.put("/campaigns/:id", requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, templateId, listId, scheduledAt } = req.body;

    const campaign = await prisma.campaign.findFirst({
      where: { id, ownerId: req.user.id },
    });
    if (!campaign) return res.status(404).json({ message: "Not found" });
    if (["sending"].includes(campaign.status))
      return res.status(409).json({ message: "Cannot edit while sending" });

    const data = {};

    if (typeof name !== "undefined") data.name = name;

    if (typeof templateId !== "undefined") {
      const tpl = await prisma.messageTemplate.findFirst({
        where: { id: Number(templateId), ownerId: req.user.id },
      });
      if (!tpl) return res.status(404).json({ message: "template not found" });
      data.templateId = Number(templateId);
    }

    if (typeof listId !== "undefined") {
      const lst = await prisma.list.findFirst({
        where: { id: Number(listId), ownerId: req.user.id },
      });
      if (!lst) return res.status(404).json({ message: "list not found" });
      data.listId = Number(listId);
    }

    if (typeof scheduledAt !== "undefined") {
      if (scheduledAt) {
        data.scheduledAt = new Date(scheduledAt);
        data.status = "scheduled";
        try {
          await schedulerQueue?.remove(`campaign:schedule:${id}`);
        } catch (_) {}
        const delay = Math.max(0, new Date(scheduledAt) - Date.now());
        await schedulerQueue?.add(
          "enqueueCampaign",
          { campaignId: id },
          {
            delay,
            jobId: `campaign:schedule:${id}`,
          }
        );
      } else if (campaign.status === "scheduled") {
        try {
          await schedulerQueue?.remove(`campaign:schedule:${id}`);
        } catch (_) {}
        data.scheduledAt = null;
        data.status = "draft";
      }
    }

    const updated = await prisma.campaign.update({ where: { id }, data });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/campaigns/:id
router.delete("/campaigns/:id", requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const c = await prisma.campaign.findFirst({
      where: { id, ownerId: req.user.id },
    });
    if (!c) return res.status(404).json({ message: "Not found" });
    if (["sending"].includes(c.status))
      return res.status(409).json({ message: "Cannot delete while sending" });
    if (c.status === "scheduled") {
      await schedulerQueue?.remove(`campaign:schedule:${id}`);
    }
    await prisma.campaign.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
