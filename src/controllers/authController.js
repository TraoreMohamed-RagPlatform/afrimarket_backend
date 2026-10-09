const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { generateToken, verifyToken } = require('../utils/tokenUtils');
const { recordFailedLogin, resetLoginAttempts } = require('../middleware/loginLockoutMiddleware');
const RecaptchaService = require('../utils/recaptchaService');
const { sendResetPasswordEmail, sendPasswordChangeConfirmation } = require('../utils/passwordService');

const prisma = new PrismaClient();

const register = async (req, res) => {
  try {
    const { email, username, password, fullName } = req.body;

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Email or username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        username,
        password: hashedPassword,
        fullName,
      },
    });

    const accessToken = generateToken(user.id);
    const refreshToken = generateToken(user.id, '30d');

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        fullName: user.fullName,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, password, recaptchaToken } = req.body;

    // Vérifier le reCAPTCHA v3
    if (!recaptchaToken) {
      return res.status(400).json({ error: 'reCAPTCHA token is required' });
    }

    const recaptchaResult = await RecaptchaService.verifyToken(recaptchaToken);

    if (!recaptchaResult.success) {
      recordFailedLogin(email);
      return res.status(400).json({
        error: 'reCAPTCHA verification failed',
        details: recaptchaResult.error
      });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      recordFailedLogin(email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.status === 'SUSPENDED' || user.status === 'DELETED') {
      recordFailedLogin(email);
      return res.status(403).json({ error: 'Account is not active' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      recordFailedLogin(email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Réinitialiser les tentatives échouées après une connexion réussie
    resetLoginAttempts(email);

    const accessToken = generateToken(user.id);
    const refreshToken = generateToken(user.id, '30d');

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        fullName: user.fullName,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getProfile = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        phone: true,
        avatar: true,
        bio: true,
        location: true,
        role: true,
        status: true,
        avgRating: true,
        totalRatings: true,
      },
    });

    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;

    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const accessToken = generateToken(user.id);

    res.json({ accessToken });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const sendVerificationEmail = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    await prisma.verification.upsert({
      where: { userId_type: { userId: user.id, type: 'EMAIL' } },
      update: { code, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
      create: {
        userId: user.id,
        type: 'EMAIL',
        value: email,
        code,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    res.json({ message: 'Verification code sent' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const confirmEmail = async (req, res) => {
  try {
    const { email, code } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const verification = await prisma.verification.findUnique({
      where: { userId_type: { userId: user.id, type: 'EMAIL' } },
    });

    if (!verification) {
      return res.status(404).json({ error: 'Verification not found' });
    }

    if (verification.code !== code) {
      return res.status(400).json({ error: 'Invalid code' });
    }

    if (new Date() > verification.expiresAt) {
      return res.status(400).json({ error: 'Code expired' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { verifiedEmail: true },
    });

    await prisma.verification.update({
      where: { id: verification.id },
      data: { verified: true },
    });

    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Mot de passe oublié - Envoyer code réinitialisation
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Générer code de réinitialisation
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // Expire dans 15 min

    // Supprimer les anciens codes
    await prisma.passwordReset.deleteMany({
      where: { userId: user.id },
    });

    // Créer nouveau code
    await prisma.passwordReset.create({
      data: {
        code,
        expiresAt,
        userId: user.id,
      },
    });

    // Envoyer email avec code
    await sendResetPasswordEmail(user.email, user.fullName, code);

    res.json({
      message: 'Password reset code sent to email',
      success: true,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Réinitialiser le mot de passe
const resetPassword = async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Email, code and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Vérifier le code de réinitialisation
    const resetRecord = await prisma.passwordReset.findFirst({
      where: {
        userId: user.id,
        code,
        used: false,
      },
    });

    if (!resetRecord) {
      return res.status(400).json({ error: 'Invalid reset code' });
    }

    if (new Date() > resetRecord.expiresAt) {
      return res.status(400).json({ error: 'Reset code expired' });
    }

    // Hasher le nouveau mot de passe
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Mettre à jour le mot de passe et marquer le code comme utilisé
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    await prisma.passwordReset.update({
      where: { id: resetRecord.id },
      data: { used: true },
    });

    res.json({
      message: 'Password reset successfully',
      success: true,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Changer le mot de passe (utilisateur connecté)
const changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.userId;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Old password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    if (oldPassword === newPassword) {
      return res.status(400).json({ error: 'New password must be different from old password' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Vérifier l'ancien mot de passe
    const isPasswordValid = await bcrypt.compare(oldPassword, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hasher le nouveau mot de passe
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Mettre à jour le mot de passe
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    // Envoyer email de confirmation
    try {
      await sendPasswordChangeConfirmation(user.email, user.fullName);
    } catch (error) {
      console.warn('Erreur envoi email confirmation:', error);
      // Ne pas bloquer la réponse si l'email échoue
    }

    res.json({
      message: 'Password changed successfully',
      success: true,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const logout = (req, res) => {
  res.json({ message: 'Logout successful' });
};

module.exports = {
  register,
  login,
  getProfile,
  refreshToken,
  sendVerificationEmail,
  confirmEmail,
  forgotPassword,
  resetPassword,
  changePassword,
  logout,
};