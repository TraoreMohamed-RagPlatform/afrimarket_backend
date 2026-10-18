/**
 * Temps de réponse habituel d'un utilisateur aux messages
 * (« Répond généralement en moins d'une heure », comme Facebook Marketplace).
 *
 * Calcul : à chaque réponse dans une conversation, le délai depuis le
 * dernier message de l'autre personne est intégré à une moyenne glissante.
 * Les réponses récentes comptent davantage : un vendeur qui devient plus
 * réactif le voit rapidement.
 */

/** Poids d'une nouvelle réponse dans la moyenne glissante. */
const RECENT_WEIGHT = 0.2;

/** Un délai plus long compte pour 7 jours (évite qu'un seul oubli écrase tout). */
const MAX_DELAY_MINUTES = 7 * 24 * 60;

/** En dessous, l'information n'est pas fiable : elle n'est pas affichée. */
const MIN_SAMPLES = 3;

const MS_PER_MINUTE = 60 * 1000;

/**
 * Nouvelle moyenne après une réponse.
 *
 * @param {number | null | undefined} current Moyenne actuelle (minutes).
 * @param {number} samples Nombre de réponses déjà comptées.
 * @param {number} delayMinutes Délai de cette réponse.
 * @returns {number}
 */
const nextResponseTime = (current, samples, delayMinutes) => {
  const delay = Math.min(Math.max(0, delayMinutes), MAX_DELAY_MINUTES);
  if (!samples || current === null || current === undefined) {
    return Math.round(delay);
  }
  return Math.round(current * (1 - RECENT_WEIGHT) + delay * RECENT_WEIGHT);
};

/**
 * Enregistre une réponse, si le message répond à l'autre personne.
 * Un message qui suit son propre message n'est pas une réponse.
 *
 * @param {object} params
 * @param {import('@prisma/client').PrismaClient} params.prisma
 * @param {string} params.responderId Auteur du nouveau message.
 * @param {{ senderId: string, createdAt: Date | string } | undefined} params.previousMessage
 *   Dernier message de la conversation AVANT le nouveau.
 * @param {Date} [params.now]
 * @returns {Promise<boolean>} true si la réponse a été comptée.
 */
const recordReply = async ({ prisma, responderId, previousMessage, now = new Date() }) => {
  if (!previousMessage || previousMessage.senderId === responderId) {
    return false;
  }

  const sentAt = new Date(previousMessage.createdAt).getTime();
  if (!Number.isFinite(sentAt)) {
    return false;
  }

  const user = await prisma.user.findUnique({
    where: { id: responderId },
    select: { responseTimeMinutes: true, responseSampleCount: true },
  });
  if (!user) {
    return false;
  }

  const delayMinutes = (now.getTime() - sentAt) / MS_PER_MINUTE;
  await prisma.user.update({
    where: { id: responderId },
    data: {
      responseTimeMinutes: nextResponseTime(
        user.responseTimeMinutes,
        user.responseSampleCount,
        delayMinutes,
      ),
      responseSampleCount: { increment: 1 },
    },
  });
  return true;
};

/**
 * Valeur publique : null tant que trop peu de réponses ont été comptées.
 *
 * @param {{ responseTimeMinutes?: number | null, responseSampleCount?: number }} user
 * @returns {number | null}
 */
const publicResponseTime = ({ responseTimeMinutes, responseSampleCount } = {}) =>
  responseSampleCount >= MIN_SAMPLES && Number.isInteger(responseTimeMinutes)
    ? responseTimeMinutes
    : null;

module.exports = {
  RECENT_WEIGHT,
  MAX_DELAY_MINUTES,
  MIN_SAMPLES,
  nextResponseTime,
  recordReply,
  publicResponseTime,
};
