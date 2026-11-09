const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { encodeJpeg } = require('./photoEncoding');

/**
 * Photos envoyées dans les discussions.
 *
 * Contrairement aux photos des annonces, elles sont PRIVÉES : le dossier
 * n'est jamais publié par app.js ; chaque photo n'est envoyée qu'aux deux
 * personnes de la discussion (GET /api/messages/photos/:messageId).
 */
const MESSAGE_PHOTOS_DIR = path.resolve(__dirname, '../../uploads/messages');

// Toujours « <uuid v4>.jpg », nom donné par le serveur.
const STORED_PHOTO_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/;

fs.mkdirSync(MESSAGE_PHOTOS_DIR, { recursive: true });

/**
 * Chemin d'une photo enregistrée, à partir de son nom (`Message.photoName`).
 * Le nom est revérifié : jamais de « .. » ni de séparateur (CWE-22).
 *
 * @param {unknown} name
 * @returns {string | null}
 */
const messagePhotoPath = (name) => {
  if (typeof name !== 'string' || !STORED_PHOTO_NAME.test(name)) {
    return null;
  }
  const resolved = path.resolve(MESSAGE_PHOTOS_DIR, name);
  return resolved.startsWith(MESSAGE_PHOTOS_DIR + path.sep) ? resolved : null;
};

/**
 * Réencode la photo envoyée (fichier temporaire) en JPEG sans métadonnées.
 *
 * @param {string} tempPath
 * @returns {Promise<{ name: string, width: number, height: number }>}
 * @throws si le fichier n'est pas une image lisible.
 */
const saveMessagePhoto = async (tempPath) => {
  const name = `${randomUUID()}.jpg`;
  const { width, height } = await encodeJpeg(tempPath, messagePhotoPath(name));
  return { name, width, height };
};

/**
 * Supprime des photos enregistrées. Ne lève jamais d'erreur.
 *
 * @param {Array<string | null | undefined>} names
 */
const removeMessagePhotos = (names) =>
  Promise.all(
    names.map(async (name) => {
      const file = messagePhotoPath(name);
      if (!file) return;
      try {
        await fs.promises.unlink(file);
      } catch {
        // Déjà supprimée : rien à faire.
      }
    }),
  );

module.exports = {
  MESSAGE_PHOTOS_DIR,
  messagePhotoPath,
  saveMessagePhoto,
  removeMessagePhotos,
};
