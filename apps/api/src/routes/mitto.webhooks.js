const express = require('express');
const prisma = require('../lib/prisma');
const pino = require('pino');

const router = express.Router();
const logger = pino({ transport: { target: 'pino-pretty' } });

// Απλός έλεγχος shared secret
function verifySecret(req, res, next) {
  const expected = process.env.WEBHOOK_SECRET;
  const got = req.header('X-Webhook-Token');
  if (!expected) return res.status(500).json({ message: 'Webhook secret not configured' });
  if (got !== expected) return res.status(401).json({ message: 'Unauthorized webhook' });
  next();
}

// Χάρτης status από Mitto → δικά μας πεδία
function mapStatus(s) {
  const v = String(s || '').toLowerCase();
  if (['delivered', 'completed', 'ok'].includes(v)) return 'delivered';
  if (['failed', 'undelivered', 'error'].includes(v)) return 'failed';
  if (['queued', 'accepted', 'sent', 'submitted'].includes(v)) return 'sent';
  return 'unknown';
}

/**
 * Υποστηρίζουμε 2 σχήματα payload:
 *  A) Ενιαίο αντικείμενο: { messageId, status, error, timestamp, destination }
 *  B) Λίστα αντικειμένων: [ { ... }, { ... } ]
 *  Το messageId της Mitto αντιστοιχεί στο δικό μας providerMessageId.
 */
router.post('/webhooks/mitto/dlr', verifySecret, async (req, res) => {
  const body = req.body;
  const events = Array.isArray(body) ? body : [body];

  let updated = 0;
  for (const ev of events) {
    const providerId = ev?.messageId || ev?.id || ev?.MessageId;
    const statusIn = ev?.status || ev?.Status;
    const error = ev?.error || ev?.Error || null;
    const ts = ev?.timestamp || ev?.Timestamp || new Date().toISOString();

    if (!providerId) {
      logger.warn({ ev }, 'DLR without messageId — ignoring');
      continue;
    }

    const mapped = mapStatus(statusIn);

    try {
      if (mapped === 'delivered') {
        const r = await prisma.campaignMessage.updateMany({
          where: { providerMessageId: providerId },
          data: { deliveredAt: new Date(ts), status: 'sent' } // κρατάμε status 'sent', αλλά σημειώνουμε deliveredAt
        });
        updated += r.count;
      } else if (mapped === 'failed') {
        const r = await prisma.campaignMessage.updateMany({
          where: { providerMessageId: providerId },
          data: { failedAt: new Date(ts), status: 'failed', error: error || 'FAILED_DLR' }
        });
        updated += r.count;
      } else if (mapped === 'sent') {
        // προαιρετική ενημέρωση sentAt αν έρθει
        await prisma.campaignMessage.updateMany({
          where: { providerMessageId: providerId },
          data: { sentAt: new Date(ts) }
        });
      } else {
        logger.info({ providerId, ev }, 'DLR unknown status');
      }
    } catch (e) {
      logger.error({ err: e, ev }, 'DLR update error');
    }
  }

  // Δεν σταματάμε το webhook για unmatched events — τα δεχόμαστε (202)
  res.status(202).json({ ok: true, updated });
});

module.exports = router;
