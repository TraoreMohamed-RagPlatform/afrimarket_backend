const express = require('express');
const { body, param, validationResult } = require('express-validator');

const prisma = require('../lib/prisma');
const authMiddleware = require('../middleware/authMiddleware');
const { sendServerError } = require('../utils/httpErrors');

const router = express.Router();

// Un token FCM fait environ 160 caractères ; on borne largement.
const MAX_TOKEN_LENGTH = 4096;
const MAX_DEVICE_NAME_LENGTH = 100;
const MAX_PAGE_SIZE = 50;

const rejectInvalid = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }
  return next();
};

const tokenRule = body('token')
  .isString()
  .trim()
  .isLength({ min: 1, max: MAX_TOKEN_LENGTH })
  .withMessage('Token FCM invalide');

router.use(authMiddleware);

// ========================================
// POST /register-token : enregistrer l'appareil de l'utilisateur
// ========================================
router.post(
  '/register-token',
  tokenRule,
  body('deviceName').optional().isString().trim().isLength({ max: MAX_DEVICE_NAME_LENGTH }),
  rejectInvalid,
  async (req, res) => {
    const { userId } = req.user;
    const { token, deviceName } = req.body;

    try {
      // Un token appartient à un seul appareil : s'il change de compte,
      // il est réattribué au nouvel utilisateur.
      const saved = await prisma.fCMToken.upsert({
        where: { token },
        create: { token, userId, deviceName: deviceName || null },
        update: { userId, deviceName: deviceName || null, active: true },
        select: { id: true, deviceName: true, createdAt: true },
      });
      return res.status(201).json({ message: 'Token FCM enregistré', token: saved });
    } catch (error) {
      return sendServerError(res, error, 'fcm.register-token');
    }
  },
);

// ========================================
// POST /remove-token : désinscrire un appareil (déconnexion)
// ========================================
router.post('/remove-token', tokenRule, rejectInvalid, async (req, res) => {
  const { userId } = req.user;

  try {
    // Filtre sur userId : on ne peut supprimer que ses propres tokens.
    const { count } = await prisma.fCMToken.deleteMany({
      where: { token: req.body.token, userId },
    });
    return res.json({ message: 'Token supprimé', removed: count });
  } catch (error) {
    return sendServerError(res, error, 'fcm.remove-token');
  }
});

// ========================================
// GET /my-tokens : appareils enregistrés de l'utilisateur
// ========================================
router.get('/my-tokens', async (req, res) => {
  const { userId } = req.user;

  try {
    const tokens = await prisma.fCMToken.findMany({
      where: { userId, active: true },
      // La valeur du token n'est jamais renvoyée : elle permet d'envoyer
      // des notifications à l'appareil.
      select: { id: true, deviceName: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
    return res.json({ count: tokens.length, tokens });
  } catch (error) {
    return sendServerError(res, error, 'fcm.my-tokens');
  }
});

// ========================================
// GET /history : historique paginé des notifications
// ========================================
router.get('/history', async (req, res) => {
  const { userId } = req.user;
  const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), MAX_PAGE_SIZE);

  try {
    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        select: { id: true, type: true, title: true, message: true, read: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.notification.count({ where: { userId } }),
    ]);

    return res.json({ page, limit, total, pages: Math.ceil(total / limit), notifications });
  } catch (error) {
    return sendServerError(res, error, 'fcm.history');
  }
});

// ========================================
// PUT /mark-read/:id
// ========================================
router.put('/mark-read/:id', param('id').isString().notEmpty(), rejectInvalid, async (req, res) => {
  const { userId } = req.user;

  try {
    // updateMany avec userId : impossible de modifier la notification d'un autre.
    const { count } = await prisma.notification.updateMany({
      where: { id: req.params.id, userId },
      data: { read: true },
    });
    if (count === 0) {
      return res.status(404).json({ error: 'Notification introuvable' });
    }
    return res.json({ message: 'Notification marquée comme lue' });
  } catch (error) {
    return sendServerError(res, error, 'fcm.mark-read');
  }
});

// ========================================
// DELETE /delete-notification/:id
// ========================================
router.delete(
  '/delete-notification/:id',
  param('id').isString().notEmpty(),
  rejectInvalid,
  async (req, res) => {
    const { userId } = req.user;

    try {
      const { count } = await prisma.notification.deleteMany({
        where: { id: req.params.id, userId },
      });
      if (count === 0) {
        return res.status(404).json({ error: 'Notification introuvable' });
      }
      return res.json({ message: 'Notification supprimée' });
    } catch (error) {
      return sendServerError(res, error, 'fcm.delete-notification');
    }
  },
);

module.exports = router;
