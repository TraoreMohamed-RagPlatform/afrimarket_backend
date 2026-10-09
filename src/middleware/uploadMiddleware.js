const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const multer = require('multer');

const TEMP_DIR = path.resolve(__dirname, '../../uploads/temp');
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 Mo

// Extension déduite du type accepté, jamais du nom envoyé par le client :
// un fichier « photo.html » ou « photo.js » ne doit pas garder son extension.
const EXTENSION_BY_MIME = Object.freeze({
  'image/jpeg': '.jpg',
  'image/png': '.png',
});

fs.mkdirSync(TEMP_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TEMP_DIR),
  filename: (req, file, cb) => cb(null, `${randomUUID()}${EXTENSION_BY_MIME[file.mimetype]}`),
});

// Premier filtre sur le type déclaré. Le contenu réel est revérifié ensuite
// avec sharp dans le contrôleur (le type déclaré peut mentir).
const fileFilter = (req, file, cb) => {
  if (Object.hasOwn(EXTENSION_BY_MIME, file.mimetype)) {
    cb(null, true);
  } else {
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 2 },
});

// Nom donné par le serveur aux fichiers temporaires (voir « filename » ci-dessus).
const TEMP_FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png)$/;

/**
 * Chemin du fichier temporaire d'un upload, reconstruit à partir du nom généré
 * par le serveur : le chemin n'est jamais repris tel quel de la requête (CWE-22).
 *
 * @param {{ filename?: string }} file Fichier fourni par multer.
 * @returns {string}
 */
const tempUploadPath = (file) => {
  const name = path.basename(String(file?.filename ?? ''));
  if (!TEMP_FILE_NAME.test(name)) {
    throw new Error('Invalid temporary upload');
  }
  const resolved = path.resolve(TEMP_DIR, name);
  if (!resolved.startsWith(TEMP_DIR + path.sep)) {
    throw new Error('Invalid temporary upload');
  }
  return resolved;
};

/**
 * Supprime les fichiers temporaires d'une requête, qu'elle ait réussi ou non.
 * Ne lève jamais d'erreur (fichier déjà supprimé, nom invalide...).
 */
const removeTempUploads = (...files) =>
  Promise.all(
    files.filter(Boolean).map(async (file) => {
      try {
        await fs.promises.unlink(tempUploadPath(file));
      } catch {
        // Rien à faire : le fichier n'existe plus ou n'était pas valide.
      }
    }),
  );

exports.TEMP_DIR = TEMP_DIR;
exports.tempUploadPath = tempUploadPath;
exports.removeTempUploads = removeTempUploads;

// Pièce d'identité : recto + verso
exports.uploadDocuments = upload.fields([
  { name: 'frontImage', maxCount: 1 },
  { name: 'backImage', maxCount: 1 },
]);

// Selfie
exports.uploadSelfie = upload.single('selfiePhoto');
