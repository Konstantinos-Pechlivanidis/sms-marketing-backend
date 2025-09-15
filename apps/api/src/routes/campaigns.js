const express = require("express");
const prisma = require("../lib/prisma");
const requireAuth = require("../middleware/requireAuth");
const smsQueue = require("../queues/sms.queue");
const { scoped } = require("../lib/policies");

const router = express.Router();

const crypto = require("node:crypto");
function newTrackingId() {
  // Short, URL-safe, unique enough for per-message tracking
  return crypto.randomBytes(9).toString("base64url"); // ~12 chars
}

// Simple placeholder rendering: {{firstName}} {{lastName}} {{email}}
function render(templateText, contact) {
  return (templateText || "")
    .replace(/{{\s*firstName\s*}}/gi, contact.firstName || "")
    .replace(/{{\s*lastName\s*}}/gi, contact.lastName || "")
    .replace(/{{\s*email\s*}}/gi, contact.email || "");
}

/* =========================================================
 * POST /campaigns (protected)
 * Create a draft campaign scoped to the authenticated owner.
 * - Validates ownership of template & list.
 * - Pre-computes total recipients (subscribed only).
 * ========================================================= */
router.post("/campaigns", requireAuth, async (req, res) => {
  try {
    const { name, templateId, listId, scheduledAt } = req.body || {};
    if (!name || !templateId || !listId) {
      return res
        .status(400)
        .json({ message: "name, templateId, listId required" });
    }

    // Validate ownership of template & list
    const SYSTEM_USER_ID = Number(process.env.SYSTEM_USER_ID || 1);

    const [tpl, lst] = await Promise.all([
      prisma.messageTemplate.findFirst({
        where: {
          id: Number(templateId),
          ownerId: { in: [req.user.id, SYSTEM_USER_ID] }, // << allow system templates
        },
      }),
      prisma.list.findFirst({
        where: { id: Number(listId), ownerId: req.user.id },
      }),
    ]);

    if (!tpl || !lst)
      return res.status(404).json({ message: "template or list not found" });

    // Count subscribed members for this list (MVP: only isSubscribed == true)
    const total = await prisma.listMembership.count({
      where: {
        listId: Number(listId),
        contact: { isSubscribed: true },
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        ownerId: req.user.id, // << SCOPE
        name,
        templateId: Number(templateId),
        listId: Number(listId),
        status: "draft",
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        createdById: req.user.id,
        total,
      },
      include: { template: true, list: true },
    });

    res.status(201).json(campaign);
  } catch (e) {
    res.status(400).json({ message: e.message || "bad request" });
  }
});

/* =========================================================
 * GET /campaigns (protected)
 * Paginated list of campaigns for the owner.
 * Query: take (<=100), skip
 * ========================================================= */
router.get("/campaigns", requireAuth, async (req, res) => {
  const take = Math.min(parseInt(req.query.take || "20", 10), 100);
  const skip = parseInt(req.query.skip || "0", 10);

  const [items, total] = await Promise.all([
    prisma.campaign.findMany({
      where: { ...scoped(req.user.id) }, // << SCOPE
      take,
      skip,
      orderBy: { id: "desc" },
      include: { template: true, list: true },
    }),
    prisma.campaign.count({ where: { ...scoped(req.user.id) } }), // << SCOPE
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
    where: { id, ownerId: req.user.id }, // << SCOPE
    include: { template: true, list: true },
  });

  if (!c) return res.status(404).json({ message: "not found" });
  res.json(c);
});

/* =========================================================
 * GET /campaigns/:id/preview (protected)
 * First 10 rendered messages for a campaign (for preview).
 * ========================================================= */
router.get("/campaigns/:id/preview", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "invalid id" });

  const c = await prisma.campaign.findFirst({
    where: { id, ownerId: req.user.id }, // << SCOPE
    include: { template: true },
  });
  if (!c) return res.status(404).json({ message: "not found" });

  // Members of the list that are subscribed (preview respects final audience)
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
 * Create per-contact CampaignMessage for subscribed contacts,
 * set status -> sending, enqueue background jobs (idempotent).
 * ========================================================= */
router.post("/campaigns/:id/enqueue", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "invalid id" });

  // Fetch owned campaign + template
  const campaign = await prisma.campaign.findFirst({
    where: { id, ownerId: req.user.id }, // << SCOPE
    include: { template: true },
  });
  if (!campaign) return res.status(404).json({ message: "not found" });

  if (!["draft", "scheduled", "paused"].includes(campaign.status)) {
    return res
      .status(400)
      .json({ message: `cannot enqueue from status ${campaign.status}` });
  }

  // Fetch list members that are currently subscribed
  const members = await prisma.listMembership.findMany({
    where: { listId: campaign.listId, contact: { isSubscribed: true } },
    include: { contact: true },
  });
  if (members.length === 0) {
    return res.status(400).json({ message: "list has no subscribed members" });
  }

  // Build messages (scoped) with final rendered text
  const messagesData = members.map((m) => ({
    ownerId: req.user.id, // << SCOPE
    campaignId: campaign.id,
    contactId: m.contactId,
    to: m.contact.phone,
    text: render(campaign.template.text, m.contact),
    trackingId: newTrackingId(),
    status: "queued",
  }));

  // Transaction: update campaign + insert messages
  await prisma.$transaction([
    prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: "sending",
        startedAt: new Date(),
        total: members.length, // set exact number of subscribed recipients at enqueue time
      },
    }),
    prisma.campaignMessage.createMany({
      data: messagesData,
      skipDuplicates: true, // if retry, avoid duplicate trackingIds (should be unique anyway)
    }),
  ]);

  // Enqueue background jobs (idempotent via jobId)
  const toEnqueue = await prisma.campaignMessage.findMany({
    where: {
      ownerId: req.user.id, // << SCOPE
      campaignId: campaign.id,
      status: "queued",
      providerMessageId: null,
    },
    select: { id: true },
  });

  let enqueuedJobs = 0;
  if (smsQueue) {
    for (const m of toEnqueue) {
      await smsQueue.add(
        "sendSMS",
        { messageId: m.id, userId: req.user.id },
        { jobId: `message:${m.id}` } // idempotent
      );
      enqueuedJobs++;
    }
  } else {
    console.warn("[Queue] Not available — messages created but not enqueued");
  }

  res.json({ queued: messagesData.length, enqueuedJobs });
});

/* =========================================================
 * GET /campaigns/:id/status (protected)
 * Lightweight metrics for a single campaign (scoped).
 * ========================================================= */
router.get("/campaigns/:id/status", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "invalid id" });

  const c = await prisma.campaign.findFirst({
    where: { id, ownerId: req.user.id }, // << SCOPE
  });
  if (!c) return res.status(404).json({ message: "not found" });

  const [queued, sent, failed] = await Promise.all([
    prisma.campaignMessage.count({
      where: { ownerId: req.user.id, campaignId: id, status: "queued" }, // << SCOPE
    }),
    prisma.campaignMessage.count({
      where: { ownerId: req.user.id, campaignId: id, status: "sent" }, // << SCOPE
    }),
    prisma.campaignMessage.count({
      where: { ownerId: req.user.id, campaignId: id, status: "failed" }, // << SCOPE
    }),
  ]);

  res.json({ campaign: c, metrics: { queued, sent, failed } });
});

/* =========================================================
 * POST /campaigns/:id/fake-send (protected, dev-only)
 * Progress N queued -> sent, then auto-complete campaign if none left.
 * Scopes to owner.
 * ========================================================= */
router.post("/campaigns/:id/fake-send", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "invalid id" });

  // Ensure campaign belongs to owner
  const owned = await prisma.campaign.findFirst({
    where: { id, ownerId: req.user.id }, // << SCOPE
  });
  if (!owned) return res.status(404).json({ message: "not found" });

  const limit = Math.min(Number(req.body?.limit || 50), 500);

  const queued = await prisma.campaignMessage.findMany({
    where: { ownerId: req.user.id, campaignId: id, status: "queued" }, // << SCOPE
    take: limit,
    orderBy: { id: "asc" },
  });

  if (queued.length === 0) return res.json({ updated: 0 });

  const ids = queued.map((m) => m.id);

  await prisma.campaignMessage.updateMany({
    where: { id: { in: ids } },
    data: { status: "sent", sentAt: new Date() },
  });

  const remainingQueued = await prisma.campaignMessage.count({
    where: { ownerId: req.user.id, campaignId: id, status: "queued" }, // << SCOPE
  });

  if (remainingQueued === 0) {
    await prisma.campaign.update({
      where: { id },
      data: { status: "completed", finishedAt: new Date() },
    });
  }

  res.json({ updated: ids.length, remainingQueued });
});

module.exports = router;
