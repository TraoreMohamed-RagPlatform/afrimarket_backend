const jwt = require('jsonwebtoken');

const JWT_ALGORITHM = 'HS256';

const generateToken = (userId, expiresIn = '7d') =>
  jwt.sign({ userId }, process.env.JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn,
  });

// Ne jamais journaliser le secret, le token ni son contenu.
const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: [JWT_ALGORITHM],
    });
  } catch {
    return null;
  }
};

module.exports = { generateToken, verifyToken };
