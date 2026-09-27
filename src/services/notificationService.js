const nodemailer = require('nodemailer');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// =============================================
// CONFIGURATION - EMAIL & SMS
// =============================================
const EMAIL_CONFIG = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  }
};

const NOTIFICATION_TEMPLATES = {
  VERIFICATION_PENDING: {
    subject: 'Demande de vérification d\'identité reçue',
    template: 'verification_pending'
  },
  VERIFICATION_APPROVED: {
    subject: '✅ Vérification d\'identité approuvée',
    template: 'verification_approved'
  },
  VERIFICATION_REJECTED: {
    subject: '❌ Vérification d\'identité rejetée',
    template: 'verification_rejected'
  },
  ADMIN_NEW_REQUEST: {
    subject: '🔔 Nouvelle demande de vérification en attente',
    template: 'admin_new_request'
  }
};

// =============================================
// 1. ENVOYER EMAIL À L'UTILISATEUR
// =============================================
exports.sendUserEmail = async (userId, userEmail, notificationType, data = {}) => {
  try {
    const template = NOTIFICATION_TEMPLATES[notificationType];

    if (!template) {
      return {
        sent: false,
        error: `Type de notification inconnu: ${notificationType}`
      };
    }

    // Créer le transporteur nodemailer
    const transporter = nodemailer.createTransport(EMAIL_CONFIG);

    // Générer le contenu HTML
    const htmlContent = generateEmailHTML(template.template, data);

    // Envoyer l'email
    const result = await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@afrimarket.com',
      to: userEmail,
      subject: template.subject,
      html: htmlContent
    });

    // Enregistrer en BD
    await exports.logNotification(
      userId,
      'EMAIL',
      notificationType,
      userEmail,
      'SENT'
    );

    return {
      sent: true,
      messageId: result.messageId,
      message: `Email envoyé à ${userEmail}`
    };
  } catch (error) {
    // Enregistrer l'erreur en BD
    await exports.logNotification(
      userId,
      'EMAIL',
      notificationType,
      userEmail,
      'FAILED',
      error.message
    );

    return {
      sent: false,
      error: `Erreur lors de l'envoi d'email: ${error.message}`
    };
  }
};

// =============================================
// 2. ENVOYER EMAIL À L'ADMIN
// =============================================
exports.sendAdminEmail = async (notificationType, data = {}) => {
  try {
    const adminEmails = process.env.ADMIN_EMAILS?.split(',') || ['admin@afrimarket.com'];
    const template = NOTIFICATION_TEMPLATES[notificationType];

    if (!template) {
      return {
        sent: false,
        error: `Type de notification inconnu: ${notificationType}`
      };
    }

    const transporter = nodemailer.createTransport(EMAIL_CONFIG);
    const htmlContent = generateEmailHTML(template.template, data);

    for (const adminEmail of adminEmails) {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@afrimarket.com',
        to: adminEmail.trim(),
        subject: template.subject,
        html: htmlContent
      });
    }

    return {
      sent: true,
      recipientCount: adminEmails.length,
      message: `Emails envoyés à ${adminEmails.length} administrateur(s)`
    };
  } catch (error) {
    return {
      sent: false,
      error: `Erreur lors de l'envoi d'email admin: ${error.message}`
    };
  }
};

// =============================================
// 3. ENVOYER SMS (Optionnel - Twilio)
// =============================================
exports.sendSMS = async (userId, userPhone, notificationType, data = {}) => {
  try {
    // Vérifier si Twilio est configuré
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      return {
        sent: false,
        error: 'Twilio non configuré'
      };
    }

    const twilio = require('twilio');
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    const message = generateSMSMessage(notificationType, data);

    const result = await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: userPhone
    });

    // Enregistrer en BD
    await exports.logNotification(
      userId,
      'SMS',
      notificationType,
      userPhone,
      'SENT'
    );

    return {
      sent: true,
      messageId: result.sid,
      message: `SMS envoyé à ${userPhone}`
    };
  } catch (error) {
    // Enregistrer l'erreur en BD
    await exports.logNotification(
      userId,
      'SMS',
      notificationType,
      userPhone,
      'FAILED',
      error.message
    );

    return {
      sent: false,
      error: `Erreur lors de l'envoi de SMS: ${error.message}`
    };
  }
};

// =============================================
// 4. ENREGISTRER LES NOTIFICATIONS EN BD
// =============================================
exports.logNotification = async (
  userId,
  channel,
  notificationType,
  recipient,
  status,
  errorMessage = null
) => {
  try {
    // Si vous avez un modèle Notification dans Prisma
    // Sinon, vous pouvez simplement logger en console ou dans un fichier

    console.log(`[NOTIFICATION LOG]`, {
      userId,
      channel,
      notificationType,
      recipient,
      status,
      errorMessage,
      timestamp: new Date().toISOString()
    });

    // À implémenter si vous avez une table Notification:
    // await prisma.notification.create({
    //   data: {
    //     userId,
    //     channel,
    //     notificationType,
    //     recipient,
    //     status,
    //     errorMessage,
    //     sentAt: new Date()
    //   }
    // });

    return { logged: true };
  } catch (error) {
    console.error('Erreur lors de l\'enregistrement de la notification:', error);
    return { logged: false, error: error.message };
  }
};

// =============================================
// 5. ENVOYER NOTIFICATIONS COMPLÈTES (Email + SMS)
// =============================================
exports.sendCompleteNotification = async (
  userId,
  userEmail,
  userPhone,
  notificationType,
  data = {}
) => {
  try {
    const results = {
      email: null,
      sms: null
    };

    // Envoyer email
    results.email = await exports.sendUserEmail(userId, userEmail, notificationType, data);

    // Envoyer SMS (optionnel)
    if (userPhone) {
      results.sms = await exports.sendSMS(userId, userPhone, notificationType, data);
    }

    return {
      sent: true,
      details: results,
      message: 'Notifications envoyées'
    };
  } catch (error) {
    return {
      sent: false,
      error: `Erreur lors de l'envoi complet: ${error.message}`
    };
  }
};

// =============================================
// 6. ENVOYER NOTIFICATION DE VÉRIFICATION COMPLÉTÉE
// =============================================
exports.notifyVerificationCompleted = async (verificationId, status, userEmail, userData = {}) => {
  try {
    let notificationType;

    if (status === 'VERIFIED') {
      notificationType = 'VERIFICATION_APPROVED';
    } else if (status === 'REJECTED') {
      notificationType = 'VERIFICATION_REJECTED';
    } else {
      notificationType = 'VERIFICATION_PENDING';
    }

    const data = {
      userName: userData.name || 'Utilisateur',
      status: status,
      verificationId: verificationId,
      timestamp: new Date().toLocaleString('fr-FR'),
      rejectionReason: userData.rejectionReason || '',
      supportEmail: 'support@afrimarket.com'
    };

    const emailResult = await exports.sendUserEmail(
      userData.userId,
      userEmail,
      notificationType,
      data
    );

    // Notifier aussi l'admin
    if (status === 'VERIFIED' || status === 'REJECTED') {
      await exports.sendAdminEmail('ADMIN_NEW_REQUEST', {
        ...data,
        userEmail: userEmail
      });
    }

    return emailResult;
  } catch (error) {
    return {
      sent: false,
      error: `Erreur lors de la notification: ${error.message}`
    };
  }
};

// =============================================
// HELPER FUNCTIONS - TEMPLATE GENERATION
// =============================================

function generateEmailHTML(template, data) {
  const templates = {
    verification_pending: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Demande de vérification reçue</h2>
        <p>Bonjour ${data.userName || 'Utilisateur'},</p>
        <p>Votre demande de vérification d'identité a été reçue avec succès.</p>
        <p>Nous examinons vos documents et vous enverrons un email dès que la vérification sera complétée.</p>
        <p><strong>ID de demande:</strong> ${data.verificationId}</p>
        <p>Merci de votre confiance,<br/>L'équipe AfriMarket</p>
      </div>
    `,
    verification_approved: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #28a745;">✅ Vérification approuvée!</h2>
        <p>Bonjour ${data.userName || 'Utilisateur'},</p>
        <p>Excellente nouvelle! Votre vérification d'identité a été approuvée.</p>
        <p>Vous pouvez maintenant accéder à toutes les fonctionnalités premium d'AfriMarket.</p>
        <p><strong>ID de demande:</strong> ${data.verificationId}</p>
        <p>Merci,<br/>L'équipe AfriMarket</p>
      </div>
    `,
    verification_rejected: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc3545;">❌ Vérification non approuvée</h2>
        <p>Bonjour ${data.userName || 'Utilisateur'},</p>
        <p>Malheureusement, votre demande de vérification n'a pas pu être approuvée.</p>
        <p><strong>Raison:</strong> ${data.rejectionReason || 'Qualité insuffisante des documents'}</p>
        <p>Vous pouvez soumettre une nouvelle demande après correction.</p>
        <p><strong>Support:</strong> ${data.supportEmail}</p>
      </div>
    `,
    admin_new_request: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #007bff;">🔔 Nouvelle demande de vérification</h2>
        <p>Une nouvelle demande de vérification d'identité est en attente d'examen.</p>
        <p><strong>Utilisateur:</strong> ${data.userEmail}</p>
        <p><strong>ID de demande:</strong> ${data.verificationId}</p>
        <p><strong>Reçue le:</strong> ${data.timestamp}</p>
        <p><a href="${process.env.ADMIN_DASHBOARD_URL || '#'}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Voir la demande</a></p>
      </div>
    `
  };

  return templates[template] || '<p>Notification</p>';
}

function generateSMSMessage(notificationType, data) {
  const templates = {
    VERIFICATION_APPROVED: `✅ Félicitations! Votre identité est vérifiée sur AfriMarket. Accédez maintenant à votre compte.`,
    VERIFICATION_REJECTED: `❌ Votre demande de vérification a été rejetée. Contactez le support: ${data.supportEmail}`,
    VERIFICATION_PENDING: `📝 Votre demande est en cours de traitement. Nous vous recontacterons bientôt.`
  };

  return templates[notificationType] || 'Notification AfriMarket';
}

module.exports = exports;