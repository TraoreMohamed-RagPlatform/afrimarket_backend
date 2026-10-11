const { generateAccessToken } = require('../../utils/tokenUtils');

// Secret de test uniquement : jamais utilisé hors de Jest.
const TEST_JWT_SECRET = 'test-secret-only-for-jest-0123456789abcdef0123456789abcdef';

const useTestJwtSecret = () => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
};

/** En-tête Authorization valide pour l'utilisateur donné. */
const bearerFor = (userId) => `Bearer ${generateAccessToken(userId)}`;

module.exports = { TEST_JWT_SECRET, useTestJwtSecret, bearerFor };
