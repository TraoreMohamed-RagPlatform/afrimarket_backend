const multer = require('multer');

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

  console.error(`[${req.method} ${req.originalUrl}]`, err);
  return res.status(500).json({ error: 'Internal server error' });
};

module.exports = errorHandler;
