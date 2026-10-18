/**
 * Note moyenne d'un vendeur (« 4,8 · 12 avis »).
 *
 * Recalculée à partir de TOUS ses avis à chaque ajout, modification ou
 * suppression, dans la même transaction : la valeur affichée ne peut pas
 * dériver (contrairement à une moyenne mise à jour par incréments).
 */

/** Arrondi à 2 décimales (4.666… → 4.67). */
const roundRating = (value) => Math.round(value * 100) / 100;

/**
 * Recalcule `avgRating` et `totalRatings` du vendeur.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} db Client Prisma
 *   (de préférence celui de la transaction en cours).
 * @param {string} sellerId
 * @returns {Promise<{ avgRating: number, totalRatings: number }>}
 */
const recomputeSellerRating = async (db, sellerId) => {
  const { _avg: avg, _count: count } = await db.rating.aggregate({
    where: { sellerId },
    _avg: { score: true },
    _count: { _all: true },
  });
  const totalRatings = count?._all ?? 0;
  const avgRating = totalRatings > 0 ? roundRating(avg?.score ?? 0) : 0;

  await db.user.update({
    where: { id: sellerId },
    data: { avgRating, totalRatings },
  });
  return { avgRating, totalRatings };
};

module.exports = { recomputeSellerRating, roundRating };
