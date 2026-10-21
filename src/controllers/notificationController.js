const { sendServerError } = require('../utils/httpErrors');
const { emitToUser, EVENTS } = require('../services/realtime');

/**
 * Notification temps réel envoyée par un administrateur (route réservée
 * aux administrateurs).
 *
 * Remise au SEUL destinataire (salon `user:<id>`) : avant, elle était
 * diffusée à tous les clients connectés.
 */
const sendNotification = (req, res) => {
  try {
    const { userId, type, title, message, data } = req.body;

    if (!userId || !type || !message) {
      return res.status(400).json({
        error: 'userId, type, et message sont requis',
      });
    }

    const validTypes = ['message', 'listing', 'rating', 'offer', 'online'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        error: `Type doit être l'un de: ${validTypes.join(', ')}`,
      });
    }

    const notification = {
      type,
      title: title || 'Notification AfriMarket',
      message,
      data: data || {},
      createdAt: new Date(),
    };
    const delivered = emitToUser(userId, EVENTS.NOTIFICATION, notification);

    res.json({
      success: true,
      delivered,
      notification: { userId, ...notification },
    });
  } catch (error) {
    sendServerError(res, error, 'notificationController.sendNotification');
  }
};

module.exports = { sendNotification };
