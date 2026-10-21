const { PrismaClient } = require('@prisma/client');
const { sendServerError } = require('../utils/httpErrors');
const { disconnectUser } = require('../services/realtime');

const prisma = new PrismaClient();

// ========================================
// Get User Profile (Public)
// ========================================
const getUserProfile = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        fullName: true,
        avatar: true,
        bio: true,
        // Pas de téléphone : profil public (OWASP API3:2023). Le numéro
        // passe par GET /api/listings/:id/contact (connexion requise).
        location: true,
        role: true,
        avgRating: true,
        totalRatings: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    res.json({ user });
  } catch (error) {
    sendServerError(res, error, 'userController.getUserProfile');
  }
};

// ========================================
// Get My Profile (Protected)
// ========================================
const getMyProfile = async (req, res) => {
  try {
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        avatar: true,
        bio: true,
        phone: true,
        location: true,
        role: true,
        status: true,
        avgRating: true,
        totalRatings: true,
        verifiedEmail: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    res.json({ user });
  } catch (error) {
    sendServerError(res, error, 'userController.getMyProfile');
  }
};

// ========================================
// Update My Profile (Protected)
// ========================================
const updateMyProfile = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { fullName, bio, phone, location, avatar } = req.body;

    // Validation
    if (fullName && fullName.length < 2) {
      return res.status(400).json({ error: 'Le nom doit avoir au moins 2 caractères' });
    }

    const updateData = {};
    if (fullName) updateData.fullName = fullName;
    if (bio) updateData.bio = bio;
    if (phone) updateData.phone = phone;
    if (location) updateData.location = location;
    if (avatar) updateData.avatar = avatar;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        avatar: true,
        bio: true,
        phone: true,
        location: true,
        updatedAt: true,
      },
    });

    res.json({
      message: 'Profil mis à jour avec succès',
      user: updatedUser,
    });
  } catch (error) {
    sendServerError(res, error, 'userController.updateMyProfile');
  }
};

// ========================================
// Settings (Protected)
// ========================================

/** Valeurs par défaut, tant que l'utilisateur n'a rien enregistré. */
const DEFAULT_SETTINGS = Object.freeze({
  showPhone: false,
  whatsappEnabled: false,
  messageAlerts: true,
  listingAlerts: true,
  ratingAlerts: true,
});

/** Champs modifiables : chemin dans le corps de la requête → colonne. */
const SETTINGS_FIELDS = Object.freeze({
  'privacy.showPhoneNumber': 'showPhone',
  'privacy.whatsappEnabled': 'whatsappEnabled',
  'notifications.messageAlerts': 'messageAlerts',
  'notifications.listingAlerts': 'listingAlerts',
  'notifications.ratingAlerts': 'ratingAlerts',
});

const SETTINGS_SELECT = Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((key) => [key, true]));

/** Paramètres de l'utilisateur (format de réponse de l'API), ou null. */
const loadSettings = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      verifiedEmail: true,
      verifiedPhone: true,
      settings: { select: SETTINGS_SELECT },
    },
  });

  if (!user) {
    return null;
  }

  const stored = { ...DEFAULT_SETTINGS, ...(user.settings ?? {}) };
  return {
    accountEmail: user.email,
    accountStatus: user.status,
    role: user.role,
    emailVerified: user.verifiedEmail,
    // Le numéro n'est proposé aux acheteurs que s'il est vérifié ET partagé.
    phoneVerified: user.verifiedPhone,
    notifications: {
      messageAlerts: stored.messageAlerts,
      listingAlerts: stored.listingAlerts,
      ratingAlerts: stored.ratingAlerts,
    },
    privacy: {
      showPhoneNumber: stored.showPhone,
      whatsappEnabled: stored.whatsappEnabled,
    },
  };
};

const getMySettings = async (req, res) => {
  try {
    const settings = await loadSettings(req.user.userId);

    if (!settings) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    res.json({ settings });
  } catch (error) {
    sendServerError(res, error, 'userController.getMySettings');
  }
};

/**
 * Enregistre les paramètres envoyés (les autres restent inchangés).
 * Les valeurs sont validées par la route (booléens uniquement).
 */
const updateMySettings = async (req, res) => {
  try {
    const userId = req.user.userId;

    const data = {};
    for (const [bodyPath, column] of Object.entries(SETTINGS_FIELDS)) {
      const [group, key] = bodyPath.split('.');
      const value = req.body?.[group]?.[key];
      if (typeof value === 'boolean') {
        data[column] = value;
      }
    }

    const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!exists) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });

    res.json({
      message: 'Paramètres mis à jour avec succès',
      settings: await loadSettings(userId),
    });
  } catch (error) {
    sendServerError(res, error, 'userController.updateMySettings');
  }
};

// ========================================
// Delete My Account (Protected)
// ========================================
const deleteMyAccount = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Le mot de passe est requis' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // Vérifier le mot de passe
    const bcrypt = require('bcryptjs');
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Mot de passe incorrect' });
    }

    // Soft delete : marquer comme inactif
    await prisma.user.update({
      where: { id: userId },
      data: { status: 'DELETED' },
    });
    disconnectUser(userId);

    res.json({ message: 'Compte supprimé avec succès' });
  } catch (error) {
    sendServerError(res, error, 'userController.deleteMyAccount');
  }
};

module.exports = {
  getUserProfile,
  getMyProfile,
  updateMyProfile,
  getMySettings,
  updateMySettings,
  deleteMyAccount,
};