const { PrismaClient } = require('@prisma/client');

// Instance unique partagée par toute l'application.
// Chaque `new PrismaClient()` ouvre son propre pool de connexions :
// en créer un par fichier finit par épuiser les connexions PostgreSQL.
// Les nouveaux modules importent cette instance ; les anciens seront migrés.
const prisma = new PrismaClient();

module.exports = prisma;
