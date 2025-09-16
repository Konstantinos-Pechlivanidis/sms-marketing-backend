// apps/api/src/services/campaignFinalizer.service.js
const prisma = require('../lib/prisma');

/**
 * Mark campaign as completed when no non-terminal messages remain.
 * Non-terminal = 'queued' or 'sent'
 */
async function finalizeCampaignIfDone(campaignId) {
  if (!campaignId) return;

  const remaining = await prisma.campaignMessage.count({
    where: { campaignId, status: { in: ['queued', 'sent'] } },
  });

  if (remaining === 0) {
    await prisma.campaign.updateMany({
      where: { id: campaignId, status: { not: 'completed' } },
      data: { status: 'completed', finishedAt: new Date() },
    });
  }
}

module.exports = { finalizeCampaignIfDone };
