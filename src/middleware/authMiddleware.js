const { verifyToken } = require('../utils/tokenUtils');

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = { userId: decoded.userId };  // ✅ Changé ici
  next();
};

module.exports = authMiddleware;