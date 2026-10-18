// src/routes/listing.js

const express = require('express');
const {
  createListing,
  getListings,
  getListing,
  getListingContact,
  getSimilarListings,
  updateListing,
  deleteListing,
  markAsSold
} = require('../controllers/listingController');
const authMiddleware = require('../middleware/authMiddleware');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { apiLimiter } = require('../middleware/apiLimiter');
const {
  uploadListingImages,
  deleteListingImage,
  reorderListingImages,
} = require('../controllers/listingImageController');
const { reportListing } = require('../controllers/listingReportController');
const { uploadListingPhotos } = require('../middleware/uploadMiddleware');
const {
  CITIES,
  DEFAULT_CITY,
  isKnownDistrict,
  DELIVERY_MODES,
  REPORT_REASONS,
  MAX_LISTING_PHOTOS,
} = require('../config/listingOptions');

const router = express.Router();

// Limite commune à toute l'API (voir middleware/apiLimiter.js).
router.use(apiLimiter);

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

// Numéro du vendeur : par UTILISATEUR (pas par adresse IP), après
// l'authentification. Assez pour un usage normal, trop peu pour aspirer
// les numéros de la plateforme.
const CONTACT_WINDOW_MS = 60 * 60 * 1000; // 1 heure
const CONTACT_MAX_REQUESTS = 20;

const listingContactLimiter = rateLimit({
  windowMs: CONTACT_WINDOW_MS,
  limit: CONTACT_MAX_REQUESTS,
  keyGenerator: (req) => `user:${req.user.userId}`,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Limites par UTILISATEUR (après l'authentification).
const perUserLimiter = (windowMs, limit) =>
  rateLimit({
    windowMs,
    limit,
    keyGenerator: (req) => `user:${req.user.userId}`,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  });

const HOUR_MS = 60 * 60 * 1000;
// Signalements : assez pour un usage honnête, pas pour inonder la modération.
const listingReportLimiter = perUserLimiter(HOUR_MS, 10);
// Photos : 10 par annonce, quelques annonces par heure.
const listingPhotoLimiter = perUserLimiter(HOUR_MS, 60);

// ===== Validation Middleware =====

/** Champs communs à la création et à la modification (A1, A2, A9). */
const listingDetailsRules = [
  body('city')
    .optional()
    .isIn(Object.keys(CITIES)).withMessage('Ville inconnue'),

  // null (ou absent) : pas de quartier.
  body('district')
    .optional({ values: 'null' })
    .custom((district, { req }) => isKnownDistrict(req.body.city ?? DEFAULT_CITY, district))
    .withMessage('Quartier inconnu'),

  body('isNegotiable')
    .optional()
    .custom((value) => typeof value === 'boolean').withMessage('isNegotiable doit être un booléen'),

  body('deliveryMode')
    .optional()
    .isIn(DELIVERY_MODES).withMessage('Mode de remise inconnu'),
];

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

  ...listingDetailsRules,
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

  // La vente passe par /mark-sold ; les autres statuts sont réservés au serveur.
  body('status')
    .optional()
    .isIn(['ACTIVE', 'INACTIVE']).withMessage('Statut invalide'),

  ...listingDetailsRules,
];

const validateReport = [
  body('reason')
    .isIn(REPORT_REASONS).withMessage('Motif de signalement inconnu'),

  body('details')
    .optional({ values: 'null' })
    .isString().withMessage('Le détail doit être un texte')
    .trim()
    .isLength({ max: 500 }).withMessage('Le détail ne doit pas dépasser 500 caractères'),
];

const validateImageOrder = [
  body('imageIds')
    .isArray({ min: 1, max: MAX_LISTING_PHOTOS }).withMessage('imageIds doit être une liste de photos'),

  body('imageIds.*')
    .isString().withMessage('Identifiant de photo invalide'),
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

// 📞 GET /api/listings/:id/contact - Numéro du vendeur (connexion requise)
router.get(
  '/:id/contact',
  authMiddleware, // Authentification requise
  listingContactLimiter, // Limite par utilisateur
  getListingContact
);

// 🔁 GET /api/listings/:id/similar - Annonces similaires (public)
router.get(
  '/:id/similar',
  listingGeneralLimiter,
  getSimilarListings
);

// 🚩 POST /api/listings/:id/report - Signaler une annonce (connexion requise)
router.post(
  '/:id/report',
  authMiddleware,
  listingReportLimiter,
  validateReport,
  handleValidationErrors,
  reportListing
);

// 🖼️ POST /api/listings/:id/images - Ajouter des photos (multipart, champ « images »)
router.post(
  '/:id/images',
  authMiddleware,
  listingPhotoLimiter,
  uploadListingPhotos,
  uploadListingImages
);

// 🔀 PUT /api/listings/:id/images/order - Réordonner les photos
router.put(
  '/:id/images/order',
  authMiddleware,
  listingGeneralLimiter,
  validateImageOrder,
  handleValidationErrors,
  reorderListingImages
);

// 🗑️ DELETE /api/listings/:id/images/:imageId - Supprimer une photo
router.delete(
  '/:id/images/:imageId',
  authMiddleware,
  listingGeneralLimiter,
  deleteListingImage
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

// 🎉 PUT /api/listings/:id/mark-sold - Marquer une annonce comme vendue
router.put(
  '/:id/mark-sold',
  authMiddleware, // Authentification requise
  listingGeneralLimiter, // Rate limiting
  markAsSold
);

module.exports = router;
