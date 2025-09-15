// apps/api/src/services/wallet.service.js
const prisma = require('../lib/prisma');

/**
 * Ensure a wallet row exists for the owner. Returns wallet.
 */
exports.ensureWallet = async (ownerId) => {
  let w = await prisma.wallet.findUnique({ where: { ownerId } });
  if (!w) {
    w = await prisma.wallet.create({ data: { ownerId, balance: 0 } });
  }
  return w;
};

/**
 * Get current balance (ensures wallet exists).
 */
exports.getBalance = async (ownerId) => {
  const w = await exports.ensureWallet(ownerId);
  return w.balance;
};

/**
 * Internal helper to append a transaction & update wallet balance atomically.
 */
async function appendTxnAndUpdate(ownerId, delta, type, { reason, campaignId, messageId, meta } = {}) {
  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where: { ownerId },
      update: {},
      create: { ownerId, balance: 0 },
      select: { id: true, balance: true }
    });

    const newBalance = wallet.balance + delta;
    if (newBalance < 0) {
      throw new Error('INSUFFICIENT_CREDITS');
    }

    // Update wallet
    await tx.wallet.update({
      where: { ownerId },
      data: { balance: newBalance }
    });

    // Insert transaction
    const txn = await tx.creditTransaction.create({
      data: {
        ownerId,
        type,
        amount: Math.abs(delta),         // always positive in record
        balanceAfter: newBalance,
        reason: reason || null,
        campaignId: campaignId || null,
        messageId: messageId || null,
        meta: meta || undefined
      }
    });

    return { balance: newBalance, txn };
  });
}

/**
 * Credit (top-up/purchase/admin grant). Positive amount.
 */
exports.credit = async (ownerId, amount, opts = {}) => {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('INVALID_AMOUNT');
  return appendTxnAndUpdate(ownerId, +amount, 'credit', opts);
};

/**
 * Debit (consume). Positive amount. Throws on insufficient credits.
 */
exports.debit = async (ownerId, amount, opts = {}) => {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('INVALID_AMOUNT');
  return appendTxnAndUpdate(ownerId, -amount, 'debit', opts);
};

/**
 * Refund (give back). Positive amount.
 */
exports.refund = async (ownerId, amount, opts = {}) => {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('INVALID_AMOUNT');
  return appendTxnAndUpdate(ownerId, +amount, 'refund', opts);
};
