// src/utils/verificationService.js
const axios = require('axios');

// Configuration Africas Talking
const AT_API_KEY = process.env.AFRICAS_TALKING_API_KEY || 'YOUR_API_KEY';
const AT_USERNAME = 'sandbox'; // ou votre username

// Fonction pour générer un code OTP de 6 chiffres
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Fonction pour envoyer SMS via Africas Talking
const sendSmsOTP = async (phoneNumber, otp, type = 'verification') => {
  try {
    // Format: +212XXXXXXXXX pour Maroc
    const message = type === 'verification' 
      ? `Votre code de vérification AfriMarket est: ${otp}. Ne partagez pas ce code.`
      : `Votre code de confirmation est: ${otp}`;

    const response = await axios.post(
      'https://api.sandbox.africastalking.com/version1/messaging',
      {
        username: AT_USERNAME,
        recipients: [phoneNumber],
        message: message,
      },
      {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'apiKey': AT_API_KEY,
        },
      }
    );

    console.log('✅ SMS OTP envoyé à', phoneNumber);
    return { success: true, data: response.data };
  } catch (error) {
    console.error('❌ Erreur envoi SMS:', error.response?.data || error.message);
    return { success: false, error: 'Operation failed' };
  }
};

// Fonction pour envoyer email OTP
const sendEmailOTP = async (email, otp, emailService) => {
  try {
    const subject = 'Votre code de vérification AfriMarket';
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #007AFF; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
            .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 5px 5px; }
            .code { font-size: 32px; font-weight: bold; color: #007AFF; text-align: center; letter-spacing: 5px; margin: 20px 0; }
            .footer { margin-top: 20px; font-size: 12px; color: #666; text-align: center; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔐 Vérification AfriMarket</h1>
            </div>
            <div class="content">
              <p>Bonjour,</p>
              <p>Voici votre code de vérification unique:</p>
              <div class="code">${otp}</div>
              <p>Ce code expire dans <strong>10 minutes</strong>.</p>
              <p>Ne partagez jamais ce code avec quiconque.</p>
              <p>Si vous n'avez pas demandé cette vérification, ignorez ce message.</p>
              <div class="footer">
                <p>© 2026 AfriMarket - Marketplace confidentiel</p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    await emailService.sendEmail(email, subject, htmlContent);
    console.log('✅ Email OTP envoyé à', email);
    return { success: true };
  } catch (error) {
    console.error('❌ Erreur envoi email:', error.message);
    return { success: false, error: 'Operation failed' };
  }
};

// Valider le format du numéro de téléphone (Maroc: +212XXXXXXXXX)
const validatePhoneNumber = (phone) => {
  // Format: +212XXXXXXXXX ou 0XXXXXXXXX
  const phoneRegex = /^(\+212|0)[6-7]\d{8}$/;
  if (!phoneRegex.test(phone)) {
    return false;
  }
  return true;
};

// Formater le numéro de téléphone en +212XXXXXXXXX
const formatPhoneNumber = (phone) => {
  if (phone.startsWith('0')) {
    return '+212' + phone.slice(1);
  }
  if (!phone.startsWith('+212')) {
    return '+212' + phone;
  }
  return phone;
};

// Calculer expiration (10 minutes par défaut)
const getExpiryTime = (minutesFromNow = 10) => {
  return new Date(Date.now() + minutesFromNow * 60 * 1000);
};

module.exports = {
  generateOTP,
  sendSmsOTP,
  sendEmailOTP,
  validatePhoneNumber,
  formatPhoneNumber,
  getExpiryTime,
};
