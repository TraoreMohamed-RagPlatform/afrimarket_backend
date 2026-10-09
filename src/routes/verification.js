// src/routes/verification.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/authMiddleware');
const { apiLimiter } = require('../middleware/apiLimiter');
const {
  requestEmailVerification,
  confirmEmail,
  requestPhoneVerification,
  confirmPhone,
  getVerificationStatus,
} = require('../controllers/verificationController');

const router = express.Router();

// Limite commune à toute l'API (voir middleware/apiLimiter.js).
router.use(apiLimiter);

// Rate limiters
const emailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Trop de tentatives de vérification email. Réessayez dans 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
});

const phoneLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Trop de tentatives de vérification téléphone. Réessayez dans 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
});

const confirmLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: 'Trop de tentatives. Réessayez dans 10 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation middleware
const validateEmail = [
  body('email')
    .isEmail()
    .withMessage('Email valide requis')
    .normalizeEmail(),
];

const validateEmailConfirm = [
  body('email')
    .isEmail()
    .withMessage('Email valide requis')
    .normalizeEmail(),
  body('code')
    .isLength({ min: 6, max: 6 })
    .withMessage('Code à 6 chiffres requis')
    .isNumeric(),
];

const validatePhone = [
  body('phone')
    .notEmpty()
    .withMessage('Numéro de téléphone requis')
    .trim(),
];

const validatePhoneConfirm = [
  body('phone')
    .notEmpty()
    .withMessage('Numéro de téléphone requis')
    .trim(),
  body('code')
    .isLength({ min: 6, max: 6 })
    .withMessage('Code à 6 chiffres requis')
    .isNumeric(),
];

// Middleware de gestion des erreurs de validation
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Routes
router.post(
  '/request-email',
  authMiddleware,
  emailLimiter,
  validateEmail,
  handleValidationErrors,
  requestEmailVerification
);

router.post(
  '/confirm-email',
  authMiddleware,
  confirmLimiter,
  validateEmailConfirm,
  handleValidationErrors,
  confirmEmail
);

router.post(
  '/request-phone',
  authMiddleware,
  phoneLimiter,
  validatePhone,
  handleValidationErrors,
  requestPhoneVerification
);

router.post(
  '/confirm-phone',
  authMiddleware,
  confirmLimiter,
  validatePhoneConfirm,
  handleValidationErrors,
  confirmPhone
);

router.get('/status', authMiddleware, getVerificationStatus);

module.exports = router;
