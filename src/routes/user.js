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
const authMiddleware = require('../middleware/authMiddleware');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

const router = express.Router();

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

// ===== Validation Middleware =====
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
  updateMySettings
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