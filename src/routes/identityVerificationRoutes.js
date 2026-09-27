const express = require('express');
const router = express.Router();
const identityVerificationController = require('../controllers/identityVerificationController');
const { uploadDocuments, uploadSelfie } = require('../middleware/uploadMiddleware');
const authMiddleware = require('../middleware/authMiddleware');

// =============================================
// ROUTES UTILISATEUR
// =============================================

// 1. Upload des documents (front + back)
router.post(
  '/upload-documents',
  authMiddleware,
  uploadDocuments,
  identityVerificationController.uploadIdentityDocuments
);

// 2. Upload du selfie
router.post(
  '/upload-selfie',
  authMiddleware,
  uploadSelfie,
  identityVerificationController.uploadSelfie
);

// 3. Soumettre la demande de vérification
router.post(
  '/submit',
  authMiddleware,
  identityVerificationController.submitIdentityVerification
);

// 4. Vérifier le statut de vérification
router.get(
  '/status',
  authMiddleware,
  identityVerificationController.getVerificationStatus
);

module.exports = router;