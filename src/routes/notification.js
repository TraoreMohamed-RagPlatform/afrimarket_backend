const express = require('express');
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/authMiddleware');
const {
  sendNotification,
} = require('../controllers/notificationController');

const router = express.Router();

const validationErrorHandler = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// ========================================
// POST /api/notifications - Envoyer notification
// ========================================

router.post(
  '/',
  authMiddleware,
  body('userId').notEmpty(),
  body('type').isIn(['message', 'listing', 'rating', 'offer', 'online']),
  body('message').notEmpty(),
  validationErrorHandler,
  sendNotification
);

// ========================================
// GET /api/notifications/test - Test WebSocket
// ========================================

router.get('/test', (req, res) => {
  const io = req.app.get('io');
  
  io.emit('test_notification', {
    type: 'test',
    title: 'Test WebSocket',
    message: 'Ceci est un test de WebSocket!',
    timestamp: new Date(),
  });

  res.json({
    success: true,
    message: 'Notification test envoyée à tous les clients connectés',
  });
});

module.exports = router;