const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { rateLimit } = require('express-rate-limit');
const messageController = require('../controllers/messageController');

const router = express.Router();

const messageSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 50,
  message: 'Trop de messages',
  standardHeaders: false,
  legacyHeaders: false,
});

const messageReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: 'Trop de demandes',
  standardHeaders: false,
  legacyHeaders: false,
});

// POST /api/messages/conversations
router.post('/conversations', [authMiddleware, messageSendLimiter], (req, res) => {
  messageController.getOrCreateConversation(req, res);
});

// POST /api/messages
router.post('/', [authMiddleware, messageSendLimiter], (req, res) => {
  messageController.sendMessage(req, res);
});

// GET /api/messages/conversations
router.get('/conversations', [authMiddleware, messageReadLimiter], (req, res) => {
  messageController.getConversations(req, res);
});

// GET /api/messages/:conversationId
router.get('/:conversationId', [authMiddleware, messageReadLimiter], (req, res) => {
  messageController.getMessages(req, res);
});

// DELETE /api/messages/:messageId
router.delete('/:messageId', [authMiddleware, messageSendLimiter], (req, res) => {
  messageController.deleteMessage(req, res);
});

module.exports = router;