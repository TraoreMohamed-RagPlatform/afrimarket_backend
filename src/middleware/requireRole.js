const prisma = require('../lib/prisma');

/**
 * Autorise uniquement les utilisateurs ayant l'un des rôles donnés.
 *
 * Le rôle est relu en base à chaque requête (et non pris dans le token) :
 * un rôle retiré ou un compte suspendu prend effet immédiatement.
 * À placer après `authMiddleware`.
 *
 * @param {...string} allowedRoles Rôles autorisés, ex. 'ADMIN'.
 */
const requireRole = (...allowedRoles) => {
  if (allowedRoles.length === 0) {
    throw new Error('requireRole: au moins un rôle est requis');
  }

  return async (req, res, next) => {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, status: true },
      });

      const isActive = user && user.status !== 'SUSPENDED' && user.status !== 'DELETED';
      if (!isActive || !allowedRoles.includes(user.role)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      req.user.role = user.role;
      return next();
    } catch (error) {
      return next(error);
    }
  };
};

module.exports = requireRole;
