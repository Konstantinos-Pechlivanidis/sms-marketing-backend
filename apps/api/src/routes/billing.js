// apps/api/src/routes/billing.js
const { Router } = require("express");
const prisma = require("../lib/prisma");
const requireAuth = require("../middleware/requireAuth");
const { getBalance, credit } = require("../services/wallet.service");
const { requireIdempotencyKey } = require("../middleware/idempotency");

const r = Router();

/**
 * GET /billing/balance
 */
r.get("/billing/balance", requireAuth, async (req, res, next) => {
  try {
    const balance = await getBalance(req.user.id);
    res.json({ balance });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /billing/transactions
 * Query: page(1), pageSize(10..100)
 */
r.get("/billing/transactions", requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 10)));
    const [total, items] = await Promise.all([
      prisma.creditTransaction.count({ where: { ownerId: req.user.id } }),
      prisma.creditTransaction.findMany({
        where: { ownerId: req.user.id },
        orderBy: { id: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({ page, pageSize, total, items });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /billing/packages
 * List active packages
 */
r.get("/billing/packages", requireAuth, async (_req, res, next) => {
  try {
    const items = await prisma.package.findMany({
      where: { active: true },
      orderBy: { units: "asc" },
    });
    res.json(items);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /billing/seed-packages  (DEV only - optional)
 * Body: { items: [{ name, units, priceCents }] }
 */
r.post("/billing/seed-packages", requireAuth, async (req, res, next) => {
  try {
    if (process.env.ALLOW_BILLING_SEED !== "1") {
      return res.status(403).json({ message: "seeding disabled" });
    }
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const data = items
      .map((x) => ({
        name: String(x.name),
        units: Number(x.units),
        priceCents: Number(x.priceCents),
        active: true,
      }))
      .filter((x) => x.name && x.units > 0 && x.priceCents >= 0);

    for (const p of data) {
      await prisma.package.upsert({
        where: { name: p.name },
        update: { units: p.units, priceCents: p.priceCents, active: true },
        create: p,
      });
    }
    const all = await prisma.package.findMany({
      where: { active: true },
      orderBy: { units: "asc" },
    });
    res.json({ ok: true, items: all });
  } catch (e) {
    next(e);
  }
});

/* ---------------------------------------
   Helper used by both purchase endpoints
   --------------------------------------- */
async function purchaseHandler(req, res, next) {
  try {
    const packageId = Number(req.body?.packageId || 0);
    if (!packageId) return res.status(400).json({ message: "packageId required" });

    const pkg = await prisma.package.findFirst({
      where: { id: packageId, active: true },
    });
    if (!pkg) return res.status(404).json({ message: "package not found" });

    // Create purchase row (MVP: immediately paid)
    const purchase = await prisma.purchase.create({
      data: {
        ownerId: req.user.id,
        packageId: pkg.id,
        units: pkg.units,
        priceCents: pkg.priceCents,
        status: "paid",
      },
    });

    // Credit wallet
    const { balance, txn } = await credit(req.user.id, pkg.units, {
      reason: `purchase:${pkg.name}`,
      meta: { purchaseId: purchase.id, packageId: pkg.id },
    });

    const payload = { ok: true, purchase, credited: pkg.units, balance, txn };
    // If idempotency is active, cache the response (middleware adds saveIdempotency)
    res.saveIdempotency?.(payload, 201);
    res.status(201).json(payload);
  } catch (e) {
    next(e);
  }
}

/**
 * POST /billing/purchase
 * Body: { packageId }
 * Uses Idempotency-Key to prevent duplicate charging on retries/double-clicks.
 */
r.post("/billing/purchase", requireAuth, requireIdempotencyKey, purchaseHandler);

/* -------------------------
   Aliases for FE compatibility
   ------------------------- */

/** GET /credit-packs  -> same as /billing/packages (authenticated) */
r.get("/credit-packs", requireAuth, async (_req, res, next) => {
  try {
    const items = await prisma.package.findMany({
      where: { active: true },
      orderBy: { units: "asc" },
    });
    res.json(items);
  } catch (e) {
    next(e);
  }
});

/** POST /purchase-credits -> same as /billing/purchase (authenticated + idempotent) */
r.post("/purchase-credits", requireAuth, requireIdempotencyKey, purchaseHandler);

module.exports = r;
