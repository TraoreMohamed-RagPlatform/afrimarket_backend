require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const { PrismaClient } = require('@prisma/client');

// Import middlewares
const { generalLimiter, loginLimiter, registerLimiter } = require('./middleware/rateLimitMiddleware');

// Import routes
const authRoutes = require('./routes/auth');
const listingRoutes = require('./routes/listing');

const prisma = new PrismaClient();
const app = express();

// ========================================
// Security Middleware
// ========================================

// Helmet - Ajoute les en-têtes HTTP de sécurité
app.use(helmet());

// CORS
app.use(cors());

// Compression
app.use(compression());

// Body parser
app.use(express.json());

// ========================================
// Rate Limiting
// ========================================

// Rate limiting général
app.use(generalLimiter);

// ========================================
// Routes
// ========================================

// Routes d'authentification avec rate limiting spécifique
app.use('/api/auth', authRoutes);

// Routes des listings
app.use('/api/listings', listingRoutes);

// Routes des utilisateurs
const userRoutes = require('./routes/user');
app.use('/api/users', userRoutes);
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

const server = app.listen(PORT, HOST, () => {
  console.log(`✅ Backend AfriMarket démarré sur http://${HOST}:${PORT}`);
  console.log(`🔒 Sécurité : Helmet + Rate Limiting activés`);
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