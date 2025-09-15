
const { PrismaClient } = require('@prisma/client');
const crypto = require('node:crypto');

const prisma = new PrismaClient();

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

async function main() {
  // --- ONLY unsubscribe tokens backfill ---
  const contacts = await prisma.contact.findMany({
    where: { unsubscribeTokenHash: null },
  });

  for (const c of contacts) {
    const token = crypto.randomBytes(24).toString('base64url'); // PLAIN (dev only)
    const tokenHash = sha256Hex(token);
    await prisma.contact.update({
      where: { id: c.id },
      data: { unsubscribeTokenHash: tokenHash },
    });
    console.log(`[DEV ONLY] contact ${c.id} unsubscribe token = ${token}`);
  }

  console.log(`Backfilled unsubscribeTokenHash for ${contacts.length} contacts`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
