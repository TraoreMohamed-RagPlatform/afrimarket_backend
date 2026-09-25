const { PrismaClient } = require('@prisma/client');
const { validationResult } = require('express-validator');

const prisma = new PrismaClient();

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
      return res.status(400).json({ error: 'Vous avez déjà noté cette annonce' });
    }

    const rating = await prisma.rating.create({
      data: {
        userId,
        sellerId: listing.userId,
        listingId,
        score: parseInt(score),
        comment: comment || null
      },
      include: {
        user: { select: { id: true, username: true, avatar: true } },
        listing: { select: { id: true, title: true } }
      }
    });

    return res.status(201).json({
      message: 'Rating créé avec succès',
      rating
    });

  } catch (error) {
    console.error('Error creating rating:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
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

    const updatedRating = await prisma.rating.update({
      where: { id: ratingId },
      data: {
        score: score ? parseInt(score) : rating.score,
        comment: comment !== undefined ? comment : rating.comment
      },
      include: {
        user: { select: { id: true, username: true, avatar: true } },
        listing: { select: { id: true, title: true } }
      }
    });

    return res.status(200).json({
      message: 'Rating mis à jour avec succès',
      rating: updatedRating
    });

  } catch (error) {
    console.error('Error updating rating:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
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

    await prisma.rating.delete({
      where: { id: ratingId }
    });

    return res.status(200).json({
      message: 'Rating supprimé avec succès'
    });

  } catch (error) {
    console.error('Error deleting rating:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
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
      where: { id: sellerId }
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

    // Calculer la moyenne
    const allRatings = await prisma.rating.findMany({
      where: { sellerId },
      select: { score: true }
    });

    const avgScore = allRatings.length > 0
      ? (allRatings.reduce((sum, r) => sum + r.score, 0) / allRatings.length).toFixed(2)
      : 0;

    return res.status(200).json({
      message: 'Ratings du vendeur récupérés',
      data: {
        sellerId,
        avgScore: parseFloat(avgScore),
        totalRatings: allRatings.length,
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
    console.error('Error fetching seller ratings:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
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
    console.error('Error fetching listing ratings:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
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
    console.error('Error fetching my ratings:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
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