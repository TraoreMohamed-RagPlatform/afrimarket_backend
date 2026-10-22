const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { rateLimit } = require('express-rate-limit');
const authMiddleware = require('../middleware/authMiddleware');
const messageController = require('../controllers/messageController');
const { apiLimiter } = require('../middleware/apiLimiter');
const {
  MESSAGE_MIN_LENGTH,
  MESSAGE_MAX_LENGTH,
  CONVERSATIONS_MAX_PAGE_SIZE,
  MESSAGES_MAX_PAGE_SIZE,
  CONVERSATION_ROLES,
  SAFE_ID_PATTERN,
} = require('../config/messagingOptions');

const router = express.Router();

// Limite commune à toute l'API (voir middleware/apiLimiter.js).
router.use(apiLimiter);

// ===== Limites par UTILISATEUR (après l'authentification) =====

const perUserLimiter = (windowMs, limit, error) =>
  rateLimit({
    windowMs,
    limit,
    keyGenerator: (req) => `user:${req.user.userId}`,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error },
  });

// Nouvelles discussions : assez pour un acheteur, trop peu pour démarcher
// tous les vendeurs de la plateforme.
const conversationStartLimiter = perUserLimiter(60 * 60 * 1000, 30, 'Too many new conversations');
const messageSendLimiter = perUserLimiter(60 * 1000, 30, 'Too many messages');
const messageReadLimiter = perUserLimiter(60 * 1000, 120, 'Too many requests');

// ===== Validation =====

const safeId = (field) =>
  field.isString().withMessage('Identifiant invalide').bail()
    .matches(SAFE_ID_PATTERN).withMessage('Identifiant invalide');

const pageSize = (max) =>
  query('limit').optional().isInt({ min: 1, max }).withMessage(`limit : entre 1 et ${max}`);

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation échouée', details: errors.array() });
  }
  return next();
};

const validateStart = [safeId(body('listingId')), handleValidationErrors];

const validateSend = [
  safeId(body('conversationId')),
  body('content')
    .isString().withMessage('Le message doit être un texte').bail()
    .trim()
    .isLength({ min: MESSAGE_MIN_LENGTH, max: MESSAGE_MAX_LENGTH })
    .withMessage(`Le message doit avoir entre ${MESSAGE_MIN_LENGTH} et ${MESSAGE_MAX_LENGTH} caractères`),
  handleValidationErrors,
];

const validateList = [
  query('role').optional().isIn(CONVERSATION_ROLES).withMessage('Rôle invalide'),
  safeId(query('cursor').optional()),
  pageSize(CONVERSATIONS_MAX_PAGE_SIZE),
  handleValidationErrors,
];

const validateConversationId = [safeId(param('conversationId')), handleValidationErrors];

const validateMessages = [
  safeId(param('conversationId')),
  safeId(query('before').optional()),
  pageSize(MESSAGES_MAX_PAGE_SIZE),
  handleValidationErrors,
];

const validateMessageId = [safeId(param('messageId')), handleValidationErrors];

// ===== Routes (connexion requise) =====

// Ouvrir (ou retrouver) la discussion avec le vendeur d'une annonce.
router.post(
  '/conversations',
  authMiddleware,
  conversationStartLimiter,
  validateStart,
  messageController.startConversation,
);

// Envoyer un message dans une discussion.
router.post('/', authMiddleware, messageSendLimiter, validateSend, messageController.sendMessage);

// Mes discussions (onglets Achat / Vente).
router.get(
  '/conversations',
  authMiddleware,
  messageReadLimiter,
  validateList,
  messageController.getConversations,
);

// En-tête d'une discussion.
router.get(
  '/conversations/:conversationId',
  authMiddleware,
  messageReadLimiter,
  validateConversationId,
  messageController.getConversation,
);

// Pastille de l'onglet Messages (avant /:conversationId).
router.get('/unread-count', authMiddleware, messageReadLimiter, messageController.getUnreadCount);

// Messages d'une discussion.
router.get(
  '/:conversationId',
  authMiddleware,
  messageReadLimiter,
  validateMessages,
  messageController.getMessages,
);

// Supprimer un de ses messages.
router.delete(
  '/:messageId',
  authMiddleware,
  messageSendLimiter,
  validateMessageId,
  messageController.deleteMessage,
);

module.exports = router;
