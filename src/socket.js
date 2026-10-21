const { Server } = require('socket.io');
const prisma = require('./lib/prisma');
const { verifyAccessToken } = require('./utils/tokenUtils');
const { sanitizeForLog } = require('./utils/logSafe');
const { userRoom, setRealtimeServer } = require('./services/realtime');

/** Statuts de compte qui n'ont plus accès au temps réel. */
const BLOCKED_STATUSES = new Set(['SUSPENDED', 'DELETED']);

/** Connexions simultanées par compte (plusieurs appareils, pas des centaines). */
const MAX_SOCKETS_PER_USER = 5;

/**
 * Les applications n'envoient rien par Socket.io (tout passe par l'API
 * HTTP, validée et limitée) : un message entrant plus gros que ceci est
 * refusé par la bibliothèque.
 */
const MAX_INCOMING_BYTES = 1024;

/** Jeton : `auth.token` de la poignée de main, jamais dans l'adresse (journaux). */
const handshakeToken = (socket) => {
  const token = socket.handshake.auth?.token;
  return typeof token === 'string' && token.length > 0 && token.length < 4096 ? token : null;
};

/**
 * Vérifie la connexion : jeton d'accès valide, compte actif, nombre de
 * connexions raisonnable. Fermé par défaut : toute erreur refuse.
 *
 * @param {import('socket.io').Server} io
 * @param {{ findUser?: (id: string) => Promise<{ status: string } | null> }} [deps]
 */
const createSocketAuth = (io, { findUser } = {}) => {
  const lookup =
    findUser ?? ((id) => prisma.user.findUnique({ where: { id }, select: { status: true } }));

  return async (socket, next) => {
    try {
      const token = handshakeToken(socket);
      const decoded = token ? verifyAccessToken(token) : null;
      if (!decoded) return next(new Error('unauthorized'));

      const user = await lookup(decoded.userId);
      if (!user || BLOCKED_STATUSES.has(user.status)) return next(new Error('unauthorized'));

      const open = await io.in(userRoom(decoded.userId)).fetchSockets();
      if (open.length >= MAX_SOCKETS_PER_USER) return next(new Error('too_many_connections'));

      socket.data.userId = decoded.userId;
      socket.data.expiresAt = decoded.exp * 1000;
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  };
};

/**
 * Serveur temps réel.
 *
 * Sécurité :
 * - connexion refusée sans jeton d'accès valide (avant : n'importe qui,
 *   avec n'importe quel identifiant via « user_login ») ;
 * - chaque connexion rejoint seulement SON salon `user:<id>` ;
 * - aucun événement envoyé par un client n'est relayé (avant : un client
 *   pouvait diffuser de faux messages ou offres à tout le monde) ;
 * - la présence (« en ligne ») n'est plus diffusée à tous ;
 * - connexion fermée à l'expiration du jeton : l'application se reconnecte
 *   avec un jeton neuf.
 *
 * @param {import('http').Server} server
 * @param {{ corsOrigins?: string[], findUser?: Function }} [options]
 */
const initializeSocket = (server, { corsOrigins = [], findUser } = {}) => {
  const io = new Server(server, {
    cors: {
      origin: corsOrigins,
      methods: ['GET', 'POST'],
    },
    maxHttpBufferSize: MAX_INCOMING_BYTES,
  });

  io.use(createSocketAuth(io, { findUser }));

  io.on('connection', (socket) => {
    const { userId, expiresAt } = socket.data;
    socket.join(userRoom(userId));

    const remaining = Math.max(0, expiresAt - Date.now());
    const expiry = setTimeout(() => socket.disconnect(true), remaining);
    expiry.unref?.();

    // Les clients n'ont rien à envoyer : tout événement entrant est ignoré.
    socket.onAny((event) => {
      console.warn('[socket] événement client ignoré : %s', sanitizeForLog(String(event)));
    });

    socket.on('disconnect', () => clearTimeout(expiry));
  });

  setRealtimeServer(io);
  return io;
};

module.exports = {
  initializeSocket,
  createSocketAuth,
  MAX_SOCKETS_PER_USER,
  MAX_INCOMING_BYTES,
};
