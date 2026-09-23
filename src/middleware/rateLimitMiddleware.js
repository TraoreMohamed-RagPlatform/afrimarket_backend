const rateLimit = require('express-rate-limit');

// Rate limiting général (100 requêtes par 15 minutes)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limite à 100 requêtes par fenêtre
  message: 'Trop de requêtes, veuillez réessayer plus tard.',
  standardHeaders: true, // Retourner les informations de rate limit dans le header `RateLimit-*`
  legacyHeaders: false, // Désactiver le header `X-RateLimit-*`
});

// Rate limiting strict pour le login (5 tentatives par 15 minutes)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Trop de tentatives de connexion. Veuillez réessayer après 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Ne pas compter les tentatives réussies
});

// Rate limiting pour l'enregistrement
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 5,
  message: 'Trop d\'enregistrements. Veuillez réessayer après 1 heure.',
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  generalLimiter,
  loginLimiter,
  registerLimiter,
};