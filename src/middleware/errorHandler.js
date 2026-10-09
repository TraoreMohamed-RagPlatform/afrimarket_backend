const multer = require('multer');

const { sanitizeForLog } = require('../utils/logSafe');

/**
 * Dernier middleware de l'application.
 *
 * Règle : le client ne reçoit jamais de détail interne (message d'exception,
 * pile, requête SQL). Le détail est journalisé côté serveur uniquement.
 */
// Express reconnaît un gestionnaire d'erreurs à ses 4 paramètres.
const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  // Corps JSON mal formé.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  // Corps trop volumineux.
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' });
  }

  // Erreurs d'upload (taille, nombre de fichiers...).
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: 'Invalid upload', code: err.code });
  }

  // Chaîne de format fixe : l'URL du client n'est jamais interprétée comme
  // un format (CWE-134) et elle est nettoyée avant d'être journalisée (CWE-117).
  console.error('Unhandled error on %s %s', req.method, sanitizeForLog(req.originalUrl), err);
  return res.status(500).json({ error: 'Internal server error' });
};

module.exports = errorHandler;
