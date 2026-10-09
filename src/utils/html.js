const HTML_ESCAPES = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

/**
 * Échappe une valeur avant de l'insérer dans du HTML (e-mails).
 *
 * Toute donnée saisie par un utilisateur (nom, titre d'annonce, message,
 * commentaire...) doit passer par ici : sans cela, un utilisateur peut injecter
 * des liens ou du contenu trompeur dans les e-mails envoyés aux autres (XSS /
 * injection HTML, CWE-79).
 *
 * @param {unknown} value
 * @returns {string}
 */
const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

module.exports = { escapeHtml };
