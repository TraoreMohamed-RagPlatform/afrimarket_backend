// Données de référence : les catégories de l'application.
// Sans risque à relancer : chaque catégorie est créée ou mise à jour par
// son identifiant (`slug`). Une ancienne catégorie (hors de la liste) est
// retirée du menu : ses annonces sont d'abord rattachées à une catégorie
// de la liste (aucune annonce n'est supprimée).
//
// Utilisation : npm run db:seed
const { PrismaClient } = require('@prisma/client');
const { CATEGORIES } = require('../src/config/listingOptions');

/**
 * Anciennes catégories → catégorie de la liste qui reçoit leurs annonces.
 * Toute autre ancienne catégorie va dans « autres ».
 */
const LEGACY_CATEGORY_TARGETS = Object.freeze({
  'Téléphones': 'articles',
  'Telephones': 'articles',
  'Électronique': 'articles',
  'Meubles': 'articles',
  'Vêtements': 'articles',
  'Immobilier': 'logement',
  'Véhicules': 'transport',
});
const DEFAULT_LEGACY_TARGET = 'autres';

/**
 * Retire les catégories qui ne font plus partie de la liste, après avoir
 * rattaché leurs annonces à une catégorie de la liste.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {Promise<number>} nombre de catégories retirées
 */
const retireLegacyCategories = async (prisma) => {
  const known = CATEGORIES.map((category) => category.slug);
  const legacy = await prisma.category.findMany({
    where: { slug: { notIn: known } },
    select: { id: true, name: true },
  });
  for (const category of legacy) {
    const targetSlug = LEGACY_CATEGORY_TARGETS[category.name] ?? DEFAULT_LEGACY_TARGET;
    const target = await prisma.category.findUnique({ where: { slug: targetSlug } });
    if (!target) continue;
    await prisma.$transaction([
      prisma.listing.updateMany({
        where: { categoryId: category.id },
        data: { categoryId: target.id },
      }),
      prisma.category.delete({ where: { id: category.id } }),
    ]);
  }
  return legacy.length;
};

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {Promise<number>} nombre de catégories enregistrées
 */
const seedCategories = async (prisma) => {
  for (const [position, category] of CATEGORIES.entries()) {
    const data = { ...category, position };
    // Un nom déjà pris par une autre catégorie (créée à la main) bloquerait
    // la contrainte unique : on rattache alors cette catégorie au slug.
    const byName = await prisma.category.findUnique({ where: { name: category.name } });
    if (byName && byName.slug !== category.slug) {
      await prisma.category.update({ where: { id: byName.id }, data });
      continue;
    }
    await prisma.category.upsert({
      where: { slug: category.slug },
      create: data,
      update: data,
    });
  }
  return CATEGORIES.length;
};

if (require.main === module) {
  const prisma = new PrismaClient();
  seedCategories(prisma)
    .then(async (count) => {
      console.log(`${count} catégories enregistrées`);
      const retired = await retireLegacyCategories(prisma);
      console.log(`${retired} ancienne(s) catégorie(s) retirée(s)`);
    })
    .catch((error) => {
      console.error('Initialisation impossible :', error.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { seedCategories, retireLegacyCategories, LEGACY_CATEGORY_TARGETS };
