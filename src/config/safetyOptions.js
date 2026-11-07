// Sécurité entre personnes : signalements et blocages.

/** Motifs d'un signalement de personne (l'app les traduit). */
const USER_REPORT_REASONS = Object.freeze([
  'SCAM', // Arnaque ou tentative de fraude
  'HARASSMENT', // Harcèlement, menaces, insultes
  'SPAM', // Messages indésirables, publicité
  'OFFENSIVE', // Contenu choquant ou inapproprié
  'FAKE_PROFILE', // Faux profil, usurpation d'identité
  'OTHER',
]);

/** Derniers messages copiés dans un signalement (la personne en est prévenue). */
const REPORT_MESSAGES_COPIED = 20;

/** Détail facultatif d'un signalement. */
const REPORT_DETAILS_MAX_LENGTH = 500;

/** Personnes bloquées renvoyées à l'app (Réglages). */
const BLOCKS_LIST_MAX = 200;

module.exports = {
  USER_REPORT_REASONS,
  REPORT_MESSAGES_COPIED,
  REPORT_DETAILS_MAX_LENGTH,
  BLOCKS_LIST_MAX,
};
