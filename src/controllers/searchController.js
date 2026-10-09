const { PrismaClient } = require('@prisma/client');
const { sendServerError } = require('../utils/httpErrors');

const prisma = new PrismaClient();

// ========================================
// ADVANCED SEARCH
// ========================================
const advancedSearch = async (req, res) => {
  try {
    const {
      q = '',                    // Search query (title + description)
      category = '',             // Category filter
      minPrice = 0,              // Minimum price
      maxPrice = 999999,         // Maximum price
      minRating = 0,             // Minimum seller rating
      condition = '',            // Product condition (NEW, LIKE_NEW, GOOD, FAIR)
      sort = 'createdAt_desc',   // Sort option
      page = 1,                  // Pagination
      limit = 20                 // Items per page
    } = req.query;

    // Validation
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;
    const minPriceNum = Math.max(0, parseFloat(minPrice) || 0);
    const maxPriceNum = Math.max(minPriceNum, parseFloat(maxPrice) || 999999);
    const minRatingNum = Math.max(0, Math.min(5, parseFloat(minRating) || 0));

    // Build where clause
    const where = {
      AND: [
        // Search query - full-text search on title and description
        q ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } }
          ]
        } : {},
        // Price range filter
        { price: { gte: minPriceNum, lte: maxPriceNum } },
        // Condition filter (if specified)
        condition ? { condition: condition } : {},
        // Category filter (if specified)
        category ? { categoryId: category } : {}
      ]
    };

    // Remove empty filters
    where.AND = where.AND.filter(filter => Object.keys(filter).length > 0);

    // Define sort options
    const sortMap = {
      'price_asc': { price: 'asc' },
      'price_desc': { price: 'desc' },
      'date_newest': { createdAt: 'desc' },
      'date_oldest': { createdAt: 'asc' },
      'rating_highest': { user: { avgRating: 'desc' } },
      'popular': { favorites: { _count: 'desc' } }
    };

    const orderBy = sortMap[sort] || { createdAt: 'desc' };

    // Execute search query
    const listings = await prisma.listing.findMany({
      where: where.AND.length > 0 ? { AND: where.AND } : {},
      select: {
        id: true,
        title: true,
        description: true,
        price: true,
        condition: true,
        createdAt: true,
        images: {
          select: { url: true },
          take: 1
        },
        user: {
          select: {
            id: true,
            username: true,
            avatar: true,
            avgRating: true,
            totalRatings: true
          }
        },
        category: {
          select: { id: true, name: true }
        },
        _count: {
          select: { favorites: true, ratings: true }
        }
      },
      orderBy: orderBy,
      skip: offset,
      take: limitNum
    });

    // Apply seller rating filter (client-side after fetch)
    const filteredListings = listings.filter(listing => 
      listing.user.avgRating >= minRatingNum
    );

    // Get total count for pagination
    const total = await prisma.listing.count({
      where: where.AND.length > 0 ? { AND: where.AND } : {}
    });


    return res.status(200).json({
      message: 'Recherche effectuée avec succès',
      data: {
        query: q,
        filters: {
          category,
          priceRange: { min: minPriceNum, max: maxPriceNum },
          minRating: minRatingNum,
          condition
        },
        results: filteredListings,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
          hasMore: pageNum < Math.ceil(total / limitNum)
        }
      }
    });

  } catch (error) {
    return sendServerError(res, error, 'searchController.advancedSearch');
  }
};

// ========================================
// GET FILTER OPTIONS (categories, price ranges, etc.)
// ========================================
const getFilterOptions = async (req, res) => {
  try {
    // Get all categories
    const categories = await prisma.category.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' }
    });

    // Get price range
    const priceStats = await prisma.listing.aggregate({
      _min: { price: true },
      _max: { price: true },
      _avg: { price: true }
    });

    // Get conditions
    const conditions = ['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR'];

    return res.status(200).json({
      message: 'Options de filtre récupérées',
      data: {
        categories,
        priceRange: {
          min: priceStats._min.price || 0,
          max: priceStats._max.price || 1000,
          avg: priceStats._avg.price || 500
        },
        conditions,
        sortOptions: [
          { value: 'date_newest', label: 'Plus récent' },
          { value: 'date_oldest', label: 'Plus ancien' },
          { value: 'price_asc', label: 'Prix (croissant)' },
          { value: 'price_desc', label: 'Prix (décroissant)' },
          { value: 'rating_highest', label: 'Meilleur rating' }
        ]
      }
    });

  } catch (error) {
    return sendServerError(res, error, 'searchController.getFilterOptions');
  }
};

module.exports = {
  advancedSearch,
  getFilterOptions
};