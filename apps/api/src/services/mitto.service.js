const prisma = require('../lib/prisma');
const { sanitizeSender } = require('./sender.util');

const BASE = process.env.MITTO_API_BASE || 'https://messaging.mittoapi.com';
const API_KEY = process.env.MITTO_API_KEY;
const TRAFFIC = process.env.SMS_TRAFFIC_ACCOUNT_ID;
const FALLBACK_SENDER = process.env.MITTO_SENDER; // τελικό fallback

async function resolveSender(userId, overrideSender) {
  const s = sanitizeSender(overrideSender);
  if (s) return s;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { senderName: true } });
  const fromUser = sanitizeSender(user?.senderName);
  if (fromUser) return fromUser;

  const fromEnv = sanitizeSender(FALLBACK_SENDER);
  if (fromEnv) return fromEnv;

  throw new Error('No valid sender configured (user or env)');
}

async function mittoFetch(path, body) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Mitto-API-Key': API_KEY },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(()=> ({}));
  if (!res.ok) { const msg = data?.message || data?.error || res.statusText; const err = new Error(`Mitto ${res.status}: ${msg}`); err.status=res.status; err.payload=data; throw err; }
  return data;
}

async function sendBulkStatic({ userId, destinations, text, sender }) {
  const finalSender = await resolveSender(userId, sender);
  return mittoFetch('/api/v1.1/Messages/sendbulk', {
    trafficAccountId: TRAFFIC,
    destinations,
    sms: { text, sender: finalSender }
  });
}

async function sendSingle({ userId, destination, text, sender }) {
  const finalSender = await resolveSender(userId, sender);
  return mittoFetch('/api/v1.1/Messages/send', {
    trafficAccountId: TRAFFIC,
    destination,
    sms: { text, sender: finalSender }
  });
}

module.exports = { sendBulkStatic, sendSingle };
