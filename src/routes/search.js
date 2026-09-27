const express = require('express');
const { advancedSearch, getFilterOptions } = require('../controllers/searchController');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Rate limiting for search endpoint
const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 50, // 50 requests per minute
  message: 'Trop de requêtes de recherche, veuillez réessayer plus tard',
  standardHeaders: true,
  legacyHeaders: false
});

const filterLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100, // 100 requests per 5 minutes
  message: 'Trop de requêtes, veuillez réessayer plus tard',
  standardHeaders: true,
  legacyHeaders: false
});

// ========================================
// GET /search - Advanced Search
// ========================================
router.get('/search', searchLimiter, advancedSearch);

// ========================================
// GET /filters - Get Filter Options
// ========================================
router.get('/filters', filterLimiter, getFilterOptions);

module.exports = router;