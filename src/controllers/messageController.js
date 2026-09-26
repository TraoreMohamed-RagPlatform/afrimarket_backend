const { PrismaClient } = require('@prisma/client');
const { sendMessageReceivedEmail } = require('../utils/emailTemplates');

const prisma = new PrismaClient();

const getOrCreateConversation = async (req, res) => {
  try {
    const { recipientId } = req.body;
    const userId = req.user.userId;

    // Validation
    if (!recipientId) {
      return res.status(400).json({ error: 'recipientId est requis' });
    }

    if (userId === recipientId) {
      return res.status(400).json({ error: 'Impossible de créer une conversation avec soi-même' });
    }

    // Vérifier que le destinataire existe
    const recipient = await prisma.user.findUnique({
      where: { id: recipientId },
    });

    if (!recipient) {
      return res.status(404).json({ error: 'Utilisateur destinataire non trouvé' });
    }

    // Chercher une conversation existante
    let conversation = await prisma.conversation.findFirst({
      where: {
        AND: [
          { participants: { has: userId } },
          { participants: { has: recipientId } },
        ],
      },
    });

    // Si aucune conversation n'existe, créer une nouvelle
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          participants: [userId, recipientId],
        },
      });
    }

    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const sendMessage = async (req, res) => {
  try {
    const { conversationId, content, listingId } = req.body;
    const userId = req.user.userId;

    // Validation
    if (!content) {
      return res.status(400).json({ error: 'Le contenu du message est requis' });
    }

    // Vérifier que conversationId ou listingId est fourni
    if (!conversationId && !listingId) {
      return res.status(400).json({ error: 'conversationId ou listingId est requis' });
    }

    let message;

    if (conversationId) {
      // Vérifier que la conversation existe et que l'utilisateur en est participant
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } }
      });

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation non trouvée' });
      }

      if (!conversation.participants.includes(userId)) {
        return res.status(403).json({ error: 'Vous ne pouvez pas envoyer de message à cette conversation' });
      }

      // Créer le message
      message = await prisma.message.create({
        data: {
          content,
          senderId: userId,
          conversationId,
        },
      });

      // Mettre à jour lastMessageAt de la conversation
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      });

      // ✅ ENVOYER EMAIL AU DESTINATAIRE
      try {
        // Trouver l'ID du destinataire (l'autre participant dans la conversation)
        const recipientId = conversation.participants.find(id => id !== userId);
        
        // Récupérer les infos du destinataire et de l'expéditeur
        const [recipient, sender] = await Promise.all([
          prisma.user.findUnique({ where: { id: recipientId } }),
          prisma.user.findUnique({ where: { id: userId } })
        ]);

        if (recipient && sender) {
          await sendMessageReceivedEmail(
            recipient,
            sender,
            { content: message.content },
            'Conversation privée'
          );
        }
      } catch (emailError) {
        console.warn('⚠️ Email non envoyé, mais message créé:', emailError.message);
        // On continue même si l'email échoue
      }
    } else if (listingId) {
      // Vérifier que l'annonce existe
      const listing = await prisma.listing.findUnique({
        where: { id: listingId },
        include: { user: true }
      });

      if (!listing) {
        return res.status(404).json({ error: 'Annonce non trouvée' });
      }

      // Créer le message (commentaire sur l'annonce)
      message = await prisma.message.create({
        data: {
          content,
          senderId: userId,
          listingId,
        },
      });

      // ✅ ENVOYER EMAIL AU PROPRIÉTAIRE DE L'ANNONCE
      try {
        if (listing.user && listing.userId !== userId) {
          const sender = await prisma.user.findUnique({ where: { id: userId } });
          
          await sendMessageReceivedEmail(
            listing.user,
            sender,
            { content: message.content },
            listing.title
          );
        }
      } catch (emailError) {
        console.warn('⚠️ Email non envoyé, mais message créé:', emailError.message);
        // On continue même si l'email échoue
      }
    }

    res.json(message);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getConversations = async (req, res) => {
  try {
    const userId = req.user.userId;

    const conversations = await prisma.conversation.findMany({
      where: {
        participants: { has: userId },
      },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    });

    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.userId;

    // Vérifier que la conversation existe et que l'utilisateur en est participant
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation non trouvée' });
    }

    if (!conversation.participants.includes(userId)) {
      return res.status(403).json({ error: 'Vous n\'avez pas accès à cette conversation' });
    }

    // Récupérer les messages
    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });

    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.userId;

    // Vérifier que le message existe et que l'utilisateur en est le créateur
    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      return res.status(404).json({ error: 'Message non trouvé' });
    }

    if (message.senderId !== userId) {
      return res.status(403).json({ error: 'Vous ne pouvez pas supprimer ce message' });
    }

    // Supprimer le message
    await prisma.message.delete({
      where: { id: messageId },
    });

    res.json({ message: 'Message supprimé avec succès' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getOrCreateConversation,
  sendMessage,
  getConversations,
  getMessages,
  deleteMessage,
};