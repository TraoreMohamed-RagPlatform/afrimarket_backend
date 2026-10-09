const express = require('express');
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/authMiddleware');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimitMiddleware');
const { checkLoginLockout } = require('../middleware/loginLockoutMiddleware');
const { apiLimiter } = require('../middleware/apiLimiter');
const {
  register,
  login,
  getProfile,
  refreshToken,
  sendVerificationEmail,
  confirmEmail,
  logout,
  forgotPassword,
  resetPassword,
  changePassword,
} = require('../controllers/authController');

const router = express.Router();

// Limite commune à toute l'API (voir middleware/apiLimiter.js).
router.use(apiLimiter);

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
  body('email').isEmail().normalizeEmail(),
  body('username').isLength({ min: 3 }).trim().escape(),
  body('password').isLength({ min: 8 }),
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
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  validationErrorHandler,
  login
);

// ========================================
// Logout Route
// ========================================

router.post('/logout', authMiddleware, logout);

// ========================================
// Profile Route
// ========================================

router.get('/me', authMiddleware, getProfile);

// ========================================
// Refresh Token Route
// ========================================

router.post(
  '/refresh-token',
  body('refreshToken').notEmpty(),
  validationErrorHandler,
  refreshToken
);

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
  body('newPassword').isLength({ min: 6 }),
  validationErrorHandler,
  resetPassword
);

// Change Password - Changer mot de passe (authentifié)
router.post(
  '/change-password',
  authMiddleware,
  body('oldPassword').notEmpty(),
  body('newPassword').isLength({ min: 6 }),
  validationErrorHandler,
  changePassword
);

module.exports = router;