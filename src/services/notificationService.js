const { sanitizeForLog } = require('../utils/logSafe');

/**
 * Notifications enregistrées en base (onglet Notifications et sa pastille).
 *
 * Le texte est en français ; l'application peut afficher son propre texte
 * traduit à partir du `type`. Jamais bloquant : une notification ratée ne
 * fait pas échouer l'action qui l'a déclenchée.
 */

const TITLE_MAX = 100;
const MESSAGE_MAX = 300;

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * @param {object} params
 * @param {import('@prisma/client').PrismaClient} params.prisma
 * @param {string} params.userId Destinataire.
 * @param {string} [params.actorId] Auteur de l'action : jamais notifié de sa propre action.
 * @param {string} params.type Valeur de l'énumération NotificationType.
 * @param {string} params.title
 * @param {string} params.message
 * @param {string} [params.listingId]
 * @returns {Promise<boolean>} true si la notification a été enregistrée.
 */
const createNotification = async ({ prisma, userId, actorId, type, title, message, listingId }) => {
  if (!userId || userId === actorId) return false;
  try {
    await prisma.notification.create({
      data: {
        userId,
        type,
        title: clip(title, TITLE_MAX),
        message: clip(message, MESSAGE_MAX),
        ...(listingId && { listingId }),
      },
    });
    return true;
  } catch (error) {
    console.warn(
      '[notification] non enregistrée pour %s : %s',
      sanitizeForLog(userId),
      sanitizeForLog(error?.message ?? ''),
    );
    return false;
  }
};

module.exports = { createNotification, TITLE_MAX, MESSAGE_MAX };
