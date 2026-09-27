const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Configuration du stockage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Les fichiers temporaires vont dans uploads/temp/
    const tempDir = path.join(__dirname, '../../uploads/temp');
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    // Renommer avec UUID pour éviter les conflits
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

// Filtre pour accepter que les images
const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png'];
  
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Type de fichier non autorisé: ${file.mimetype}`), false);
  }
};

// Configuration de multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

// Middleware pour upload de documents (front + back)
exports.uploadDocuments = upload.fields([
  { name: 'frontImage', maxCount: 1 },
  { name: 'backImage', maxCount: 1 }
]);

// Middleware pour upload de selfie
exports.uploadSelfie = upload.single('selfiePhoto');