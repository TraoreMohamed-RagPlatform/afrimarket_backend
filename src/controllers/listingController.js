const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ========================================
// Create Listing
// ========================================
const createListing = async (req, res) => {
  try {
    const { title, description, price, categoryId } = req.body;
    const userId = req.userId;

    // Validation
    if (!title || !description || !price || !categoryId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const listing = await prisma.listing.create({
      data: {
        title: req.body.title,
        description: req.body.description,
        price: req.body.price,
        categoryId: req.body.categoryId,
        userId: req.userId,
        status: 'ACTIVE',
        condition: req.body.condition || 'NEW',
      },
    });

    res.status(201).json({
      message: 'Listing created successfully',
      listing,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ========================================
// Get All Listings
// ========================================
const getListings = async (req, res) => {
  try {
    const { page = 1, limit = 10, categoryId, search } = req.query;
    const skip = (page - 1) * limit;

    const where = {
      status: 'ACTIVE',
    };

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const listings = await prisma.listing.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatar: true,
            avgRating: true,
          },
        },
        category: true,
        images: true,
      },
      skip: parseInt(skip),
      take: parseInt(limit),
      orderBy: {
        createdAt: 'desc',
      },
    });

    const total = await prisma.listing.count({ where });

    res.json({
      listings,
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
// Get Single Listing
// ========================================
const getListing = async (req, res) => {
  try {
    const { id } = req.params;

    const listing = await prisma.listing.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatar: true,
            avgRating: true,
            phone: true,
          },
        },
        category: true,
        images: true,
        ratings: true,
      },
    });

    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    res.json({ listing });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ========================================
// Update Listing
// ========================================
const updateListing = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const { title, description, price, categoryId, status } = req.body;

    // Vérifier que l'utilisateur est propriétaire
    const listing = await prisma.listing.findUnique({
      where: { id },
    });

    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    if (listing.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const updatedListing = await prisma.listing.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(description && { description }),
        ...(price && { price: parseFloat(price) }),
        ...(categoryId && { categoryId }),
        ...(status && { status }),
      },
    });

    res.json({
      message: 'Listing updated successfully',
      listing: updatedListing,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ========================================
// Delete Listing
// ========================================
const deleteListing = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    // Vérifier que l'utilisateur est propriétaire
    const listing = await prisma.listing.findUnique({
      where: { id },
    });

    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    if (listing.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await prisma.listing.delete({
      where: { id },
    });

    res.json({ message: 'Listing deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createListing,
  getListings,
  getListing,
  updateListing,
  deleteListing,
};