const express = require("express");
const prisma = require("../lib/prisma");
const requireAuth = require("../middleware/requireAuth");
const smsQueue = require("../queues/sms.queue");

const router = express.Router();

// απλο render placeholders {{firstName}} {{lastName}} {{email}}
function render(templateText, contact) {
  return (templateText || "")
    .replace(/{{\s*firstName\s*}}/gi, contact.firstName || "")
    .replace(/{{\s*lastName\s*}}/gi, contact.lastName || "")
    .replace(/{{\s*email\s*}}/gi, contact.email || "");
}

// Create campaign (draft)
router.post("/campaigns", requireAuth, async (req, res) => {
  try {
    const { name, templateId, listId, scheduledAt } = req.body || {};
    if (!name || !templateId || !listId) {
      return res
        .status(400)
        .json({ message: "name, templateId, listId required" });
    }
    const total = await prisma.listMembership.count({
      where: { listId: Number(listId) },
    });
    const campaign = await prisma.campaign.create({
      data: {
        name,
        templateId: Number(templateId),
        listId: Number(listId),
        status: "draft",
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        createdById: req.user.id,
        total,
      },
    });
    res.status(201).json(campaign);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// List campaigns (paginated)
router.get("/campaigns", requireAuth, async (req, res) => {
  const take = Math.min(parseInt(req.query.take || "20", 10), 100);
  const skip = parseInt(req.query.skip || "0", 10);
  const [items, total] = await Promise.all([
    prisma.campaign.findMany({
      take,
      skip,
      orderBy: { id: "desc" },
      include: { template: true, list: true },
    }),
    prisma.campaign.count(),
  ]);
  res.json({ items, total, skip, take });
});

// Get campaign
router.get("/campaigns/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const c = await prisma.campaign.findUnique({
    where: { id },
    include: { template: true, list: true },
  });
  if (!c) return res.status(404).json({ message: "not found" });
  res.json(c);
});

// Preview (πρώτες 10 εγγραφές)
router.get("/campaigns/:id/preview", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const c = await prisma.campaign.findUnique({
    where: { id },
    include: { template: true },
  });
  if (!c) return res.status(404).json({ message: "not found" });

  const members = await prisma.listMembership.findMany({
    where: { listId: c.listId },
    include: { contact: true },
    take: 10,
  });

  const sample = members.map((m) => ({
    to: m.contact.phone,
    text: render(c.template.text, m.contact),
  }));

  res.json({ sample, count: sample.length });
});

// Enqueue messages (dry-run, χωρίς Mitto ακόμα)
router.post("/campaigns/:id/enqueue", requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: { template: true },
  });
  if (!campaign) return res.status(404).json({ message: "not found" });
  if (!["draft", "scheduled", "paused"].includes(campaign.status)) {
    return res
      .status(400)
      .json({ message: `cannot enqueue from status ${campaign.status}` });
  }

  // Φέρε μέλη λίστας με τα στοιχεία επαφών
  const members = await prisma.listMembership.findMany({
    where: { listId: campaign.listId },
    include: { contact: true },
  });
  if (members.length === 0) {
    return res.status(400).json({ message: "list has no members" });
  }

  // Φτιάξε τα μηνύματα με τελικό rendered text
  const messagesData = members.map((m) => ({
    campaignId: campaign.id,
    contactId: m.contactId,
    to: m.contact.phone,
    text: render(campaign.template.text, m.contact),
    status: "queued",
  }));

  // Δημιούργησε εγγραφές & ενημέρωσε campaign status
  await prisma.$transaction([
    prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: "sending",
        startedAt: new Date(),
        total: members.length,
      },
    }),
    prisma.campaignMessage.createMany({
      data: messagesData,
      skipDuplicates: true,
    }),
  ]);

  // Πάρε όλα τα queued μηνύματα της καμπάνιας που δεν έχουν providerMessageId
  const toEnqueue = await prisma.campaignMessage.findMany({
    where: {
      campaignId: campaign.id,
      status: "queued",
      providerMessageId: null,
    },
    select: { id: true },
  });

  let enqueuedJobs = 0;
  if (smsQueue) {
    for (const m of toEnqueue) {
      await smsQueue.add("sendSMS", { messageId: m.id, userId: req.user.id });
      enqueuedJobs++;
    }
  } else {
    console.warn("[Queue] Not available — messages created but not enqueued");
  }

  res.json({ queued: messagesData.length, enqueuedJobs });
});

// Status (metrics)
router.get("/campaigns/:id/status", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const c = await prisma.campaign.findUnique({ where: { id } });
  if (!c) return res.status(404).json({ message: "not found" });

  const [queued, sent, failed] = await Promise.all([
    prisma.campaignMessage.count({
      where: { campaignId: id, status: "queued" },
    }),
    prisma.campaignMessage.count({ where: { campaignId: id, status: "sent" } }),
    prisma.campaignMessage.count({
      where: { campaignId: id, status: "failed" },
    }),
  ]);

  res.json({ campaign: c, metrics: { queued, sent, failed } });
});

// Fake worker (dev only): προωθεί N queued → sent
router.post("/campaigns/:id/fake-send", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const limit = Math.min(Number(req.body?.limit || 50), 500);

  const queued = await prisma.campaignMessage.findMany({
    where: { campaignId: id, status: "queued" },
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
    where: { campaignId: id, status: "queued" },
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
