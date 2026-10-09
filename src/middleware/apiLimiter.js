const { rateLimit } = require('express-rate-limit');

/** Fenêtre et plafond par défaut, par adresse IP, pour toute l'API. */
const API_WINDOW_MS = 15 * 60 * 1000;
const API_MAX_REQUESTS = 300;

/**
 * Limiteur de débit commun (protection contre la saturation et la force brute).
 *
 * Chaque routeur l'applique en premier ; les routes sensibles (connexion,
 * inscription, codes OTP...) ajoutent en plus leur propre limite plus stricte.
 *
 * @param {{ windowMs?: number, limit?: number }} [options]
 */
const createApiLimiter = ({ windowMs = API_WINDOW_MS, limit = API_MAX_REQUESTS } = {}) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  });

/** Instance partagée : une requête n'est comptée qu'une fois. */
const apiLimiter = createApiLimiter();

module.exports = { apiLimiter, createApiLimiter, API_WINDOW_MS, API_MAX_REQUESTS };
