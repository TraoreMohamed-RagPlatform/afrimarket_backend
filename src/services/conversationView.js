// Forme des discussions et des messages envoyés à l'app.
//
// Une discussion relie un acheteur et le vendeur d'une annonce. L'app reçoit
// tout ce qu'il faut pour afficher la liste en une seule requête : l'annonce
// (photo, titre, prix, statut), l'autre personne et le dernier message.
// Jamais d'e-mail, de téléphone ni de statut interne d'un autre compte.

const { MESSAGE_PREVIEW_LENGTH, OPEN_FOR_MESSAGES_STATUSES } = require('../config/messagingOptions');

/** Ordre des photos : principale d'abord (même règle que les annonces). */
const PHOTO_ORDER = [{ position: 'asc' }, { createdAt: 'asc' }];

/** Champs publics d'une personne dans une discussion. */
const PERSON_SELECT = {
  id: true,
  fullName: true,
  username: true,
  avatar: true,
  isIdentityVerified: true,
  status: true,
};

/** Champs lus pour résumer une discussion (liste, en-tête du chat). */
const CONVERSATION_SUMMARY_SELECT = {
  id: true,
  buyerId: true,
  sellerId: true,
  lastMessageAt: true,
  createdAt: true,
  listing: {
    select: {
      id: true,
      title: true,
      price: true,
      status: true,
      isSold: true,
      images: { select: { url: true }, orderBy: PHOTO_ORDER, take: 1 },
    },
  },
  buyer: { select: PERSON_SELECT },
  seller: { select: PERSON_SELECT },
  messages: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: { id: true, content: true, senderId: true, createdAt: true },
  },
};

/** Champs d'un message envoyés à l'app. */
const MESSAGE_SELECT = {
  id: true,
  content: true,
  senderId: true,
  createdAt: true,
  readAt: true,
};

/** Filtre Prisma : discussions dont [userId] est l'acheteur ou le vendeur. */
const participantFilter = (userId) => ({ OR: [{ buyerId: userId }, { sellerId: userId }] });

/** [userId] fait-il partie de la discussion ? */
const isParticipant = (conversation, userId) =>
  Boolean(conversation) && (conversation.buyerId === userId || conversation.sellerId === userId);

/** Une nouvelle discussion peut-elle commencer sur cette annonce ? */
const isOpenForMessages = (listing) =>
  OPEN_FOR_MESSAGES_STATUSES.includes(listing.status) && !listing.isSold;

/**
 * L'autre personne, vue par [userId]. Compte supprimé : ni nom ni photo
 * (l'app affiche « Compte supprimé »).
 */
const toPerson = (person, blocked = false) => {
  const isDeleted = person.status === 'DELETED';
  return {
    id: person.id,
    name: isDeleted ? null : person.fullName || person.username,
    avatar: isDeleted ? null : person.avatar ?? null,
    isIdentityVerified: !isDeleted && Boolean(person.isIdentityVerified),
    // Faux : suspendu, supprimé ou bloqué (dans un sens ou dans l'autre) :
    // on ne peut plus lui écrire. Jamais la raison (pas d'indice de blocage).
    canReceiveMessages: person.status === 'ACTIVE' && !blocked,
  };
};

const toListing = (listing) => {
  if (!listing) return null;
  return {
    id: listing.id,
    title: listing.title,
    price: listing.price,
    status: listing.isSold ? 'SOLD' : listing.status,
    photo: listing.images?.[0]?.url ?? null,
  };
};

const preview = (content) =>
  content.length > MESSAGE_PREVIEW_LENGTH
    ? `${content.slice(0, MESSAGE_PREVIEW_LENGTH).trimEnd()}…`
    : content;

/** Pas de blocage (valeur par défaut de [toConversationSummary]). */
const NO_BLOCK = Object.freeze({ blockedByMe: false, blocked: false });

/** L'autre personne de la discussion, vue par [userId]. */
const otherIdOf = (conversation, userId) =>
  conversation.buyerId === userId ? conversation.sellerId : conversation.buyerId;

/**
 * Résumé d'une discussion vu par [userId] : son rôle, l'annonce, l'autre
 * personne, le dernier message et le nombre de messages reçus non lus.
 * [block] : blocage avec l'autre personne (`blockedByMe` est renvoyé à
 * l'app, jamais le fait d'être soi-même bloqué).
 */
const toConversationSummary = (conversation, userId, unreadCount = 0, block = NO_BLOCK) => {
  const isBuyer = conversation.buyerId === userId;
  const last = conversation.messages?.[0];
  return {
    id: conversation.id,
    role: isBuyer ? 'buying' : 'selling',
    listing: toListing(conversation.listing),
    otherUser: toPerson(isBuyer ? conversation.seller : conversation.buyer, block.blocked),
    blockedByMe: block.blockedByMe,
    lastMessage: last
      ? {
          id: last.id,
          preview: preview(last.content),
          isMine: last.senderId === userId,
          createdAt: last.createdAt,
        }
      : null,
    lastMessageAt: conversation.lastMessageAt,
    unreadCount,
  };
};

/** Message vu par [userId]. */
const toMessage = (message, userId) => ({
  id: message.id,
  content: message.content,
  senderId: message.senderId,
  isMine: message.senderId === userId,
  createdAt: message.createdAt,
  readAt: message.readAt ?? null,
});

module.exports = {
  CONVERSATION_SUMMARY_SELECT,
  MESSAGE_SELECT,
  participantFilter,
  isParticipant,
  isOpenForMessages,
  otherIdOf,
  toConversationSummary,
  toMessage,
};
