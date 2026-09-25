const express = require('express');
const { body, param, query } = require('express-validator');
const ratingController = require('../controllers/ratingController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// ========================================
// POST /api/ratings - CREATE RATING
// ========================================
router.post(
  '/',
  authMiddleware,
  body('listingId').trim().notEmpty().withMessage('listingId est requis'),
  body('score')
    .isInt({ min: 1, max: 5 })
    .withMessage('La note doit être entre 1 et 5'),
  body('comment')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Le commentaire ne doit pas dépasser 1000 caractères'),
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
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Le commentaire ne doit pas dépasser 1000 caractères'),
  ratingController.updateRating
);

// ========================================
// DELETE /api/ratings/:ratingId - DELETE RATING
// ========================================
router.delete(
  '/:ratingId',
  authMiddleware,
  param('ratingId').trim().notEmpty().withMessage('ratingId est requis'),
  ratingController.deleteRating
);

module.exports = router;