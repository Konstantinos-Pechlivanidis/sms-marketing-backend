// Prisma client wrapper (JS)
const { PrismaClient } = require('@prisma/client');

// αποφεύγουμε πολλά instances σε dev (hot reload)
const prisma = global.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') global.prisma = prisma;

module.exports = prisma;
