const { createNotification } = require('./notificationService');
const { sanitizeForLog } = require('../utils/logSafe');

/**
 * Baisse de prix : les personnes qui ont enregistré l'annonce sont
 * prévenues, comme sur Facebook Marketplace.
 *
 * - une seule notification par personne et par annonce sur 24 h (plusieurs
 *   baisses d'affilée ne font pas une rafale) ;
 * - jamais le vendeur ; annonce masquée ou vendue : personne ;
 * - nombre de destinataires borné ; jamais bloquant pour la modification.
 */

const PRICE_DROP_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_RECIPIENTS = 500;

const formatPrice = (value) => `${Number(value).toLocaleString('fr-FR')} DH`;

/**
 * @param {object} params
 * @param {import('@prisma/client').PrismaClient} params.prisma
 * @param {{ id: string, userId: string, title: string }} params.listing
 * @param {number} params.oldPrice
 * @param {number} params.newPrice
 * @param {Date} [params.now]
 * @returns {Promise<number>} Nombre de personnes prévenues.
 */
const notifyPriceDrop = async ({ prisma, listing, oldPrice, newPrice, now = new Date() }) => {
  if (!(newPrice < oldPrice)) return 0;
  try {
    const favorites = await prisma.favorite.findMany({
      where: { listingId: listing.id, userId: { not: listing.userId } },
      select: { userId: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_RECIPIENTS,
    });
    const userIds = [...new Set(favorites.map((favorite) => favorite.userId))];
    if (userIds.length === 0) return 0;

    const recent = await prisma.notification.findMany({
      where: {
        listingId: listing.id,
        type: 'PRICE_DROP',
        userId: { in: userIds },
        createdAt: { gte: new Date(now.getTime() - PRICE_DROP_COOLDOWN_MS) },
      },
      select: { userId: true },
    });
    const alreadyTold = new Set(recent.map((notification) => notification.userId));
    const recipients = userIds.filter((userId) => !alreadyTold.has(userId));

    const sent = await Promise.all(
      recipients.map((userId) =>
        createNotification({
          prisma,
          userId,
          actorId: listing.userId,
          type: 'PRICE_DROP',
          title: 'Baisse de prix',
          message: `Le prix de « ${listing.title} » est passé de ${formatPrice(oldPrice)} à ${formatPrice(newPrice)}.`,
          listingId: listing.id,
        }),
      ),
    );
    return sent.filter(Boolean).length;
  } catch (error) {
    console.warn(
      '[notification] baisse de prix non envoyée pour %s : %s',
      sanitizeForLog(listing.id),
      sanitizeForLog(error?.message ?? ''),
    );
    return 0;
  }
};

module.exports = { notifyPriceDrop, PRICE_DROP_COOLDOWN_MS, MAX_RECIPIENTS };
