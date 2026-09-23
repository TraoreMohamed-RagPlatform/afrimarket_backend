const jwt = require('jsonwebtoken');

const generateToken = (userId, expiresIn = '7d') => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn });
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return null;
    }
    if (error.name === 'JsonWebTokenError') {
      return null;
    }
    return null;
  }
};

module.exports = { generateToken, verifyToken };