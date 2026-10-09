const { Server } = require('socket.io');

// Store des connexions utilisateurs: { userId: socketId }
const userSockets = {};

/**
 * @param {import('http').Server} server
 * @param {{ corsOrigins?: string[] }} [options] Origines web autorisées.
 */
const initializeSocket = (server, { corsOrigins = [] } = {}) => {
  const io = new Server(server, {
    cors: {
      origin: corsOrigins,
      methods: ['GET', 'POST'],
    },
  });

  // Événement: Un utilisateur se connecte
  io.on('connection', (socket) => {
    console.log(`🔌 User connecté: ${socket.id}`);

    // Événement: User se login (envoie son userId)
    socket.on('user_login', (userId) => {
      userSockets[userId] = socket.id;
      console.log(`✅ User ${userId} connecté (socket: ${socket.id})`);

      // Notifier tous les autres que cet user est ONLINE
      io.emit('user_online', { userId, timestamp: new Date() });
    });

    // Événement: User reçoit un message
    socket.on('message_received', (data) => {
      const { conversationId, senderId, content } = data;
      io.emit('new_message', {
        conversationId,
        senderId,
        content,
        timestamp: new Date(),
      });
    });

    // Événement: Quelqu'un like une annonce
    socket.on('listing_liked', (data) => {
      const { listingId, userId } = data;
      io.emit('listing_liked', {
        listingId,
        userId,
        timestamp: new Date(),
      });
    });

    // Événement: Nouvelle offre reçue
    socket.on('offer_received', (data) => {
      const { listingId, buyerId } = data;
      io.emit('new_offer', {
        listingId,
        buyerId,
        timestamp: new Date(),
      });
    });

    // Événement: User se déconnecte
    socket.on('disconnect', () => {
      // Trouver quel user était connecté avec ce socket
      const userId = Object.keys(userSockets).find(
        (key) => userSockets[key] === socket.id
      );

      if (userId) {
        delete userSockets[userId];
        console.log(`❌ User ${userId} déconnecté`);
        io.emit('user_offline', { userId, timestamp: new Date() });
      }
    });

    // Événement: Erreur
    socket.on('error', (error) => {
      console.error('❌ Socket error:', error);
    });
  });

  return io;
};

module.exports = {
  initializeSocket,
};
