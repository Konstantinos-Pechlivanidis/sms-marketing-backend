// apps/api/src/routes/mitto.webhooks.js
const express = require('express');
const prisma = require('../lib/prisma');
const pino = require('pino');
const crypto = require('node:crypto');
const { cacheDel } = require('../lib/cache'); // safe no-op if Redis disabled

const router = express.Router();
const logger = pino({ transport: { target: 'pino-pretty' } });

/**
 * Dev + Prod verification
 * - Dev: ?secret=WEBHOOK_SECRET  OR  header X-Webhook-Token: WEBHOOK_SECRET
 * - Prod: HMAC(SHA256, WEBHOOK_SECRET) over req.rawBody in header X-Webhook-Signature
 *
 * Ensure you have express.json({ verify: (req, _res, buf) => { req.rawBody = buf } })
 * in your server setup so rawBody is available.
 */
function verifyWebhook(req) {
  const shared = process.env.WEBHOOK_SECRET;
  if (!shared) return false;

  // Dev conveniences
  if (req.query?.secret && req.query.secret === shared) return true;
  const token = req.header('X-Webhook-Token');
  if (token && token === shared) return true;

  // Prod HMAC
  const sig = req.header('X-Webhook-Signature');
  if (!sig || !req.rawBody) return false;
  const mac = crypto.createHmac('sha256', shared).update(req.rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(mac, 'utf8'));
  } catch {
    return false;
  }
}

// Map Mitto-like status → our internal buckets
function mapStatus(s) {
  const v = String(s || '').toLowerCase();
  if (['delivered', 'delivrd', 'completed', 'ok'].includes(v)) return 'delivered';
  if (['failed', 'undelivered', 'expired', 'rejected', 'error'].includes(v)) return 'failed';
  if (['queued', 'accepted', 'submitted', 'enroute', 'sent'].includes(v)) return 'sent';
  return 'unknown';
}

/**
 * Persist a raw webhook for auditing/replay/dedup later.
 * Never blocks the request even if it fails.
 */
async function persistWebhook(provider, eventType, payload, providerMessageId) {
  try {
    await prisma.webhookEvent.create({
      data: {
        provider,
        eventType,
        payload,
        providerMessageId: providerMessageId || null
      }
    });
  } catch (e) {
    logger.warn({ err: e?.message }, 'WebhookEvent persist failed');
  }
}

/**
 * --- Delivery Status (DLR) ---
 * Accepts single object or array of objects. Always 202 to avoid retry storms.
 */
router.post('/webhooks/mitto/dlr', async (req, res) => {
  try {
    if (!verifyWebhook(req)) return res.status(401).json({ ok: false });

    const body = req.body;
    const events = Array.isArray(body) ? body : [body];

    let updated = 0;

    for (const ev of events) {
      // Flexible field extraction (Mitto or similar providers)
      const providerId = ev?.messageId || ev?.id || ev?.MessageId || null;
      const statusIn   = ev?.status || ev?.Status || null;
      const doneAt     = ev?.doneAt || ev?.timestamp || ev?.Timestamp || new Date().toISOString();
      const errorDesc  = ev?.error || ev?.Error || ev?.description || null;

      // Persist raw webhook (best-effort)
      await persistWebhook('mitto', 'dlr', ev, providerId);

      if (!providerId) {
        logger.warn({ ev }, 'DLR without messageId — ignoring');
        continue;
      }

      const mapped = mapStatus(statusIn);

      try {
        // We need affected messages to invalidate per-campaign cache
        const msgs = await prisma.campaignMessage.findMany({
          where: { providerMessageId: providerId },
          select: { id: true, campaignId: true, ownerId: true }
        });

        if (msgs.length === 0) {
          logger.info({ providerId }, 'DLR: no local messages matched');
          continue;
        }

        if (mapped === 'delivered') {
          const r = await prisma.campaignMessage.updateMany({
            where: { providerMessageId: providerId },
            data: { status: 'delivered', deliveredAt: new Date(doneAt) }
          });
          updated += r.count;
        } else if (mapped === 'failed') {
          const r = await prisma.campaignMessage.updateMany({
            where: { providerMessageId: providerId },
            data: {
              status: 'failed',
              failedAt: new Date(doneAt),
              error: errorDesc || 'FAILED_DLR'
            }
          });
          updated += r.count;
        } else if (mapped === 'sent') {
          await prisma.campaignMessage.updateMany({
            where: { providerMessageId: providerId },
            data: { status: 'sent', sentAt: new Date(doneAt) }
          });
        } else {
          logger.info({ providerId, statusIn }, 'DLR unknown/ignored status');
        }

        // Cache invalidation for each affected campaign (owner-scoped key)
        for (const m of msgs) {
          const key = `stats:campaign:v1:${m.ownerId}:${m.campaignId}`;
          try { await cacheDel(key); } catch (_) {}
        }
      } catch (e) {
        logger.error({ err: e, providerId, statusIn }, 'DLR update error');
      }
    }

    // Always accept to prevent provider retries
    return res.status(202).json({ ok: true, updated });
  } catch (e) {
    logger.error({ err: e }, 'DLR handler error');
    return res.status(200).json({ ok: true });
  }
});

/**
 * --- Inbound MO (STOP) ---
 * Unsubscribes contact on STOP. Always 202.
 */
function normalizeMsisdn(s) {
  if (!s) return null;
  let v = String(s).trim();
  if (v.startsWith('00')) v = '+' + v.slice(2);
  if (!v.startsWith('+') && /^\d{10,15}$/.test(v)) v = '+30' + v; // adjust default country as needed
  return v;
}

router.post('/webhooks/mitto/inbound', async (req, res) => {
  try {
    if (!verifyWebhook(req)) return res.status(401).json({ ok: false });

    const body = req.body;
    const from = body.from || body.msisdn || body.sender;
    const text = (body.text || body.message || '').toString();

    // Persist inbound for audit (best-effort)
    await persistWebhook('mitto', 'inbound', body, null);

    if (!from || !text) return res.status(202).json({ ok: true });

    const phone = normalizeMsisdn(from);

    // Simple STOP detection (extend with STOPALL etc. if needed)
    if (/^\s*stop\b/i.test(text)) {
      const r = await prisma.contact.updateMany({
        where: { phone, isSubscribed: true },
        data: { isSubscribed: false, unsubscribedAt: new Date() }
      });
      logger.info({ phone, count: r.count }, 'Inbound STOP → unsubscribed');
    }

    return res.status(202).json({ ok: true });
  } catch (e) {
    logger.error({ err: e }, 'Inbound handler error');
    return res.status(200).json({ ok: true });
  }
});

module.exports = router;
