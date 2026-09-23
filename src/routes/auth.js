const express = require('express');
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/authMiddleware');
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

router.post(
  '/register',
  body('email').isEmail().normalizeEmail(),
  body('username').isLength({ min: 3 }).trim().escape(),
  body('password').isLength({ min: 8 }),
  body('fullName').trim().escape(),
  validationErrorHandler,
  register
);

router.post(
  '/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  validationErrorHandler,
  login
);

router.post('/logout', authMiddleware, logout);
router.get('/me', authMiddleware, getProfile);

router.post(
  '/refresh-token',
  body('refreshToken').notEmpty(),
  validationErrorHandler,
  refreshToken
);

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