// src/routes/favorite.js

const express = require('express');
const {
  addToFavorites,
  removeFromFavorites,
  getMyFavorites,
  checkFavorite,
} = require('../controllers/favoriteController');
const authMiddleware = require('../middleware/authMiddleware');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// ===== Rate Limiters =====
const favoriteActionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 50, // Maximum 50 actions par minute
  message: 'Trop d\'actions, veuillez réessayer plus tard.',
  skipSuccessfulRequests: false,
});

const favoriteReadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // Maximum 30 lectures par minute
  message: 'Trop de requêtes, veuillez réessayer plus tard.',
});

// ===== Validation Middleware =====
const validateAddFavorite = [
  body('listingId')
    .notEmpty().withMessage('listingId est requis')
    .trim()
    .isLength({ min: 1 }).withMessage('listingId invalide'),
];

// ===== Middleware de validation =====
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation échouée',
      details: errors.array(),
    });
  }
  next();
};

// ===== ROUTES =====

// ❤️ POST /api/favorites - Ajouter aux favoris (protégé)
router.post(
  '/',
  authMiddleware,
  favoriteActionLimiter,
  validateAddFavorite,
  handleValidationErrors,
  addToFavorites
);

// ❤️ DELETE /api/favorites/:listingId - Retirer des favoris (protégé)
router.delete(
  '/:listingId',
  authMiddleware,
  favoriteActionLimiter,
  removeFromFavorites
);

// ❤️ GET /api/favorites - Récupérer mes favoris (protégé)
router.get(
  '/',
  authMiddleware,
  favoriteReadLimiter,
  getMyFavorites
);

// ❤️ GET /api/favorites/check/:listingId - Vérifier si favori (protégé)
router.get(
  '/check/:listingId',
  authMiddleware,
  favoriteReadLimiter,
  checkFavorite
);

module.exports = router;