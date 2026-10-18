// Données de référence : les catégories de l'application.
// Sans risque à relancer : chaque catégorie est créée ou mise à jour par
// son identifiant (`slug`) ; les autres catégories ne sont jamais supprimées
// (des annonces peuvent y être rattachées).
//
// Utilisation : npm run db:seed
const { PrismaClient } = require('@prisma/client');
const { CATEGORIES } = require('../src/config/listingOptions');

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
    .then((count) => console.log(`${count} catégories enregistrées`))
    .catch((error) => {
      console.error('Initialisation impossible :', error.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { seedCategories };
