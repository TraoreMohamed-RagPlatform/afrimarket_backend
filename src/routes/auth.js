const express = require('express');
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/authMiddleware');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimitMiddleware');
const { checkLoginLockout } = require('../middleware/loginLockoutMiddleware');
const {
  register,
  login,
  getProfile,
  refreshToken,
  sendVerificationEmail,
  confirmEmail,
  logout,
} = require('../controllers/authController');

const router = express.Router();

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

module.exports = router;