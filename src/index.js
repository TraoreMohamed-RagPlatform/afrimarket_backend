require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const { PrismaClient } = require('@prisma/client');

// Import middlewares
const { loginLimiter, registerLimiter } = require('./middleware/rateLimitMiddleware');

// Import Socket.io
const { initializeSocket } = require('./socket');

// Import Firebase Service
const { initializeFirebase } = require('./utils/firebaseService');
// Ajoute cette ligne avec les autres imports de routes
const supportRoutes = require('./routes/support');



// Import routes
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
const adminReportRoutes = require('./routes/adminReports');
const identityVerificationRoutes = require('./routes/identityVerificationRoutes');
const prisma = new PrismaClient();

// ========================================
// EXPRESS APP & HTTP SERVER
// ========================================

const app = express();
const server = http.createServer(app);

// Initialize Socket.io
const io = initializeSocket(server);
app.set('io', io); // Rendre io accessible dans les routes

// Initialize Firebase
initializeFirebase();

// ========================================
// Security Middleware
// ========================================

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());

// ========================================
// Routes
// ========================================
//
// Et ajoute cette ligne dans la section app.use() :
app.use('/api/support', supportRoutes);

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
app.use('/api/admin/reports', adminReportRoutes);
app.use('/api/identity-verification', identityVerificationRoutes);

// ========================================
// Health check
// ========================================

app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'connected',
      websocket: 'active',
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Database connection failed',
      error: error.message,
    });
  }
});

// ========================================
// 404 Handler
// ========================================

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ========================================
// Error Handler
// ========================================

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ========================================
// Server Startup
// ========================================

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

server.listen(PORT, HOST, () => {
  console.log(`✅ Backend AfriMarket démarré sur http://${HOST}:${PORT}`);
  console.log(`🔒 Sécurité : Helmet + Rate Limiting activés`);
  console.log(`🔌 WebSocket Socket.io ACTIVÉ!`);
});

// ========================================
// Graceful Shutdown
// ========================================

process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('\nSIGINT received. Shutting down gracefully...');
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
});