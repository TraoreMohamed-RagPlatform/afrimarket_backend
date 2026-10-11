const { verifyAccessToken } = require('../utils/tokenUtils');

const BEARER_PREFIX = 'Bearer ';

/**
 * Vérifie le token d'accès et expose l'utilisateur authentifié.
 *
 * Contrat unique pour toute l'API : après ce middleware,
 * `req.user.userId` contient l'identifiant de l'utilisateur.
 * Ne jamais lire `req.userId` (n'existe pas).
 */
const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization;

  if (typeof header !== 'string' || !header.startsWith(BEARER_PREFIX)) {
    return res.status(401).json({ error: 'No token provided' });
  }

  // Seul un jeton d'accès valide (type, émetteur, audience, signature,
  // expiration) est accepté. Fermé par défaut.
  const decoded = verifyAccessToken(header.slice(BEARER_PREFIX.length).trim());

  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = { userId: decoded.userId };
  next();
};

module.exports = authMiddleware;
