const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Envoyer une notification à un utilisateur
const sendNotification = async (req, res) => {
  try {
    const { userId, type, title, message, data } = req.body;

    // Validation
    if (!userId || !type || !message) {
      return res.status(400).json({
        error: 'userId, type, et message sont requis',
      });
    }

    // Types valides
    const validTypes = ['message', 'listing', 'rating', 'offer', 'online'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        error: `Type doit être l'un de: ${validTypes.join(', ')}`,
      });
    }

    // Récupérer Socket.io depuis l'app
    const io = req.app.get('io');

    // Envoyer via WebSocket
    io.emit('notification', {
      userId,
      type,
      title: title || 'Notification AfriMarket',
      message,
      data: data || {},
      timestamp: new Date(),
    });

    res.json({
      success: true,
      message: `Notification envoyée à ${userId}`,
      notification: {
        userId,
        type,
        title,
        message,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Notifier quand un message est reçu
const notifyMessageReceived = (io, conversationId, senderId, content) => {
  io.emit('notification', {
    type: 'message',
    conversationId,
    senderId,
    content,
    title: 'Nouveau message',
    message: `Vous avez reçu un nouveau message`,
    timestamp: new Date(),
  });
};

// Notifier quand une annonce est likée
const notifyListingLiked = (io, listingId, userId) => {
  io.emit('notification', {
    type: 'listing',
    listingId,
    userId,
    title: 'Quelqu\'un aime votre annonce',
    message: `Un utilisateur a liké votre annonce`,
    timestamp: new Date(),
  });
};

// Notifier quand une offre est reçue
const notifyOfferReceived = (io, listingId, buyerId) => {
  io.emit('notification', {
    type: 'offer',
    listingId,
    buyerId,
    title: 'Nouvelle offre reçue',
    message: `Vous avez reçu une nouvelle offre`,
    timestamp: new Date(),
  });
};

// Notifier quand un rating est reçu
const notifyRatingReceived = (io, userId, rating) => {
  io.emit('notification', {
    type: 'rating',
    userId,
    rating,
    title: 'Nouvel avis',
    message: `Vous avez reçu un nouvel avis (${rating} étoiles)`,
    timestamp: new Date(),
  });
};

module.exports = {
  sendNotification,
  notifyMessageReceived,
  notifyListingLiked,
  notifyOfferReceived,
  notifyRatingReceived,
};