// Messagerie : une discussion par annonce et par acheteur (comme Facebook
// Marketplace), messages texte seulement.
//
// Sécurité :
// - seuls l'acheteur et le vendeur voient une discussion ; pour les autres
//   elle n'existe pas (404, pas 403 : on ne confirme pas son existence) ;
// - l'acheteur et le vendeur sont déduits du serveur (personne connectée,
//   auteur de l'annonce), jamais envoyés par l'app ;
// - pas de nouvelle discussion sur sa propre annonce, une annonce vendue ou
//   masquée, ni avec un compte suspendu ou supprimé ;
// - textes vérifiés par la route (1 à 1000 caractères) ;
// - temps réel : seulement à l'autre personne de la discussion.

const prisma = require('../lib/prisma');
const { sendMessageReceivedEmail } = require('../utils/emailTemplates');
const { sendServerError } = require('../utils/httpErrors');
const { recordReply } = require('../services/responseTime');
const { emitToUser, EVENTS } = require('../services/realtime');
const {
  CONVERSATION_SUMMARY_SELECT,
  MESSAGE_SELECT,
  participantFilter,
  isParticipant,
  isOpenForMessages,
  toConversationSummary,
  toMessage,
} = require('../services/conversationView');
const {
  CONVERSATIONS_PAGE_SIZE,
  MESSAGES_PAGE_SIZE,
} = require('../config/messagingOptions');

const notFound = (res) => res.status(404).json({ error: 'Conversation not found' });

/**
 * Taille de page demandée (déjà bornée par la route). Express 5 : la route
 * ne peut pas convertir `req.query`, la conversion se fait ici.
 */
const pageSize = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/** Messages reçus non lus dans une discussion. */
const countUnread = (conversationId, userId) =>
  prisma.message.count({
    where: { conversationId, senderId: { not: userId }, readAt: null },
  });

// ========================================
// POST /api/messages/conversations  { listingId }
// ========================================

/**
 * Ouvre (ou retrouve) la discussion de la personne connectée avec le vendeur
 * de l'annonce. 201 si elle vient d'être créée, 200 si elle existait.
 */
const startConversation = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { listingId } = req.body;

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        userId: true,
        status: true,
        isSold: true,
        user: { select: { status: true } },
      },
    });

    // Annonce masquée : introuvable pour les autres (comme son détail).
    if (!listing || (listing.status === 'INACTIVE' && listing.userId !== userId)) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    if (listing.userId === userId) {
      return res.status(400).json({ error: 'You cannot message your own listing', code: 'OWN_LISTING' });
    }

    const key = { listingId_buyerId: { listingId: listing.id, buyerId: userId } };
    const existing = await prisma.conversation.findUnique({
      where: key,
      select: CONVERSATION_SUMMARY_SELECT,
    });
    if (existing) {
      return res.json(toConversationSummary(existing, userId, await countUnread(existing.id, userId)));
    }

    if (!isOpenForMessages(listing)) {
      return res.status(409).json({ error: 'Listing no longer available', code: 'LISTING_UNAVAILABLE' });
    }
    if (listing.user?.status !== 'ACTIVE') {
      return res.status(409).json({ error: 'Seller unavailable', code: 'RECIPIENT_UNAVAILABLE' });
    }

    try {
      const created = await prisma.conversation.create({
        data: { listingId: listing.id, buyerId: userId, sellerId: listing.userId },
        select: CONVERSATION_SUMMARY_SELECT,
      });
      return res.status(201).json(toConversationSummary(created, userId, 0));
    } catch (error) {
      // Deux demandes en même temps : l'autre l'a créée, on la renvoie.
      if (error?.code === 'P2002') {
        const raced = await prisma.conversation.findUnique({
          where: key,
          select: CONVERSATION_SUMMARY_SELECT,
        });
        if (raced) return res.json(toConversationSummary(raced, userId, 0));
      }
      throw error;
    }
  } catch (error) {
    return sendServerError(res, error, 'messageController.startConversation');
  }
};

// ========================================
// POST /api/messages  { conversationId, content }
// ========================================

const CONTACT_SELECT = { id: true, status: true, email: true, username: true };

/** E-mail « nouveau message » : jamais bloquant, le message est envoyé. */
const emailRecipient = async ({ recipient, sender, message, listingTitle }) => {
  try {
    await sendMessageReceivedEmail(
      recipient,
      sender,
      { content: message.content, conversationId: message.conversationId },
      listingTitle,
    );
  } catch (error) {
    console.warn('⚠️ E-mail de nouveau message non envoyé:', error.message);
  }
};

const sendMessage = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { conversationId, content } = req.body;

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        listing: { select: { title: true } },
        buyer: { select: CONTACT_SELECT },
        seller: { select: CONTACT_SELECT },
        messages: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { senderId: true, createdAt: true },
        },
      },
    });
    if (!isParticipant(conversation, userId)) return notFound(res);

    const isBuyer = conversation.buyerId === userId;
    const sender = isBuyer ? conversation.buyer : conversation.seller;
    const recipient = isBuyer ? conversation.seller : conversation.buyer;
    if (recipient.status !== 'ACTIVE') {
      return res.status(409).json({ error: 'Recipient unavailable', code: 'RECIPIENT_UNAVAILABLE' });
    }

    const message = await prisma.message.create({
      data: { content, senderId: userId, conversationId: conversation.id },
      select: { ...MESSAGE_SELECT, conversationId: true },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: message.createdAt },
    });

    // Temps de réponse habituel (« Répond en moins d'une heure »).
    // Jamais bloquant : le message est déjà envoyé.
    try {
      await recordReply({
        prisma,
        responderId: userId,
        previousMessage: conversation.messages[0],
        now: message.createdAt instanceof Date ? message.createdAt : new Date(),
      });
    } catch (responseTimeError) {
      console.warn('⚠️ Temps de réponse non mis à jour:', responseTimeError.message);
    }

    // Temps réel : seulement à l'autre personne (jamais à tous).
    emitToUser(recipient.id, EVENTS.MESSAGE, {
      conversationId: conversation.id,
      messageId: message.id,
      senderId: userId,
      content: message.content,
      createdAt: message.createdAt,
    });

    // Pas attendu : la réponse ne dépend pas du serveur d'e-mails.
    emailRecipient({
      recipient,
      sender,
      message,
      listingTitle: conversation.listing?.title ?? 'Conversation privée',
    });

    return res.status(201).json(toMessage(message, userId));
  } catch (error) {
    return sendServerError(res, error, 'messageController.sendMessage');
  }
};

// ========================================
// GET /api/messages/conversations?role=&cursor=&limit=
// ========================================

/**
 * Discussions de la personne connectée, dernier message en premier.
 * `role` : `buying` (je suis l'acheteur) ou `selling` (le vendeur) ; absent,
 * les deux. Les discussions sans aucun message ne sont pas listées.
 */
const getConversations = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { role, cursor } = req.query;
    const limit = pageSize(req.query.limit, CONVERSATIONS_PAGE_SIZE);

    const mine =
      role === 'buying'
        ? { buyerId: userId }
        : role === 'selling'
          ? { sellerId: userId }
          : participantFilter(userId);
    const where = { ...mine, lastMessageAt: { not: null } };

    // Curseur : une discussion de cette même liste, sinon refus.
    if (cursor) {
      const anchor = await prisma.conversation.findFirst({
        where: { ...where, id: cursor },
        select: { id: true },
      });
      if (!anchor) return res.status(400).json({ error: 'Invalid cursor' });
    }

    const rows = await prisma.conversation.findMany({
      where,
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: CONVERSATION_SUMMARY_SELECT,
    });
    const page = rows.slice(0, limit);

    const unread = page.length === 0
      ? []
      : await prisma.message.groupBy({
          by: ['conversationId'],
          where: {
            conversationId: { in: page.map((conversation) => conversation.id) },
            senderId: { not: userId },
            readAt: null,
          },
          _count: { _all: true },
        });
    const unreadById = new Map(unread.map((row) => [row.conversationId, row._count._all]));

    res.set('Cache-Control', 'no-store');
    return res.json({
      conversations: page.map((conversation) =>
        toConversationSummary(conversation, userId, unreadById.get(conversation.id) ?? 0)),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    });
  } catch (error) {
    return sendServerError(res, error, 'messageController.getConversations');
  }
};

// ========================================
// GET /api/messages/conversations/:conversationId
// ========================================

/** En-tête d'une discussion (annonce, autre personne), sans les messages. */
const getConversation = async (req, res) => {
  try {
    const userId = req.user.userId;
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.conversationId },
      select: CONVERSATION_SUMMARY_SELECT,
    });
    if (!isParticipant(conversation, userId)) return notFound(res);

    res.set('Cache-Control', 'no-store');
    return res.json(
      toConversationSummary(conversation, userId, await countUnread(conversation.id, userId)),
    );
  } catch (error) {
    return sendServerError(res, error, 'messageController.getConversation');
  }
};

// ========================================
// GET /api/messages/:conversationId?before=&limit=
// ========================================

/**
 * Messages d'une discussion, les plus récents d'abord. `before` : identifiant
 * du plus ancien message déjà affiché (« charger les précédents »).
 * La première page marque comme lus les messages reçus.
 */
const getMessages = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { conversationId } = req.params;
    const { before } = req.query;
    const limit = pageSize(req.query.limit, MESSAGES_PAGE_SIZE);

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, buyerId: true, sellerId: true },
    });
    if (!isParticipant(conversation, userId)) return notFound(res);

    if (before) {
      const anchor = await prisma.message.findFirst({
        where: { id: before, conversationId: conversation.id },
        select: { id: true },
      });
      if (!anchor) return res.status(400).json({ error: 'Invalid cursor' });
    } else {
      await prisma.message.updateMany({
        where: { conversationId: conversation.id, senderId: { not: userId }, readAt: null },
        data: { readAt: new Date() },
      });
    }

    const rows = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(before ? { cursor: { id: before }, skip: 1 } : {}),
      select: MESSAGE_SELECT,
    });
    const page = rows.slice(0, limit);

    res.set('Cache-Control', 'no-store');
    return res.json({
      messages: page.map((message) => toMessage(message, userId)),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    });
  } catch (error) {
    return sendServerError(res, error, 'messageController.getMessages');
  }
};

// ========================================
// GET /api/messages/unread-count
// ========================================

/**
 * Nombre de messages reçus et non lus, toutes discussions confondues
 * (pastille de l'onglet Messages).
 */
const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.userId;
    const count = await prisma.message.count({
      where: {
        readAt: null,
        senderId: { not: userId },
        conversation: { is: participantFilter(userId) },
      },
    });
    res.set('Cache-Control', 'no-store');
    return res.json({ count });
  } catch (error) {
    return sendServerError(res, error, 'messageController.getUnreadCount');
  }
};

// ========================================
// DELETE /api/messages/:messageId
// ========================================

/** Supprime un de ses propres messages. */
const deleteMessage = async (req, res) => {
  try {
    const userId = req.user.userId;
    const message = await prisma.message.findUnique({
      where: { id: req.params.messageId },
      select: { id: true, senderId: true },
    });

    // Message d'autrui : même réponse qu'un message inexistant.
    if (!message || message.senderId !== userId) {
      return res.status(404).json({ error: 'Message not found' });
    }

    await prisma.message.delete({ where: { id: message.id } });
    return res.json({ message: 'Message deleted' });
  } catch (error) {
    return sendServerError(res, error, 'messageController.deleteMessage');
  }
};

module.exports = {
  startConversation,
  sendMessage,
  getConversations,
  getConversation,
  getMessages,
  getUnreadCount,
  deleteMessage,
};
