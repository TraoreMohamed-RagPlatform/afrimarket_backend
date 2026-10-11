const express = require('express');
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/authMiddleware');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimitMiddleware');
const { checkLoginLockout } = require('../middleware/loginLockoutMiddleware');
const { apiLimiter } = require('../middleware/apiLimiter');
const { verifyClient } = require('../middleware/verifyClient');
const { PASSWORD_RULE_MESSAGE, isPasswordAcceptable } = require('../utils/passwordPolicy');
const {
  register,
  login,
  getProfile,
  refreshToken,
  sendVerificationEmail,
  confirmEmail,
  logout,
  logoutAll,
  forgotPassword,
  resetPassword,
  changePassword,
} = require('../controllers/authController');

const router = express.Router();

// Limite commune à toute l'API (voir middleware/apiLimiter.js).
router.use(apiLimiter);

// Règle unique pour tout nouveau mot de passe (voir utils/passwordPolicy.js).
const newPasswordRule = (field) =>
  body(field).custom((value) => isPasswordAcceptable(value)).withMessage(PASSWORD_RULE_MESSAGE);

// Jeton de rafraîchissement : chaîne courte, jamais un objet.
const refreshTokenRule = body('refreshToken').isString().isLength({ min: 1, max: 512 });

const validationErrorHandler = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// ========================================
// Register Route (avec rate limiting)
// ========================================

router.post(
  '/register',
  registerLimiter, // Rate limiting pour l'enregistrement
  verifyClient, // Preuve d'un vrai client : App Check (mobile) ou reCAPTCHA (web)
  body('email').isEmail().normalizeEmail(),
  body('username').isLength({ min: 3 }).trim().escape(),
  newPasswordRule('password'),
  body('fullName').trim().escape(),
  validationErrorHandler,
  register
);

// ========================================
// Login Route (avec rate limiting + lockout)
// ========================================

router.post(
  '/login',
  loginLimiter, // Rate limiting
  checkLoginLockout, // Vérifier le verrouillage
  verifyClient, // Preuve d'un vrai client : App Check (mobile) ou reCAPTCHA (web)
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  validationErrorHandler,
  login
);

// ========================================
// Logout Route
// ========================================

// Déconnexion de l'appareil : le jeton de rafraîchissement suffit, ce qui
// permet de se déconnecter même avec un jeton d'accès expiré.
router.post('/logout', refreshTokenRule, validationErrorHandler, logout);

// Déconnexion de tous les appareils.
router.post('/logout-all', authMiddleware, logoutAll);

// ========================================
// Profile Route
// ========================================

router.get('/me', authMiddleware, getProfile);

// ========================================
// Refresh Token Route
// ========================================

router.post('/refresh-token', refreshTokenRule, validationErrorHandler, refreshToken);

// ========================================
// Email Verification Routes
// ========================================

router.post(
  '/verify-email',
  body('email').isEmail().normalizeEmail(),
  validationErrorHandler,
  sendVerificationEmail
);

router.post(
  '/confirm-email',
  body('email').isEmail().normalizeEmail(),
  body('code').notEmpty(),
  validationErrorHandler,
  confirmEmail
);

// ========================================
// Password Management Routes
// ========================================

// Forgot Password - Envoyer code réinitialisation
router.post(
  '/forgot-password',
  body('email').isEmail().normalizeEmail(),
  validationErrorHandler,
  forgotPassword
);

// Reset Password - Réinitialiser avec code
router.post(
  '/reset-password',
  body('email').isEmail().normalizeEmail(),
  body('code').notEmpty().isLength({ min: 6, max: 6 }),
  newPasswordRule('newPassword'),
  validationErrorHandler,
  resetPassword
);

// Change Password - Changer mot de passe (authentifié)
router.post(
  '/change-password',
  authMiddleware,
  body('oldPassword').isString().notEmpty(),
  newPasswordRule('newPassword'),
  validationErrorHandler,
  changePassword
);

module.exports = router;