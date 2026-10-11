const prisma = require('../lib/prisma');
const { startSession, rotateSession, endSession, endAllSessions } = require('../services/sessionService');
const {
  PASSWORD_RULE_MESSAGE,
  isPasswordAcceptable,
  hashPassword,
  verifyPassword,
} = require('../utils/passwordPolicy');
const { recordFailedLogin, resetLoginAttempts } = require('../middleware/loginLockoutMiddleware');
const { sendResetPasswordEmail, sendPasswordChangeConfirmation } = require('../utils/passwordService');
const { sendServerError } = require('../utils/httpErrors');

const INACTIVE_STATUSES = new Set(['SUSPENDED', 'DELETED']);

const register = async (req, res) => {
  try {
    const { email, username, password, fullName } = req.body;

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Email or username already exists' });
    }

    if (!isPasswordAcceptable(password)) {
      return res.status(400).json({ error: PASSWORD_RULE_MESSAGE });
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email,
        username,
        password: hashedPassword,
        fullName,
      },
    });

    const session = await startSession(user.id);

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        fullName: user.fullName,
      },
      ...session,
    });
  } catch (error) {
    sendServerError(res, error, 'authController.register');
  }
};

const login = async (req, res) => {
  try {
    // Client déjà vérifié par la route (App Check ou reCAPTCHA, voir
    // middleware/verifyClient.js).
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    // Comparaison toujours effectuée (empreinte factice si l'e-mail est
    // inconnu) : même réponse et même durée, qu'il existe un compte ou non.
    const isPasswordValid = await verifyPassword(password, user?.password);

    if (!user || !isPasswordValid) {
      recordFailedLogin(email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Le statut du compte n'est révélé qu'avec le bon mot de passe.
    if (INACTIVE_STATUSES.has(user.status)) {
      return res.status(403).json({ error: 'Account is not active' });
    }

    // Réinitialiser les tentatives échouées après une connexion réussie
    resetLoginAttempts(email);

    const session = await startSession(user.id);

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        fullName: user.fullName,
      },
      ...session,
    });
  } catch (error) {
    sendServerError(res, error, 'authController.login');
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
    sendServerError(res, error, 'authController.getProfile');
  }
};

const refreshToken = async (req, res) => {
  try {
    // Rotation : l'ancien jeton est invalidé et un nouveau est renvoyé.
    // Toute erreur donne la même réponse (aucun détail exploitable).
    const result = await rotateSession(req.body.refreshToken);

    if (!result.ok) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    res.json(result.session);
  } catch (error) {
    sendServerError(res, error, 'authController.refreshToken');
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
    sendServerError(res, error, 'authController.sendVerificationEmail');
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
    sendServerError(res, error, 'authController.confirmEmail');
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
    sendServerError(res, error, 'authController.forgotPassword');
  }
};

// Réinitialiser le mot de passe
const resetPassword = async (req, res) => {
  try {
    // Présence et format des champs : déjà validés par la route.
    const { email, code, newPassword } = req.body;

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

    const hashedPassword = await hashPassword(newPassword);

    // En une seule transaction : nouveau mot de passe, code consommé et
    // déconnexion de tous les appareils (une session volée ne survit pas).
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      });
      await tx.passwordReset.update({
        where: { id: resetRecord.id },
        data: { used: true },
      });
      await endAllSessions(user.id, tx);
    });

    res.json({
      message: 'Password reset successfully',
      success: true,
    });
  } catch (error) {
    sendServerError(res, error, 'authController.resetPassword');
  }
};

// Changer le mot de passe (utilisateur connecté)
const changePassword = async (req, res) => {
  try {
    // Présence et format des champs : déjà validés par la route
    // (routes/auth.js, règle commune des mots de passe).
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Vérifier l'ancien mot de passe
    const isPasswordValid = await verifyPassword(oldPassword, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Comparaison faite seulement après vérification de l'ancien mot de passe.
    if (await verifyPassword(newPassword, user.password)) {
      return res.status(400).json({ error: 'New password must be different from old password' });
    }

    const hashedPassword = await hashPassword(newPassword);

    // Nouveau mot de passe et déconnexion de tous les appareils, ensemble.
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { password: hashedPassword },
      });
      await endAllSessions(userId, tx);
    });

    // L'appareil courant reçoit une nouvelle session.
    const session = await startSession(userId);

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
      ...session,
    });
  } catch (error) {
    sendServerError(res, error, 'authController.changePassword');
  }
};

// Déconnexion de l'appareil : le jeton de rafraîchissement est révoqué.
// Réponse identique que le jeton existe ou non.
const logout = async (req, res) => {
  try {
    await endSession(req.body.refreshToken);
    res.json({ message: 'Logout successful' });
  } catch (error) {
    sendServerError(res, error, 'authController.logout');
  }
};

// Déconnexion de tous les appareils de l'utilisateur.
const logoutAll = async (req, res) => {
  try {
    await endAllSessions(req.user.userId);
    res.json({ message: 'Logged out from all devices' });
  } catch (error) {
    sendServerError(res, error, 'authController.logoutAll');
  }
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
  logoutAll,
};