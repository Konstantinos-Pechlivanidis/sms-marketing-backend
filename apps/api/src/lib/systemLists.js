// apps/api/src/lib/systemLists.js
const prisma = require('./prisma');

const SLUG = { MALE: 'male', FEMALE: 'female', HIGH: 'high-conversions' };

async function ensureSystemListsForOwner(ownerId) {
  await prisma.list.upsert({
    where: { ownerId_slug: { ownerId, slug: SLUG.MALE } },
    update: {},
    create: { ownerId, name: 'Male', slug: SLUG.MALE, isSystem: true },
  });
  await prisma.list.upsert({
    where: { ownerId_slug: { ownerId, slug: SLUG.FEMALE } },
    update: {},
    create: { ownerId, name: 'Female', slug: SLUG.FEMALE, isSystem: true },
  });
  // NEW: virtual system list (no memberships; API interprets it)
  await prisma.list.upsert({
    where: { ownerId_slug: { ownerId, slug: SLUG.HIGH } },
    update: {},
    create: { ownerId, name: 'High Conversions (≥2)', slug: SLUG.HIGH, isSystem: true },
  });
}

/**
 * Auto-manage gender lists (male/female) membership.
 * (High conversions is VIRTUAL — no memberships)
 */
async function syncGenderMembership(contact) {
  const { ownerId, id: contactId, gender } = contact;
  await ensureSystemListsForOwner(ownerId);

  const [male, female] = await Promise.all([
    prisma.list.findUnique({ where: { ownerId_slug: { ownerId, slug: SLUG.MALE } } }),
    prisma.list.findUnique({ where: { ownerId_slug: { ownerId, slug: SLUG.FEMALE } } }),
  ]);

  await prisma.listMembership.deleteMany({
    where: { contactId, listId: { in: [male.id, female.id] } },
  });

  if (gender === 'male') {
    await prisma.listMembership.create({ data: { contactId, listId: male.id } });
  } else if (gender === 'female') {
    await prisma.listMembership.create({ data: { contactId, listId: female.id } });
  }
}

module.exports = { ensureSystemListsForOwner, syncGenderMembership, SLUG };
