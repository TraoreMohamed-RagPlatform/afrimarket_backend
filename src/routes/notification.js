const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const { apiLimiter } = require('../middleware/apiLimiter');
const { sendNotification } = require('../controllers/notificationController');
const { emitToUser, EVENTS } = require('../services/realtime');
const {
  MAX_PAGE_SIZE,
  listMyNotifications,
  getUnreadNotificationCount,
  markAllNotificationsSeen,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
} = require('../controllers/notificationInboxController');
const { SAFE_ID_PATTERN } = require('../config/messagingOptions');

const router = express.Router();

// Limite commune à toute l'API (voir middleware/apiLimiter.js).
router.use(apiLimiter);

const validationErrorHandler = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// ========================================
// Mes notifications (connexion requise)
// ========================================

const notificationId = param('id').isString().matches(SAFE_ID_PATTERN);

router.get(
  '/',
  authMiddleware,
  query('cursor').optional().isString().matches(SAFE_ID_PATTERN),
  query('limit').optional().isInt({ min: 1, max: MAX_PAGE_SIZE }),
  validationErrorHandler,
  listMyNotifications
);

// Avant /:id : sinon « unread-count » serait lu comme un identifiant.
router.get('/unread-count', authMiddleware, getUnreadNotificationCount);

// Onglet ouvert : la pastille s'efface (notifications « vues »).
router.put('/seen', authMiddleware, markAllNotificationsSeen);

router.put('/read-all', authMiddleware, markAllNotificationsRead);

router.put('/:id/read', authMiddleware, notificationId, validationErrorHandler, markNotificationRead);

router.delete('/:id', authMiddleware, notificationId, validationErrorHandler, deleteNotification);

// ========================================
// POST /api/notifications - Diffusion en direct (administrateurs)
// ========================================
//
// Sécurité : ces routes envoient un message à TOUS les clients connectés.
// Réservées aux administrateurs : sinon n'importe qui pourrait diffuser un
// faux message « officiel » (hameçonnage).

router.post(
  '/',
  authMiddleware,
  requireRole('ADMIN'),
  body('userId').notEmpty(),
  body('type').isIn(['message', 'listing', 'rating', 'offer', 'online']),
  body('message').notEmpty(),
  validationErrorHandler,
  sendNotification
);

// ========================================
// GET /api/notifications/test - Test WebSocket
// ========================================

// Envoyée seulement à l'administrateur qui fait le test.
router.get('/test', authMiddleware, requireRole('ADMIN'), (req, res) => {
  const delivered = emitToUser(req.user.userId, EVENTS.NOTIFICATION, {
    type: 'test',
    title: 'Test WebSocket',
    message: 'Ceci est un test de WebSocket.',
    createdAt: new Date(),
  });

  res.json({ success: true, delivered });
});

module.exports = router;