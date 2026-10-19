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
const { body, query, validationResult } = require('express-validator');
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
  OWNER_SETTABLE_STATUSES,
  FEED_SORTS,
  CONDITIONS,
  CREATE_STATUSES,
  MAX_PRICE,
} = require('../config/listingOptions');

const router = express.Router();

// Limite commune à toute l'API (voir middleware/apiLimiter.js).
router.use(apiLimiter);

// ===== Rate Limiters pour Listings =====
// Publication : 10 annonces par heure et par UTILISATEUR (après
// l'authentification). Une demande refusée (formulaire invalide) n'est pas
// comptée : corriger une erreur de saisie ne bloque pas le vendeur.
const LISTING_CREATE_WINDOW_MS = 60 * 60 * 1000;
const LISTING_CREATE_MAX = 10;

const listingCreateLimiter = rateLimit({
  windowMs: LISTING_CREATE_WINDOW_MS,
  limit: LISTING_CREATE_MAX,
  keyGenerator: (req) => `user:${req.user.userId}`,
  skipFailedRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Trop d’annonces publiées, veuillez réessayer plus tard.' },
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

  body('condition')
    .optional()
    .isIn(CONDITIONS).withMessage('État inconnu'),
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
    .isFloat({ min: 0, max: MAX_PRICE }).withMessage('Le prix doit être un nombre positif'),
  
  body('categoryId')
    .isString().withMessage('La catégorie est requise')
    .bail()
    .trim()
    .isLength({ min: 1, max: 64 }).withMessage('L\'ID de catégorie est invalide'),

  // Le quartier est obligatoire à la publication (l'acheteur doit savoir
  // où se trouve l'article) ; sa validité est vérifiée par listingDetailsRules.
  body('district')
    .exists({ values: 'null' }).withMessage('Le quartier est requis'),

  // Masquée (INACTIVE) le temps d'envoyer les photos, ou publiée directement.
  body('status')
    .optional()
    .isIn(CREATE_STATUSES).withMessage('Statut invalide'),

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
    .isFloat({ min: 0, max: MAX_PRICE }).withMessage('Le prix doit être un nombre positif'),
  
  body('categoryId')
    .optional()
    .trim()
    .isLength({ min: 1 }).withMessage('L\'ID de catégorie est invalide'),

  // La vente passe par /mark-sold.
  body('status')
    .optional()
    .isIn(OWNER_SETTABLE_STATUSES).withMessage('Statut invalide'),

  ...listingDetailsRules,
];

/** Paramètres du fil : tout paramètre fourni doit être valide. */
const validateFeedQuery = [
  // Chaque paramètre est un texte unique : « ?city=a&city=b » est refusé.
  ...['page', 'limit', 'categoryId', 'city', 'district', 'minPrice', 'maxPrice', 'sort', 'search'].map(
    (name) => query(name).optional().isString().withMessage(`${name} invalide`),
  ),
  query('page').optional().isInt({ min: 1, max: 10000 }).withMessage('Page invalide'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Taille de page invalide'),
  query('categoryId').optional().isLength({ min: 1, max: 64 }).withMessage('Catégorie invalide'),
  query('city').optional().isIn(Object.keys(CITIES)).withMessage('Ville inconnue'),
  query('district')
    .optional()
    .custom((district, { req }) => isKnownDistrict(req.query.city ?? DEFAULT_CITY, district))
    .withMessage('Quartier inconnu'),
  query('minPrice').optional().isFloat({ min: 0 }).withMessage('Prix minimum invalide'),
  query('maxPrice')
    .optional()
    .isFloat({ min: 0 }).withMessage('Prix maximum invalide')
    .bail()
    .custom((max, { req }) => req.query.minPrice === undefined || Number(max) >= Number(req.query.minPrice))
    .withMessage('Le prix maximum doit être supérieur au prix minimum'),
  query('sort').optional().isIn(Object.keys(FEED_SORTS)).withMessage('Tri inconnu'),
  query('search').optional().isLength({ max: 100 }).withMessage('Recherche trop longue'),
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
  validateFeedQuery,
  handleValidationErrors,
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
