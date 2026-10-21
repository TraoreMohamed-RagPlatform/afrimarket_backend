// Règles de la messagerie (discussion par annonce, texte seul).
// Les mêmes limites sont appliquées par l'app mobile.

/** Longueur d'un message, espaces autour retirés. */
const MESSAGE_MIN_LENGTH = 1;
const MESSAGE_MAX_LENGTH = 1000;

/** Début du dernier message affiché dans la liste des discussions. */
const MESSAGE_PREVIEW_LENGTH = 120;

/** Pagination : discussions puis messages d'une discussion. */
const CONVERSATIONS_PAGE_SIZE = 20;
const CONVERSATIONS_MAX_PAGE_SIZE = 50;
const MESSAGES_PAGE_SIZE = 30;
const MESSAGES_MAX_PAGE_SIZE = 100;

/** Onglets de la liste : discussions où je suis l'acheteur ou le vendeur. */
const CONVERSATION_ROLES = ['buying', 'selling'];

/** Statuts d'annonce qui permettent d'ouvrir une nouvelle discussion. */
const OPEN_FOR_MESSAGES_STATUSES = ['ACTIVE', 'RESERVED'];

/** Identifiants acceptés (cuid du serveur). */
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

module.exports = {
  MESSAGE_MIN_LENGTH,
  MESSAGE_MAX_LENGTH,
  MESSAGE_PREVIEW_LENGTH,
  CONVERSATIONS_PAGE_SIZE,
  CONVERSATIONS_MAX_PAGE_SIZE,
  MESSAGES_PAGE_SIZE,
  MESSAGES_MAX_PAGE_SIZE,
  CONVERSATION_ROLES,
  OPEN_FOR_MESSAGES_STATUSES,
  SAFE_ID_PATTERN,
};
