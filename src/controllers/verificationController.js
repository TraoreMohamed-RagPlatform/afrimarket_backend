// src/controllers/verificationController.js
const { PrismaClient } = require('@prisma/client');
const { sendEmailOTP, sendSmsOTP, generateOTP, validatePhoneNumber, formatPhoneNumber, getExpiryTime } = require('../utils/verificationService');
const emailService = require('../utils/emailService');
const { sendServerError } = require('../utils/httpErrors');

const prisma = new PrismaClient();

// 1️⃣ Demander vérification email
const requestEmailVerification = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { email } = req.body;

    // Validation
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Email invalide' });
    }

    // Vérifier si l'email n'est pas déjà utilisé
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser && existingUser.id !== userId) {
      return res.status(400).json({ error: 'Cet email est déjà utilisé' });
    }

    // Générer OTP
    const otp = generateOTP();
    const expiresAt = getExpiryTime(10); // 10 minutes

    // Sauvegarder ou mettre à jour la vérification
    await prisma.verification.upsert({
      where: { userId_type: { userId, type: 'EMAIL' } },
      update: {
        value: email,
        code: otp,
        verified: false,
        expiresAt,
      },
      create: {
        userId,
        type: 'EMAIL',
        value: email,
        code: otp,
        verified: false,
        expiresAt,
      },
    });

    // Envoyer l'email
    const emailResult = await sendEmailOTP(email, otp, emailService);

    if (!emailResult.success) {
      console.error('[verificationController.requestEmailVerification] envoi email échoué', emailResult.error);
      return res.status(502).json({ error: 'Erreur lors de l\'envoi du code' });
    }

    res.status(200).json({
      message: 'Code OTP envoyé à votre email',
      email,
      expiresIn: '10 minutes',
    });
  } catch (error) {
    sendServerError(res, error, 'verificationController.requestEmailVerification');
  }
};

// 2️⃣ Confirmer vérification email
const confirmEmail = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { code, email } = req.body;

    if (!code || !email) {
      return res.status(400).json({ error: 'Code et email requis' });
    }

    // Récupérer la vérification
    const verification = await prisma.verification.findUnique({
      where: { userId_type: { userId, type: 'EMAIL' } },
    });

    if (!verification) {
      return res.status(400).json({ error: 'Aucune vérification en cours' });
    }

    // Vérifier le code
    if (verification.code !== code) {
      return res.status(400).json({ error: 'Code incorrect' });
    }

    // Vérifier l'expiration
    if (new Date() > verification.expiresAt) {
      return res.status(400).json({ error: 'Code expiré' });
    }

    // Vérifier que l'email correspond
    if (verification.value !== email) {
      return res.status(400).json({ error: 'Email ne correspond pas' });
    }

    // Marquer comme vérifié
    await prisma.verification.update({
      where: { userId_type: { userId, type: 'EMAIL' } },
      data: { verified: true },
    });

    // Mettre à jour le User
    await prisma.user.update({
      where: { id: userId },
      data: {
        email,
        verifiedEmail: true,
      },
    });

    res.status(200).json({
      message: 'Email vérifié avec succès ✅',
      verified: true,
    });
  } catch (error) {
    sendServerError(res, error, 'verificationController.confirmEmail');
  }
};

// 3️⃣ Demander vérification téléphone
const requestPhoneVerification = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { phone } = req.body;

    // Validation du format
    if (!validatePhoneNumber(phone)) {
      return res.status(400).json({
        error: 'Format de téléphone invalide. Utilisez: +212XXXXXXXXX ou 0XXXXXXXXX',
      });
    }

    // Formater le numéro
    const formattedPhone = formatPhoneNumber(phone);

    // Générer OTP
    const otp = generateOTP();
    const expiresAt = getExpiryTime(10); // 10 minutes

    // Sauvegarder ou mettre à jour la vérification
    await prisma.verification.upsert({
      where: { userId_type: { userId, type: 'PHONE' } },
      update: {
        value: formattedPhone,
        code: otp,
        verified: false,
        expiresAt,
      },
      create: {
        userId,
        type: 'PHONE',
        value: formattedPhone,
        code: otp,
        verified: false,
        expiresAt,
      },
    });

    // Envoyer le SMS
    const smsResult = await sendSmsOTP(formattedPhone, otp, 'verification');

    if (!smsResult.success) {
      console.error('[verificationController.requestPhoneVerification] envoi SMS échoué', smsResult.error);
      return res.status(502).json({ error: 'Erreur lors de l\'envoi du code SMS' });
    }

    res.status(200).json({
      message: 'Code OTP envoyé par SMS',
      phone: formattedPhone,
      expiresIn: '10 minutes',
    });
  } catch (error) {
    sendServerError(res, error, 'verificationController.requestPhoneVerification');
  }
};

// 4️⃣ Confirmer vérification téléphone
const confirmPhone = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { code, phone } = req.body;

    if (!code || !phone) {
      return res.status(400).json({ error: 'Code et téléphone requis' });
    }

    // Formater le numéro
    const formattedPhone = formatPhoneNumber(phone);

    // Récupérer la vérification
    const verification = await prisma.verification.findUnique({
      where: { userId_type: { userId, type: 'PHONE' } },
    });

    if (!verification) {
      return res.status(400).json({ error: 'Aucune vérification en cours' });
    }

    // Vérifier le code
    if (verification.code !== code) {
      return res.status(400).json({ error: 'Code incorrect' });
    }

    // Vérifier l'expiration
    if (new Date() > verification.expiresAt) {
      return res.status(400).json({ error: 'Code expiré' });
    }

    // Vérifier que le téléphone correspond
    if (verification.value !== formattedPhone) {
      return res.status(400).json({ error: 'Téléphone ne correspond pas' });
    }

    // Marquer comme vérifié
    await prisma.verification.update({
      where: { userId_type: { userId, type: 'PHONE' } },
      data: { verified: true },
    });

    // Mettre à jour le User
    await prisma.user.update({
      where: { id: userId },
      data: {
        phone: formattedPhone,
        verifiedPhone: true,
      },
    });

    res.status(200).json({
      message: 'Téléphone vérifié avec succès ✅',
      verified: true,
    });
  } catch (error) {
    sendServerError(res, error, 'verificationController.confirmPhone');
  }
};

// 5️⃣ Obtenir le statut de vérification
const getVerificationStatus = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Récupérer les vérifications
    const emailVerif = await prisma.verification.findUnique({
      where: { userId_type: { userId, type: 'EMAIL' } },
      select: { verified: true, value: true },
    });

    const phoneVerif = await prisma.verification.findUnique({
      where: { userId_type: { userId, type: 'PHONE' } },
      select: { verified: true, value: true },
    });

    // Récupérer les données User
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        phone: true,
        verifiedEmail: true,
        verifiedPhone: true,
      },
    });

    res.status(200).json({
      email: {
        address: user?.email,
        verified: user?.verifiedEmail || false,
        pendingVerification: emailVerif?.verified === false,
      },
      phone: {
        number: user?.phone,
        verified: user?.verifiedPhone || false,
        pendingVerification: phoneVerif?.verified === false,
      },
    });
  } catch (error) {
    sendServerError(res, error, 'verificationController.getVerificationStatus');
  }
};

module.exports = {
  requestEmailVerification,
  confirmEmail,
  requestPhoneVerification,
  confirmPhone,
  getVerificationStatus,
};
