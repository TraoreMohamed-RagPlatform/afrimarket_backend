const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ========================================
// Add to Favorites
// ========================================
const addToFavorites = async (req, res) => {
  try {
    const userId = req.userId;
    const { listingId } = req.body;

    if (!listingId) {
      return res.status(400).json({ error: 'listingId est requis' });
    }

    // Vérifier que le listing existe
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
    });

    if (!listing) {
      return res.status(404).json({ error: 'Listing non trouvé' });
    }

    // Vérifier si déjà en favori
    const existingFavorite = await prisma.favorite.findUnique({
      where: {
        userId_listingId: {
          userId,
          listingId,
        },
      },
    });

    if (existingFavorite) {
      return res.status(400).json({ error: 'Déjà dans vos favoris' });
    }

    // Ajouter aux favoris
    const favorite = await prisma.favorite.create({
      data: {
        userId,
        listingId,
      },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            price: true,
            condition: true,
          },
        },
      },
    });

    res.status(201).json({
      message: 'Ajouté aux favoris',
      favorite,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ========================================
// Remove from Favorites
// ========================================
const removeFromFavorites = async (req, res) => {
  try {
    const userId = req.userId;
    const { listingId } = req.params;

    if (!listingId) {
      return res.status(400).json({ error: 'listingId est requis' });
    }

    // Vérifier que le favori existe
    const favorite = await prisma.favorite.findUnique({
      where: {
        userId_listingId: {
          userId,
          listingId,
        },
      },
    });

    if (!favorite) {
      return res.status(404).json({ error: 'Non trouvé dans vos favoris' });
    }

    // Supprimer des favoris
    await prisma.favorite.delete({
      where: {
        userId_listingId: {
          userId,
          listingId,
        },
      },
    });

    res.json({ message: 'Retiré des favoris' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ========================================
// Get My Favorites
// ========================================
const getMyFavorites = async (req, res) => {
  try {
    const userId = req.userId;
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const favorites = await prisma.favorite.findMany({
      where: { userId },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            description: true,
            price: true,
            condition: true,
            status: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                username: true,
                avatar: true,
                avgRating: true,
              },
            },
            category: {
              select: {
                id: true,
                name: true,
              },
            },
            images: {
              take: 1,
            },
          },
        },
      },
      skip: parseInt(skip),
      take: parseInt(limit),
      orderBy: {
        createdAt: 'desc',
      },
    });

    const total = await prisma.favorite.count({ where: { userId } });

    res.json({
      favorites,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ========================================
// Check if Favorite
// ========================================
const checkFavorite = async (req, res) => {
  try {
    const userId = req.userId;
    const { listingId } = req.params;

    if (!listingId) {
      return res.status(400).json({ error: 'listingId est requis' });
    }

    const favorite = await prisma.favorite.findUnique({
      where: {
        userId_listingId: {
          userId,
          listingId,
        },
      },
    });

    res.json({
      isFavorite: !!favorite,
      favorite: favorite || null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  addToFavorites,
  removeFromFavorites,
  getMyFavorites,
  checkFavorite,
};