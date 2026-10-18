const prisma = require('../lib/prisma');
const { sendRatingReceivedEmail } = require('../utils/emailTemplates');
const { sendServerError } = require('../utils/httpErrors');
const { createNotification } = require('../services/notificationService');
const { recomputeSellerRating } = require('../services/sellerRating');

/** Code Prisma : contrainte d'unicité violée (deux avis en même temps). */
const UNIQUE_VIOLATION = 'P2002';

// ========================================
// CREATE RATING
// ========================================
const createRating = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { listingId, score, comment } = req.body;

    if (!listingId || !score) {
      return res.status(400).json({ error: 'listingId et score sont requis' });
    }

    if (score < 1 || score > 5) {
      return res.status(400).json({ error: 'La note doit être entre 1 et 5' });
    }

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: { user: true }
    });

    if (!listing) {
      return res.status(404).json({ error: 'Listing non trouvé' });
    }

    if (listing.userId === userId) {
      return res.status(400).json({ error: 'Vous ne pouvez pas noter votre propre annonce' });
    }

    const existingRating = await prisma.rating.findUnique({
      where: {
        userId_listingId: {
          userId,
          listingId
        }
      }
    });

    if (existingRating) {
      return res.status(409).json({ error: 'Vous avez déjà noté cette annonce' });
    }

    // Avis et note moyenne du vendeur : ensemble ou pas du tout.
    let rating;
    try {
      rating = await prisma.$transaction(async (tx) => {
        const created = await tx.rating.create({
          data: {
            userId,
            sellerId: listing.userId,
            listingId,
            score: parseInt(score, 10),
            comment: comment || null
          },
          include: {
            user: { select: { id: true, username: true, avatar: true } },
            listing: { select: { id: true, title: true } }
          }
        });
        await recomputeSellerRating(tx, listing.userId);
        return created;
      });
    } catch (error) {
      // Deux envois simultanés : le second se heurte à la contrainte unique.
      if (error?.code === UNIQUE_VIOLATION) {
        return res.status(409).json({ error: 'Vous avez déjà noté cette annonce' });
      }
      throw error;
    }

    await createNotification({
      prisma,
      userId: listing.userId,
      actorId: userId,
      type: 'RATING_RECEIVED',
      title: 'Nouvel avis',
      message: `Vous avez reçu une note de ${rating.score}/5 pour « ${listing.title} ».`,
      listingId,
    });

    // ✅ ENVOYER EMAIL AU VENDEUR
    try {
      await sendRatingReceivedEmail(
        listing.user,
        { ...rating, listing },
        rating.user.username
      );
    } catch (emailError) {
      console.warn('⚠️ Email non envoyé, mais notation créée:', emailError.message);
      // On continue même si l'email échoue
    }

    return res.status(201).json({
      message: 'Rating créé avec succès',
      rating
    });

  } catch (error) {
    return sendServerError(res, error, 'ratingController.createRating');
  }
};

// ========================================
// UPDATE RATING
// ========================================
const updateRating = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { ratingId } = req.params;
    const { score, comment } = req.body;

    const rating = await prisma.rating.findUnique({
      where: { id: ratingId }
    });

    if (!rating) {
      return res.status(404).json({ error: 'Rating non trouvé' });
    }

    if (rating.userId !== userId) {
      return res.status(403).json({ error: 'Vous ne pouvez modifier que votre propre rating' });
    }

    const updatedRating = await prisma.$transaction(async (tx) => {
      const updated = await tx.rating.update({
        where: { id: ratingId },
        data: {
          score: score !== undefined ? parseInt(score, 10) : rating.score,
          comment: comment !== undefined ? comment || null : rating.comment
        },
        include: {
          user: { select: { id: true, username: true, avatar: true } },
          listing: { select: { id: true, title: true } }
        }
      });
      await recomputeSellerRating(tx, rating.sellerId);
      return updated;
    });

    return res.status(200).json({
      message: 'Rating mis à jour avec succès',
      rating: updatedRating
    });

  } catch (error) {
    return sendServerError(res, error, 'ratingController.updateRating');
  }
};

// ========================================
// DELETE RATING
// ========================================
const deleteRating = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { ratingId } = req.params;

    const rating = await prisma.rating.findUnique({
      where: { id: ratingId }
    });

    if (!rating) {
      return res.status(404).json({ error: 'Rating non trouvé' });
    }

    if (rating.userId !== userId) {
      return res.status(403).json({ error: 'Vous ne pouvez supprimer que votre propre rating' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.rating.delete({ where: { id: ratingId } });
      await recomputeSellerRating(tx, rating.sellerId);
    });

    return res.status(200).json({
      message: 'Rating supprimé avec succès'
    });

  } catch (error) {
    return sendServerError(res, error, 'ratingController.deleteRating');
  }
};

// ========================================
// GET RATINGS BY SELLER
// ========================================
const getRatingsBySeller = async (req, res) => {
  try {
    const { sellerId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const seller = await prisma.user.findUnique({
      where: { id: sellerId },
      select: { id: true, avgRating: true, totalRatings: true }
    });

    if (!seller) {
      return res.status(404).json({ error: 'Vendeur non trouvé' });
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const ratings = await prisma.rating.findMany({
      where: { sellerId },
      include: {
        user: { select: { id: true, username: true, avatar: true } },
        listing: { select: { id: true, title: true } }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limitNum
    });

    const total = await prisma.rating.count({
      where: { sellerId }
    });

    // Moyenne tenue à jour à chaque avis (services/sellerRating.js).
    return res.status(200).json({
      message: 'Ratings du vendeur récupérés',
      data: {
        sellerId,
        avgScore: seller.avgRating ?? 0,
        totalRatings: seller.totalRatings,
        ratings,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    });

  } catch (error) {
    return sendServerError(res, error, 'ratingController.getRatingsBySeller');
  }
};

// ========================================
// GET RATINGS FOR LISTING
// ========================================
const getRatingsForListing = async (req, res) => {
  try {
    const { listingId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const listing = await prisma.listing.findUnique({
      where: { id: listingId }
    });

    if (!listing) {
      return res.status(404).json({ error: 'Listing non trouvé' });
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const ratings = await prisma.rating.findMany({
      where: { listingId },
      include: {
        user: { select: { id: true, username: true, avatar: true } }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limitNum
    });

    const total = await prisma.rating.count({
      where: { listingId }
    });

    return res.status(200).json({
      message: 'Ratings du listing récupérés',
      data: {
        listingId,
        ratings,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    });

  } catch (error) {
    return sendServerError(res, error, 'ratingController.getRatingsForListing');
  }
};

// ========================================
// GET MY RATINGS
// ========================================
const getMyRatings = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { type = 'received', page = 1, limit = 10 } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    let ratings, total;

    if (type === 'given') {
      // Les ratings que j'ai donnés
      ratings = await prisma.rating.findMany({
        where: { userId },
        include: {
          seller: { select: { id: true, username: true, avatar: true } },
          listing: { select: { id: true, title: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum
      });
      total = await prisma.rating.count({ where: { userId } });
    } else {
      // Les ratings que j'ai reçus
      ratings = await prisma.rating.findMany({
        where: { sellerId: userId },
        include: {
          user: { select: { id: true, username: true, avatar: true } },
          listing: { select: { id: true, title: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum
      });
      total = await prisma.rating.count({ where: { sellerId: userId } });
    }

    return res.status(200).json({
      message: 'Mes ratings récupérés',
      data: {
        type,
        ratings,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    });

  } catch (error) {
    return sendServerError(res, error, 'ratingController.getMyRatings');
  }
};

// ========================================
// EXPORT
// ========================================
module.exports = {
  createRating,
  updateRating,
  deleteRating,
  getRatingsBySeller,
  getRatingsForListing,
  getMyRatings
};