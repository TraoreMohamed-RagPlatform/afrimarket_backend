/**
 * Temps réel (Socket.io) : seul le SERVEUR émet, et seulement vers la
 * personne concernée.
 *
 * Chaque connexion authentifiée rejoint le salon `user:<id>` ; un événement
 * n'est jamais diffusé à tous (`io.emit`) : il contiendrait des données
 * privées (messages, notifications) visibles par n'importe quel client.
 *
 * Jamais bloquant : sans serveur temps réel (tests, script), les appels
 * sont sans effet ; l'application relit de toute façon ses compteurs.
 */

/** @type {import('socket.io').Server | null} */
let io = null;

/** Événements envoyés aux applications (liste fermée). */
const EVENTS = Object.freeze({
  /** Nouvelle notification enregistrée : `{ id, type, title, message, listingId, createdAt }`. */
  NOTIFICATION: 'notification:new',
  /** Nouveau message reçu : `{ conversationId, messageId, senderId, content, createdAt }`. */
  MESSAGE: 'message:new',
});

const userRoom = (userId) => `user:${userId}`;

/** @param {import('socket.io').Server | null} server */
const setRealtimeServer = (server) => {
  io = server;
};

/**
 * Envoie [event] à toutes les connexions de [userId] (téléphone, tablette…).
 * @returns {boolean} vrai si l'événement a été remis au serveur temps réel.
 */
const emitToUser = (userId, event, payload) => {
  if (!io || typeof userId !== 'string' || !userId) return false;
  if (!Object.values(EVENTS).includes(event)) {
    throw new Error(`Événement temps réel inconnu : ${event}`);
  }
  io.to(userRoom(userId)).emit(event, payload);
  return true;
};

/**
 * Ferme toutes les connexions de [userId] : déconnexion de tous les
 * appareils, mot de passe changé, compte supprimé ou suspendu.
 */
const disconnectUser = (userId) => {
  if (!io || typeof userId !== 'string' || !userId) return;
  io.in(userRoom(userId)).disconnectSockets(true);
};

module.exports = { EVENTS, userRoom, setRealtimeServer, emitToUser, disconnectUser };
