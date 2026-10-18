const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const ratingController = require('../controllers/ratingController');
const authMiddleware = require('../middleware/authMiddleware');
const { apiLimiter } = require('../middleware/apiLimiter');

const router = express.Router();

// Limite commune à toute l'API (voir middleware/apiLimiter.js).
router.use(apiLimiter);

// Sans ce contrôle, les règles ci-dessous seraient seulement calculées,
// jamais appliquées.
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation échouée',
      details: errors.array().map(({ path, msg }) => ({ path, msg })),
    });
  }
  return next();
};

// ========================================
// POST /api/ratings - CREATE RATING
// ========================================
router.post(
  '/',
  authMiddleware,
  body('listingId')
    .isString().withMessage('listingId est requis')
    .bail()
    .trim()
    .isLength({ min: 1, max: 64 })
    .withMessage('listingId est requis'),
  body('score')
    .isInt({ min: 1, max: 5 })
    .withMessage('La note doit être entre 1 et 5'),
  body('comment')
    .optional({ values: 'null' })
    .isString().withMessage('Le commentaire doit être un texte')
    .bail()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Le commentaire ne doit pas dépasser 1000 caractères'),
  handleValidationErrors,
  ratingController.createRating
);

// ========================================
// GET /api/ratings/seller/:sellerId - GET RATINGS BY SELLER
// ========================================
router.get(
  '/seller/:sellerId',
  param('sellerId').trim().notEmpty().withMessage('sellerId est requis'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('page doit être un entier positif'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('limit doit être entre 1 et 100'),
  handleValidationErrors,
  ratingController.getRatingsBySeller
);

// ========================================
// GET /api/ratings/listing/:listingId - GET RATINGS FOR LISTING
// ========================================
router.get(
  '/listing/:listingId',
  param('listingId').trim().notEmpty().withMessage('listingId est requis'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('page doit être un entier positif'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('limit doit être entre 1 et 100'),
  handleValidationErrors,
  ratingController.getRatingsForListing
);

// ========================================
// GET /api/ratings/my - GET MY RATINGS
// ========================================
router.get(
  '/my',
  authMiddleware,
  query('type')
    .optional()
    .isIn(['given', 'received'])
    .withMessage('type doit être: given ou received'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('page doit être un entier positif'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('limit doit être entre 1 et 100'),
  handleValidationErrors,
  ratingController.getMyRatings
);

// ========================================
// PUT /api/ratings/:ratingId - UPDATE RATING
// ========================================
router.put(
  '/:ratingId',
  authMiddleware,
  param('ratingId').trim().notEmpty().withMessage('ratingId est requis'),
  body('score')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('La note doit être entre 1 et 5'),
  body('comment')
    .optional({ values: 'null' })
    .isString().withMessage('Le commentaire doit être un texte')
    .bail()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Le commentaire ne doit pas dépasser 1000 caractères'),
  handleValidationErrors,
  ratingController.updateRating
);

// ========================================
// DELETE /api/ratings/:ratingId - DELETE RATING
// ========================================
router.delete(
  '/:ratingId',
  authMiddleware,
  param('ratingId').trim().notEmpty().withMessage('ratingId est requis'),
  handleValidationErrors,
  ratingController.deleteRating
);

module.exports = router;