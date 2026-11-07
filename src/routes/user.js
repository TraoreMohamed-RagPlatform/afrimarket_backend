// src/routes/user.js

const express = require('express');
const {
  getUserProfile,
  getMyProfile,
  updateMyProfile,
  getMySettings,
  updateMySettings,
  deleteMyAccount,
} = require('../controllers/userController');
const {
  listMyBlocks,
  blockUser,
  unblockUser,
  reportUser,
} = require('../controllers/safetyController');
const { SAFE_ID_PATTERN } = require('../config/messagingOptions');
const {
  USER_REPORT_REASONS,
  REPORT_DETAILS_MAX_LENGTH,
} = require('../config/safetyOptions');
const authMiddleware = require('../middleware/authMiddleware');
const { body, param, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { apiLimiter } = require('../middleware/apiLimiter');

const router = express.Router();

// Limite commune à toute l'API (voir middleware/apiLimiter.js).
router.use(apiLimiter);

// ===== Rate Limiters =====
const profileUpdateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 20, // Maximum 20 mises à jour par heure
  message: 'Trop de mises à jour, veuillez réessayer plus tard.',
  skipSuccessfulRequests: false,
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // Maximum 30 requêtes par minute
  message: 'Trop de requêtes, veuillez réessayer plus tard.',
});

// Par UTILISATEUR (après l'authentification).
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
// Blocages : largement assez pour un usage honnête.
const blockLimiter = perUserLimiter(HOUR_MS, 60);
// Signalements : pas de quoi inonder la modération.
const userReportLimiter = perUserLimiter(HOUR_MS, 10);

// ===== Validation Middleware =====
const validateBlock = [
  body('userId')
    .isString().withMessage('Identifiant invalide')
    .matches(SAFE_ID_PATTERN).withMessage('Identifiant invalide'),
];

const validateUnblock = [
  param('userId').isString().matches(SAFE_ID_PATTERN).withMessage('Identifiant invalide'),
];

const validateUserReport = [
  param('id').isString().matches(SAFE_ID_PATTERN).withMessage('Identifiant invalide'),
  body('reason')
    .isIn(USER_REPORT_REASONS).withMessage('Motif de signalement inconnu'),
  body('details')
    .optional({ values: 'null' })
    .isString().withMessage('Le détail doit être un texte')
    .trim()
    .isLength({ max: REPORT_DETAILS_MAX_LENGTH })
    .withMessage(`Le détail ne doit pas dépasser ${REPORT_DETAILS_MAX_LENGTH} caractères`),
  body('conversationId')
    .optional({ values: 'null' })
    .isString().withMessage('Discussion invalide')
    .matches(SAFE_ID_PATTERN).withMessage('Discussion invalide'),
];

const validateUpdateProfile = [
  body('fullName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 }).withMessage('Le nom doit avoir entre 2 et 100 caractères'),
  
  body('bio')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('La bio ne doit pas dépasser 500 caractères'),
  
  body('phone')
    .optional()
    .trim()
    .matches(/^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,9}$/)
    .withMessage('Le numéro de téléphone est invalide'),
  
  body('location')
    .optional()
    .trim()
    .isLength({ max: 200 }).withMessage('La localisation ne doit pas dépasser 200 caractères'),
  
  body('avatar')
    .optional()
    .isURL().withMessage('L\'avatar doit être une URL valide'),
];

// Paramètres : uniquement des booléens JSON (pas « "true" » ni 1).
const isJsonBoolean = (value) => typeof value === 'boolean';
const validateUpdateSettings = [
  body('privacy').optional().isObject().withMessage('privacy doit être un objet'),
  body('notifications').optional().isObject().withMessage('notifications doit être un objet'),
  ...[
    'privacy.showPhoneNumber',
    'privacy.whatsappEnabled',
    'notifications.messageAlerts',
    'notifications.listingAlerts',
    'notifications.ratingAlerts',
  ].map((field) =>
    body(field).optional().custom(isJsonBoolean).withMessage(`${field} doit être un booléen`),
  ),
];

const validateDeleteAccount = [
  body('password')
    .notEmpty().withMessage('Le mot de passe est requis'),
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

// 👤 GET /api/users/:id - Récupérer profil public d'un utilisateur
router.get(
  '/:id',
  generalLimiter,
  getUserProfile
);

// 👤 GET /api/users/me/profile - Récupérer mon profil (protégé)
router.get(
  '/me/profile',
  authMiddleware,
  generalLimiter,
  getMyProfile
);

// ✏️ PUT /api/users/me/profile - Mettre à jour mon profil (protégé)
router.put(
  '/me/profile',
  authMiddleware,
  profileUpdateLimiter,
  validateUpdateProfile,
  handleValidationErrors,
  updateMyProfile
);

// ⚙️ GET /api/users/me/settings - Récupérer mes paramètres (protégé)
router.get(
  '/me/settings',
  authMiddleware,
  generalLimiter,
  getMySettings
);

// ⚙️ PUT /api/users/me/settings - Mettre à jour mes paramètres (protégé)
router.put(
  '/me/settings',
  authMiddleware,
  profileUpdateLimiter,
  validateUpdateSettings,
  handleValidationErrors,
  updateMySettings
);

// 🚫 GET /api/users/me/blocks - Personnes que j'ai bloquées (protégé)
router.get('/me/blocks', authMiddleware, generalLimiter, listMyBlocks);

// 🚫 POST /api/users/me/blocks - Bloquer une personne (protégé)
router.post(
  '/me/blocks',
  authMiddleware,
  blockLimiter,
  validateBlock,
  handleValidationErrors,
  blockUser
);

// ✅ DELETE /api/users/me/blocks/:userId - Débloquer (protégé)
router.delete(
  '/me/blocks/:userId',
  authMiddleware,
  blockLimiter,
  validateUnblock,
  handleValidationErrors,
  unblockUser
);

// 🚩 POST /api/users/:id/report - Signaler une personne (protégé)
router.post(
  '/:id/report',
  authMiddleware,
  userReportLimiter,
  validateUserReport,
  handleValidationErrors,
  reportUser
);

// 🗑️ DELETE /api/users/me/account - Supprimer mon compte (protégé)
router.delete(
  '/me/account',
  authMiddleware,
  profileUpdateLimiter,
  validateDeleteAccount,
  handleValidationErrors,
  deleteMyAccount
);

module.exports = router;