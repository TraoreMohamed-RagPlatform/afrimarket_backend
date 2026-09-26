const fs = require('fs');
const path = require('path');
const { sendEmail } = require('./emailService');

// Fonction pour charger et remplir un template
const loadTemplate = (templateName, variables = {}) => {
  try {
    const templatePath = path.join(__dirname, '..', 'templates', `${templateName}.html`);
    let template = fs.readFileSync(templatePath, 'utf-8');

    // Remplacer les variables {{key}} par les valeurs
    Object.keys(variables).forEach(key => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      template = template.replace(regex, variables[key] || '');
    });

    return template;
  } catch (error) {
    console.error(`❌ Erreur chargement template ${templateName}:`, error.message);
    throw error;
  }
};

// Envoyer email de notation reçue
const sendRatingReceivedEmail = async (seller, rating, raterName) => {
  const stars = '⭐'.repeat(rating.score);
  const variables = {
    userName: seller.username,
    listingTitle: rating.listing.title,
    score: rating.score,
    stars: stars,
    comment: rating.comment || 'Pas de commentaire',
    raterName: raterName,
    viewLink: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/ratings/${rating.id}`
  };

  const html = loadTemplate('ratingReceivedEmail', variables);
  await sendEmail(seller.email, `⭐ Nouvelle évaluation: ${rating.score}/5`, html);
};

// Envoyer email de message reçu
const sendMessageReceivedEmail = async (recipient, sender, message, listingTitle) => {
  const variables = {
    recipientName: recipient.username,
    senderName: sender.username,
    listingTitle: listingTitle,
    messageContent: message.content.substring(0, 200) + (message.content.length > 200 ? '...' : ''),
    chatLink: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/messages/${message.conversationId || message.id}`
  };

  const html = loadTemplate('messageReceivedEmail', variables);
  await sendEmail(recipient.email, `💬 Nouveau message de ${sender.username}`, html);
};

module.exports = {
  loadTemplate,
  sendRatingReceivedEmail,
  sendMessageReceivedEmail
};