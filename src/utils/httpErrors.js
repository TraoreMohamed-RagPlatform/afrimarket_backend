/**
 * Réponse 500 standard : le détail de l'erreur reste dans les journaux du
 * serveur et n'est jamais envoyé au client (OWASP A05, CWE-209).
 *
 * @param {import('express').Response} res
 * @param {unknown} error
 * @param {string} [context] Où l'erreur s'est produite, pour les journaux.
 */
const sendServerError = (res, error, context = 'request') => {
  console.error(`[${context}]`, error);
  return res.status(500).json({ error: 'Internal server error' });
};

module.exports = { sendServerError };
