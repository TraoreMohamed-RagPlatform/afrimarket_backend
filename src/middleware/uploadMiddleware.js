const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const multer = require('multer');

const TEMP_DIR = path.join(__dirname, '../../uploads/temp');
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

// Pièce d'identité : recto + verso
exports.uploadDocuments = upload.fields([
  { name: 'frontImage', maxCount: 1 },
  { name: 'backImage', maxCount: 1 },
]);

// Selfie
exports.uploadSelfie = upload.single('selfiePhoto');
