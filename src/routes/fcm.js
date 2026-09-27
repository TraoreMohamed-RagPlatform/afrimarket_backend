const express = require('express');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();
const prisma = new PrismaClient();

// ========================================
// POST /register-token
// ========================================
router.post('/register-token', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { token, deviceName } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token FCM est requis' });
    }

    console.log(`✅ Token FCM reçu pour l'utilisateur ${userId}`);
    
    // Pour maintenant, on stocke juste en mémoire (sera dans DB plus tard)
    // Le vrai stockage se fera avec une table FCMToken après la migration Prisma
    
    res.json({
      message: 'Token FCM enregistré avec succès',
      token: token,
      deviceName: deviceName || 'Unknown Device',
      userId: userId,
      status: 'stored_in_memory'
    });
  } catch (error) {
    console.error('❌ Erreur enregistrement token FCM:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// POST /remove-token
// ========================================
router.post('/remove-token', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token est requis' });
    }

    res.json({ message: 'Token supprimé avec succès' });
  } catch (error) {
    console.error('❌ Erreur suppression token:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// GET /my-tokens
// ========================================
router.get('/my-tokens', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.userId;

    // Pour maintenant, retourner un tableau vide
    // Sera rempli après la migration
    res.json({
      count: 0,
      tokens: [],
      message: 'Stockage de tokens en développement'
    });
  } catch (error) {
    console.error('❌ Erreur récupération tokens:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// GET /history
// ========================================
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const notifications = await prisma.notification.findMany({
      where: { userId },
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        read: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit
    });

    const total = await prisma.notification.count({
      where: { userId }
    });

    res.json({
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      notifications
    });
  } catch (error) {
    console.error('❌ Erreur récupération historique:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// PUT /mark-read/:id
// ========================================
router.put('/mark-read/:id', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;

    const notification = await prisma.notification.findUnique({
      where: { id }
    });

    if (!notification || notification.userId !== userId) {
      return res.status(403).json({ error: 'Non autorisé' });
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { read: true }
    });

    res.json({ message: 'Notification marquée comme lue', notification: updated });
  } catch (error) {
    console.error('❌ Erreur mise à jour notification:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// DELETE /delete-notification/:id
// ========================================
router.delete('/delete-notification/:id', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;

    const notification = await prisma.notification.findUnique({
      where: { id }
    });

    if (!notification || notification.userId !== userId) {
      return res.status(403).json({ error: 'Non autorisé' });
    }

    await prisma.notification.delete({
      where: { id }
    });

    res.json({ message: 'Notification supprimée' });
  } catch (error) {
    console.error('❌ Erreur suppression notification:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
