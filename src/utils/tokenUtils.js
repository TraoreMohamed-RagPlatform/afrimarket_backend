const jwt = require('jsonwebtoken');

const JWT_ALGORITHM = 'HS256';

// Jeton d'accès : courte durée de vie. La révocation passe par les jetons de
// rafraîchissement (services/sessionService.js), qui sont stockés en base.
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const ACCESS_TOKEN_TYPE = 'access';
const TOKEN_ISSUER = 'afrimarket-api';
const TOKEN_AUDIENCE = 'afrimarket-app';

/**
 * Crée un jeton d'accès (JWT) pour l'utilisateur.
 *
 * Le type « access » est vérifié à la lecture : un autre JWT signé avec le
 * même secret (ancien format, autre usage) n'ouvre pas l'API.
 */
const generateAccessToken = (userId) =>
  jwt.sign({ userId, typ: ACCESS_TOKEN_TYPE }, process.env.JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
  });

/**
 * Vérifie un jeton d'accès. Renvoie `{ userId }` ou `null`.
 * Ne jamais journaliser le secret, le jeton ni son contenu.
 */
const verifyAccessToken = (token) => {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: [JWT_ALGORITHM],
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    });
    if (payload.typ !== ACCESS_TOKEN_TYPE || typeof payload.userId !== 'string' || !payload.userId) {
      return null;
    }
    return { userId: payload.userId };
  } catch {
    return null;
  }
};

module.exports = {
  ACCESS_TOKEN_TTL_SECONDS,
  TOKEN_ISSUER,
  TOKEN_AUDIENCE,
  generateAccessToken,
  verifyAccessToken,
};
