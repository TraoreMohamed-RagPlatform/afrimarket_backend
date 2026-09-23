const { PrismaClient } = require('@prisma/client');

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
        phone: true,
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
    res.status(500).json({ error: error.message });
  }
};

// ========================================
// Get My Profile (Protected)
// ========================================
const getMyProfile = async (req, res) => {
  try {
    const userId = req.userId;

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
    res.status(500).json({ error: error.message });
  }
};

// ========================================
// Update My Profile (Protected)
// ========================================
const updateMyProfile = async (req, res) => {
  try {
    const userId = req.userId;
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
    res.status(500).json({ error: error.message });
  }
};

// ========================================
// Get My Settings (Protected)
// ========================================
const getMySettings = async (req, res) => {
  try {
    const userId = req.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        verifiedEmail: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    res.json({
      settings: {
        accountEmail: user.email,
        accountStatus: user.status,
        role: user.role,
        emailVerified: user.verifiedEmail,
        notifications: {
          messageAlerts: true,
          listingAlerts: true,
          ratingAlerts: true,
        },
        privacy: {
          profileVisibility: 'public',
          showPhoneNumber: false,
          showListings: true,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ========================================
// Update My Settings (Protected)
// ========================================
const updateMySettings = async (req, res) => {
  try {
    const userId = req.userId;
    const { notifications, privacy } = req.body;

    // Pour maintenant, on retourne une réponse simple
    // En phase future, on peut stocker ces settings dans une table Settings
    res.json({
      message: 'Paramètres mis à jour avec succès',
      settings: {
        notifications: notifications || {
          messageAlerts: true,
          listingAlerts: true,
          ratingAlerts: true,
        },
        privacy: privacy || {
          profileVisibility: 'public',
          showPhoneNumber: false,
          showListings: true,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ========================================
// Delete My Account (Protected)
// ========================================
const deleteMyAccount = async (req, res) => {
  try {
    const userId = req.userId;
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

    res.json({ message: 'Compte supprimé avec succès' });
  } catch (error) {
    res.status(500).json({ error: error.message });
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