const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const { apiLimiter } = require('../middleware/apiLimiter');
const { sendNotification } = require('../controllers/notificationController');
const { emitToUser, EVENTS } = require('../services/realtime');
const {
  listMyNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
} = require('../controllers/notificationInboxController');

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

router.get(
  '/',
  authMiddleware,
  query('page').optional().isInt({ min: 1, max: 10000 }),
  validationErrorHandler,
  listMyNotifications
);

// Avant /:id : sinon « unread-count » serait lu comme un identifiant.
router.get('/unread-count', authMiddleware, getUnreadNotificationCount);

router.put('/read-all', authMiddleware, markAllNotificationsRead);

router.put(
  '/:id/read',
  authMiddleware,
  param('id').isString().isLength({ min: 1, max: 64 }),
  validationErrorHandler,
  markNotificationRead
);

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