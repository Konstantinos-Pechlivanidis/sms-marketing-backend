const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function countNulls() {
  const [c1, c2, c3, c4, c5, c6] = await Promise.all([
    prisma.contact.count({ where: { ownerId: null } }),
    prisma.list.count({ where: { ownerId: null } }),
    prisma.messageTemplate.count({ where: { ownerId: null } }),
    prisma.campaign.count({ where: { ownerId: null } }),
    prisma.campaignMessage.count({ where: { ownerId: null } }),
    prisma.redemption.count({ where: { ownerId: null } }),
  ]);
  return { contact: c1, list: c2, template: c3, campaign: c4, message: c5, redemption: c6 };
}

async function main() {
  console.log('[Backfill] Starting ownerId backfill...');

  // Pick default owner (MVP: one user = one store)
  const users = await prisma.user.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
  if (!users.length) throw new Error('No users found in User table.');
  const defaultOwnerId = users[0].id;
  console.log('[Backfill] Default ownerId =', defaultOwnerId);

  console.log('[Backfill] Null counts BEFORE:', await countNulls());

  // 1) Campaign.ownerId = createdById
  await prisma.$executeRawUnsafe(`
    UPDATE "Campaign"
    SET "ownerId" = "createdById"
    WHERE "ownerId" IS NULL
  `);

  // 2) List.ownerId = defaultOwnerId (MVP)
  await prisma.$executeRawUnsafe(`
    UPDATE "List"
    SET "ownerId" = ${defaultOwnerId}
    WHERE "ownerId" IS NULL
  `);

  // 3) Contact.ownerId = defaultOwnerId (MVP)
  await prisma.$executeRawUnsafe(`
    UPDATE "Contact"
    SET "ownerId" = ${defaultOwnerId}
    WHERE "ownerId" IS NULL
  `);

  // 4) MessageTemplate.ownerId: πρώτα από Campaigns που το χρησιμοποιούν
  await prisma.$executeRawUnsafe(`
    UPDATE "MessageTemplate" t
    SET "ownerId" = c."ownerId"
    FROM "Campaign" c
    WHERE t."ownerId" IS NULL AND c."templateId" = t."id"
  `);
  //   μετά ό,τι έμεινε => defaultOwnerId
  await prisma.$executeRawUnsafe(`
    UPDATE "MessageTemplate"
    SET "ownerId" = ${defaultOwnerId}
    WHERE "ownerId" IS NULL
  `);

  // 5) CampaignMessage.ownerId από Campaign
  await prisma.$executeRawUnsafe(`
    UPDATE "CampaignMessage" m
    SET "ownerId" = c."ownerId"
    FROM "Campaign" c
    WHERE m."ownerId" IS NULL AND m."campaignId" = c."id"
  `);

  // 6) Redemption.ownerId από Campaign του message
  await prisma.$executeRawUnsafe(`
    UPDATE "Redemption" r
    SET "ownerId" = c."ownerId"
    FROM "CampaignMessage" m
    JOIN "Campaign" c ON m."campaignId" = c."id"
    WHERE r."ownerId" IS NULL AND r."messageId" = m."id"
  `);

  console.log('[Backfill] Null counts AFTER:', await countNulls());
  console.log('[Backfill] Done.');
}

main()
  .catch((e) => { console.error('[Backfill] ERROR:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());