const nodemailer = require('nodemailer');

// Configurer le transporter Mailtrap
const transporter = nodemailer.createTransport({
  host: process.env.MAILTRAP_HOST || 'sandbox.smtp.mailtrap.io',
  port: process.env.MAILTRAP_PORT || 2525,
  auth: {
    user: process.env.MAILTRAP_USER,
    pass: process.env.MAILTRAP_PASSWORD
  }
});

// Fonction générique pour envoyer un email
const sendEmail = async (to, subject, html, from = 'noreply@afrimarket.com') => {
  try {
    const mailOptions = {
      from,
      to,
      subject,
      html
    };

    const result = await transporter.sendMail(mailOptions);
    // Le destinataire n'est pas journalisé (donnée personnelle).
    console.log('✅ Email envoyé: %s', result.messageId);
    return result;
  } catch (error) {
    console.error('❌ Erreur envoi email:', error.message);
    throw error;
  }
};

module.exports = { sendEmail, transporter };