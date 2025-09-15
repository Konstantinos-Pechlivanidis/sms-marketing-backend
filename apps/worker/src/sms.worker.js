const crypto = require('node:crypto'); // add

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}
function newUnsubToken() {
  return crypto.randomBytes(24).toString('base64url');
}
async function ensureFreshUnsubToken(contactId) {
  const token = newUnsubToken();
  const tokenHash = sha256Hex(token);
  await prisma.contact.update({
    where: { id: contactId },
    data: { unsubscribeTokenHash: tokenHash }
  });
  return token; // plain για το SMS link
}

const worker = new Worker(
  'smsQueue',
  async (job) => {
    const { messageId } = job.data;

    const msg = await prisma.campaignMessage.findUnique({
      where: { id: messageId },
      include: { campaign: { select: { createdById: true } }, contact: true }
    });
    if (!msg) return;

    // Build links
    const redeemUrl = `${process.env.APP_PUBLIC_BASE_URL}/scan/${msg.trackingId}`;
    const unsubToken = await ensureFreshUnsubToken(msg.contact.id);
    const unsubUrl  = `${process.env.APP_PUBLIC_BASE_URL}/u/${unsubToken}`;

    // Final SMS text
    const text = `${(msg.text || 'Special offer!').trim()}\n` +
                 `Redeem: ${redeemUrl}\n` +
                 `Unsub: ${unsubUrl}`;

    try {
      const resp = await sendSingle({
        userId: msg.campaign.createdById,
        destination: msg.to,
        text
      });
      const providerId = resp?.messageId || resp?.messages?.[0]?.messageId || null;

      await prisma.campaignMessage.update({
        where: { id: msg.id },
        data: { providerMessageId: providerId, sentAt: new Date(), status: 'sent' }
      });
    } catch (e) {
      const retryable = isRetryable(e);
      await prisma.campaignMessage.update({
        where: { id: msg.id },
        data: {
          failedAt: retryable ? null : new Date(),
          status: retryable ? 'queued' : 'failed',
          error: e.message
        }
      });
      if (retryable) throw e;
    }
  },
  { connection, concurrency }
);
