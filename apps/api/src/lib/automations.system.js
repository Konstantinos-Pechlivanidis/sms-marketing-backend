// apps/api/src/lib/automations.system.js
const prisma = require('./prisma');

const SYS = {
  BIRTHDAY: 'birthday',
  NAMEDAY: 'nameday',
};

async function ensureSystemAutomationsForOwner(ownerId) {
  // Birthday
  await prisma.automation.upsert({
    where: { ownerId_systemSlug: { ownerId, systemSlug: SYS.BIRTHDAY } },
    update: {},
    create: {
      ownerId,
      title: 'Birthday wishes',
      message: 'Χρόνια πολλά, {firstName}! 🎉 Σας περιμένουμε με ειδική προσφορά.',
      trigger: 'birthday',
      isActive: false,
      isSystem: true,
      systemSlug: SYS.BIRTHDAY,
    },
  });

  // Nameday
  await prisma.automation.upsert({
    where: { ownerId_systemSlug: { ownerId, systemSlug: SYS.NAMEDAY } },
    update: {},
    create: {
      ownerId,
      title: 'Name day wishes',
      message: 'Χρόνια πολλά για τη γιορτή σας, {firstName}! 🎉',
      trigger: 'nameday',
      isActive: false,
      isSystem: true,
      systemSlug: SYS.NAMEDAY,
    },
  });
}

module.exports = { ensureSystemAutomationsForOwner, SYS };
