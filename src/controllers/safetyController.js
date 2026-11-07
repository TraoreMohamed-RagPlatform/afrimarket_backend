// Bloquer / débloquer une personne et la signaler (comme Messenger).
//
// Sécurité :
// - la personne bloquée ou signalée n'est jamais prévenue ;
// - un signalement ne peut viser qu'une personne de la discussion indiquée,
//   et n'y copie que ses derniers messages (la personne qui signale le sait) ;
// - réponses neutres : un compte inconnu répond 404, sans autre détail.

const prisma = require('../lib/prisma');
const { sendServerError } = require('../utils/httpErrors');
const { REPORT_MESSAGES_COPIED, BLOCKS_LIST_MAX } = require('../config/safetyOptions');

const PERSON_SELECT = { id: true, fullName: true, username: true, avatar: true, status: true };

const userNotFound = (res) => res.status(404).json({ error: 'User not found' });

/** Compte existant (même suspendu) ; un compte supprimé est introuvable. */
const findPerson = (id) =>
  prisma.user.findUnique({ where: { id }, select: PERSON_SELECT });

/**
 * GET /api/users/me/blocks : personnes que j'ai bloquées, les plus récentes
 * d'abord (Réglages → Personnes bloquées).
 */
const listMyBlocks = async (req, res) => {
  try {
    const rows = await prisma.userBlock.findMany({
      where: { blockerId: req.user.userId },
      orderBy: { createdAt: 'desc' },
      take: BLOCKS_LIST_MAX,
      select: { createdAt: true, blocked: { select: PERSON_SELECT } },
    });
    res.set('Cache-Control', 'no-store');
    return res.json({
      blocks: rows.map(({ blocked, createdAt }) => {
        const isDeleted = blocked.status === 'DELETED';
        return {
          userId: blocked.id,
          name: isDeleted ? null : blocked.fullName || blocked.username,
          avatar: isDeleted ? null : blocked.avatar ?? null,
          blockedAt: createdAt,
        };
      }),
    });
  } catch (error) {
    return sendServerError(res, error, 'safetyController.listMyBlocks');
  }
};

/** POST /api/users/me/blocks { userId } : bloquer (sans effet si déjà fait). */
const blockUser = async (req, res) => {
  try {
    const blockerId = req.user.userId;
    const { userId: blockedId } = req.body;
    if (blockedId === blockerId) {
      return res.status(400).json({ error: 'You cannot block yourself', code: 'CANNOT_BLOCK_SELF' });
    }

    const person = await findPerson(blockedId);
    if (!person || person.status === 'DELETED') return userNotFound(res);

    try {
      await prisma.userBlock.create({ data: { blockerId, blockedId } });
      return res.status(201).json({ blocked: true });
    } catch (error) {
      // Déjà bloquée (ou deux demandes en même temps) : même résultat.
      if (error?.code === 'P2002') return res.json({ blocked: true });
      throw error;
    }
  } catch (error) {
    return sendServerError(res, error, 'safetyController.blockUser');
  }
};

/** DELETE /api/users/me/blocks/:userId : débloquer (sans effet si non bloquée). */
const unblockUser = async (req, res) => {
  try {
    await prisma.userBlock.deleteMany({
      where: { blockerId: req.user.userId, blockedId: req.params.userId },
    });
    return res.status(204).end();
  } catch (error) {
    return sendServerError(res, error, 'safetyController.unblockUser');
  }
};

/**
 * POST /api/users/:id/report { reason, details?, conversationId? } :
 * signaler une personne, depuis une discussion qu'on partage avec elle.
 */
const reportUser = async (req, res) => {
  try {
    const reporterId = req.user.userId;
    const reportedId = req.params.id;
    const { reason, details, conversationId } = req.body;

    if (reportedId === reporterId) {
      return res.status(400).json({ error: 'You cannot report yourself', code: 'CANNOT_REPORT_SELF' });
    }
    const person = await findPerson(reportedId);
    if (!person) return userNotFound(res);

    let messages = [];
    if (conversationId) {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: {
          buyerId: true,
          sellerId: true,
          messages: {
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: REPORT_MESSAGES_COPIED,
            select: { senderId: true, content: true, createdAt: true },
          },
        },
      });
      const people = conversation ? [conversation.buyerId, conversation.sellerId] : [];
      // Seulement une discussion entre ces deux personnes.
      if (!people.includes(reporterId) || !people.includes(reportedId)) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      messages = conversation.messages.reverse().map((message) => ({
        fromReported: message.senderId === reportedId,
        content: message.content,
        createdAt: message.createdAt,
      }));
    }

    try {
      await prisma.userReport.create({
        data: {
          reporterId,
          reportedId,
          conversationId: conversationId ?? null,
          reason,
          details: details || null,
          messages,
        },
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        return res.status(409).json({ error: 'Already reported', code: 'ALREADY_REPORTED' });
      }
      throw error;
    }
    return res.status(201).json({ reported: true });
  } catch (error) {
    return sendServerError(res, error, 'safetyController.reportUser');
  }
};

module.exports = { listMyBlocks, blockUser, unblockUser, reportUser };
