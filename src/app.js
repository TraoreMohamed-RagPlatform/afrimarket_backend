const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');

const prisma = require('./lib/prisma');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const listingRoutes = require('./routes/listing');
const userRoutes = require('./routes/user');
const favoriteRoutes = require('./routes/favorite');
const messageRoutes = require('./routes/message');
const notificationRoutes = require('./routes/notification');
const ratingRoutes = require('./routes/rating');
const fcmRoutes = require('./routes/fcm');
const searchRoutes = require('./routes/search');
const verificationRoutes = require('./routes/verification');
const supportRoutes = require('./routes/support');
const adminReportRoutes = require('./routes/adminReports');
const identityVerificationRoutes = require('./routes/identityVerificationRoutes');
const adminIdentityVerificationRoutes = require('./routes/adminIdentityVerificationRoutes');

/** Taille maximale d'un corps JSON (les fichiers passent par multer). */
const JSON_BODY_LIMIT = '100kb';

/**
 * Autorise les clients sans en-tête Origin (applications mobiles, outils
 * serveur) et, côté navigateur, uniquement les origines de la liste blanche.
 */
const buildCorsOptions = (allowedOrigins) => ({
  origin(origin, callback) {
    callback(null, !origin || allowedOrigins.includes(origin));
  },
});

/**
 * Construit l'application Express, sans démarrer de serveur.
 * Séparer l'application du serveur permet de la tester avec supertest.
 *
 * @param {{ corsOrigins?: string[] }} [options]
 */
const createApp = ({ corsOrigins = [] } = {}) => {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors(buildCorsOptions(corsOrigins)));
  app.use(compression());
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.use('/api/auth', authRoutes);
  app.use('/api/listings', listingRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/favorites', favoriteRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/ratings', ratingRoutes);
  app.use('/api/fcm', fcmRoutes);
  app.use('/api', searchRoutes);
  app.use('/api/verification', verificationRoutes);
  app.use('/api/support', supportRoutes);
  app.use('/api/identity-verification', identityVerificationRoutes);
  app.use('/api/admin/reports', adminReportRoutes);
  app.use('/api/admin/identity-verification', adminIdentityVerificationRoutes);

  app.get('/api/health', async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', timestamp: new Date().toISOString(), database: 'connected' });
    } catch (error) {
      console.error('[health] database check failed', error);
      res.status(503).json({ status: 'error', database: 'unavailable' });
    }
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
  });

  app.use(errorHandler);

  return app;
};

module.exports = { createApp, buildCorsOptions, JSON_BODY_LIMIT };
