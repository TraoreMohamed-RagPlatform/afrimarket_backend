const { verifyToken } = require('../utils/tokenUtils');

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

  const decoded = verifyToken(header.slice(BEARER_PREFIX.length).trim());

  // Fermé par défaut : un token sans identifiant exploitable est refusé.
  if (!decoded || typeof decoded.userId !== 'string' || decoded.userId === '') {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = { userId: decoded.userId };
  next();
};

module.exports = authMiddleware;
