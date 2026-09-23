// src/routes/listing.js

const express = require('express');
const {
  createListing,
  getListings,
  getListing,
  updateListing,
  deleteListing
} = require('../controllers/listingController');
const authMiddleware = require('../middleware/authMiddleware');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// ===== Rate Limiters pour Listings =====
const listingCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 10, // Maximum 10 créations par heure
  message: 'Trop de listes créées, veuillez réessayer plus tard.',
  skipSuccessfulRequests: false,
});

const listingGeneralLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // Maximum 30 requêtes par minute
  message: 'Trop de requêtes, veuillez réessayer plus tard.',
});

// ===== Validation Middleware =====
const validateCreateListing = [
  body('title')
    .trim()
    .notEmpty().withMessage('Le titre est requis')
    .isLength({ min: 3, max: 200 }).withMessage('Le titre doit avoir entre 3 et 200 caractères'),
  
  body('description')
    .trim()
    .notEmpty().withMessage('La description est requise')
    .isLength({ min: 10, max: 5000 }).withMessage('La description doit avoir entre 10 et 5000 caractères'),
  
  body('price')
    .notEmpty().withMessage('Le prix est requis')
    .isFloat({ min: 0 }).withMessage('Le prix doit être un nombre positif'),
  
  body('categoryId')
    .notEmpty().withMessage('La catégorie est requise')
    .trim()
    .isLength({ min: 1 }).withMessage('L\'ID de catégorie est invalide'),
];

const validateUpdateListing = [
  body('title')
    .optional()
    .trim()
    .isLength({ min: 3, max: 200 }).withMessage('Le titre doit avoir entre 3 et 200 caractères'),
  
  body('description')
    .optional()
    .trim()
    .isLength({ min: 10, max: 5000 }).withMessage('La description doit avoir entre 10 et 5000 caractères'),
  
  body('price')
    .optional()
    .isFloat({ min: 0 }).withMessage('Le prix doit être un nombre positif'),
  
  body('categoryId')
    .optional()
    .trim()
    .isLength({ min: 1 }).withMessage('L\'ID de catégorie est invalide'),
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

// 📝 POST /api/listings - Créer une nouvelle liste
router.post(
  '/',
  authMiddleware, // Authentification requise
  listingCreateLimiter, // Rate limiting
  validateCreateListing, // Validation
  handleValidationErrors, // Gestion d'erreurs
  createListing
);

// 📖 GET /api/listings - Récupérer toutes les listes
router.get(
  '/',
  listingGeneralLimiter, // Rate limiting (pas besoin d'auth)
  getListings
);

// 📄 GET /api/listings/:id - Récupérer une liste spécifique
router.get(
  '/:id',
  listingGeneralLimiter, // Rate limiting
  getListing
);

// ✏️ PUT /api/listings/:id - Mettre à jour une liste
router.put(
  '/:id',
  authMiddleware, // Authentification requise
  listingGeneralLimiter, // Rate limiting
  validateUpdateListing, // Validation
  handleValidationErrors, // Gestion d'erreurs
  updateListing
);

// 🗑️ DELETE /api/listings/:id - Supprimer une liste
router.delete(
  '/:id',
  authMiddleware, // Authentification requise
  listingGeneralLimiter, // Rate limiting
  deleteListing
);

module.exports = router;