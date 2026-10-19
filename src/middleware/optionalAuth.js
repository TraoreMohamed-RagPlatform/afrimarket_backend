const { verifyAccessToken } = require('../utils/tokenUtils');

const BEARER_PREFIX = 'Bearer ';

/**
 * Authentification facultative, pour les pages publiques qui s'adaptent à
 * la personne connectée (par exemple : « C'est votre annonce »).
 *
 * - jeton d'accès valide : `req.user.userId` est rempli, comme avec
 *   authMiddleware ;
 * - pas de jeton, ou jeton invalide / expiré : la requête continue en
 *   visiteur (jamais de 401 sur une page publique).
 */
const optionalAuth = (req, res, next) => {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith(BEARER_PREFIX)) {
    const decoded = verifyAccessToken(header.slice(BEARER_PREFIX.length).trim());
    if (decoded) req.user = { userId: decoded.userId };
  }
  next();
};

module.exports = optionalAuth;
