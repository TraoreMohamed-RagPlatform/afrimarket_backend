const jwt = require('jsonwebtoken');

const generateToken = (userId, expiresIn = '7d') => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn });
};

const verifyToken = (token) => {
  try {
    console.log('🔍 Vérification du token...');
    console.log('JWT_SECRET:', process.env.JWT_SECRET);
    console.log('Token reçu:', token.substring(0, 50) + '...');
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('✅ Token vérifié:', decoded);
    return decoded;
  } catch (error) {
    console.log('❌ Erreur vérification:', error.message);
    return null;
  }
};

module.exports = { generateToken, verifyToken };