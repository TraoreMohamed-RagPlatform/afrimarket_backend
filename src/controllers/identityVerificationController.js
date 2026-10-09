const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const { PrismaClient } = require('@prisma/client');

// ===== IMPORTER LES SERVICES =====
const identityVerificationService = require('../services/identityVerificationService');
const faceMatchingService = require('../services/faceMatchingService');
const notificationService = require('../services/notificationService');
const { decideKycOutcome, KYC_OUTCOME } = require('../services/kycDecision');

const prisma = new PrismaClient();

// =============================================
// CONSTANTES
// =============================================
const UPLOAD_DIR = path.join(__dirname, '../../uploads/identity');
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;

// =============================================
// INITIALISATION - Créer le dossier uploads s'il n'existe pas
// =============================================
const initializeUploadDir = async () => {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch (error) {
    console.error('Erreur lors de la création du dossier uploads:', error);
  }
};

initializeUploadDir();

// =============================================
// VALIDATION DES FICHIERS
// =============================================
const validateImageFile = async (file) => {
  try {
    // 1. Vérifier le MIME type
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return {
        valid: false,
        error: `Format non autorisé. Accepté: JPEG, PNG. Reçu: ${file.mimetype}`
      };
    }

    // 2. Vérifier la taille du fichier
    if (file.size > MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `Fichier trop volumineux. Max: 5MB. Reçu: ${(file.size / 1024 / 1024).toFixed(2)}MB`
      };
    }

    // 3. Vérifier les dimensions de l'image avec sharp
    const metadata = await sharp(file.path).metadata();

    if (!metadata.width || !metadata.height) {
      return {
        valid: false,
        error: `Impossible de lire les dimensions de l'image`
      };
    }

    if (metadata.width < MIN_WIDTH || metadata.height < MIN_HEIGHT) {
      return {
        valid: false,
        error: `Résolution trop faible. Min: ${MIN_WIDTH}x${MIN_HEIGHT}. Reçu: ${metadata.width}x${metadata.height}`
      };
    }

    // ✅ Tout est bon
    return { valid: true };

  } catch (error) {
    return {
      valid: false,
      error: `Erreur lors de la validation: ${error.message}`
    };
  }
};

// =============================================
// 1. UPLOAD DES DOCUMENTS (FRONT + BACK)
// =============================================
exports.uploadIdentityDocuments = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { documentType } = req.body;

    // Vérifier que les deux fichiers sont présents
    if (!req.files || !req.files.frontImage || !req.files.backImage) {
      return res.status(400).json({
        error: 'Les deux images (front et back) sont requises'
      });
    }

    const frontFile = req.files.frontImage[0];
    const backFile = req.files.backImage[0];

    // Valider les deux fichiers
    const frontValidation = await validateImageFile(frontFile);
    if (!frontValidation.valid) {
      return res.status(400).json({ error: frontValidation.error });
    }

    const backValidation = await validateImageFile(backFile);
    if (!backValidation.valid) {
      return res.status(400).json({ error: backValidation.error });
    }

    // ===== UTILISER LE SERVICE POUR VALIDER LA QUALITÉ =====
    const frontQuality = await identityVerificationService.validateDocumentQuality(frontFile.path);
    if (!frontQuality.valid) {
      return res.status(400).json({
        error: 'Qualité insuffisante du document (face avant)',
        details: frontQuality.issues,
        score: frontQuality.score
      });
    }

    const backQuality = await identityVerificationService.validateDocumentQuality(backFile.path);
    if (!backQuality.valid) {
      return res.status(400).json({
        error: 'Qualité insuffisante du document (face arrière)',
        details: backQuality.issues,
        score: backQuality.score
      });
    }

    // Créer les dossiers utilisateur
    const userDocDir = path.join(UPLOAD_DIR, userId, 'documents');
    await fs.mkdir(userDocDir, { recursive: true });

    // Renommer et sauvegarder les fichiers avec UUID
    const frontFilename = `${uuidv4()}.png`;
    const backFilename = `${uuidv4()}.png`;

    const frontPath = path.join(userDocDir, frontFilename);
    const backPath = path.join(userDocDir, backFilename);

    // Copier et convertir en PNG avec sharp
    await sharp(frontFile.path).png().toFile(frontPath);
    await sharp(backFile.path).png().toFile(backPath);

    // Supprimer les fichiers temporaires
    await fs.unlink(frontFile.path);
    await fs.unlink(backFile.path);

    // Retourner les chemins relatifs
    const frontRelativePath = path.relative(path.join(__dirname, '../../'), frontPath);
    const backRelativePath = path.relative(path.join(__dirname, '../../'), backPath);

    return res.status(200).json({
      message: 'Documents uploadés avec succès',
      data: {
        frontImage: frontRelativePath,
        backImage: backRelativePath,
        documentType,
        qualityScores: {
          front: frontQuality.score,
          back: backQuality.score
        }
      }
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Erreur lors de l\'upload des documents',
      details: error.message
    });
  }
};

// =============================================
// 2. UPLOAD DU SELFIE
// =============================================
exports.uploadSelfie = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Vérifier que le fichier est présent
    if (!req.file) {
      return res.status(400).json({
        error: 'L\'image du selfie est requise'
      });
    }

    // Valider le fichier
    const validation = await validateImageFile(req.file);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    // ===== UTILISER LE SERVICE POUR VALIDER LA QUALITÉ =====
    const quality = await identityVerificationService.validateDocumentQuality(req.file.path);
    if (!quality.valid) {
      return res.status(400).json({
        error: 'Qualité insuffisante du selfie',
        details: quality.issues,
        score: quality.score
      });
    }

    // ===== UTILISER LE SERVICE POUR DÉTECTER LE VISAGE ET LIVENESS =====
    const faceDetection = await faceMatchingService.detectFace(req.file.path);
    if (!faceDetection.detected) {
      return res.status(400).json({
        error: 'Aucun visage détecté dans le selfie. Veuillez réessayer.'
      });
    }

    // Créer le dossier utilisateur
    const userSelfieDir = path.join(UPLOAD_DIR, userId, 'selfie');
    await fs.mkdir(userSelfieDir, { recursive: true });

    // Renommer et sauvegarder le fichier
    const filename = `${uuidv4()}.png`;
    const selfieFilePath = path.join(userSelfieDir, filename);

    // Convertir en PNG
    await sharp(req.file.path).png().toFile(selfieFilePath);

    // Supprimer le fichier temporaire
    await fs.unlink(req.file.path);

    // Retourner le chemin relatif
    const relativePath = path.relative(path.join(__dirname, '../../'), selfieFilePath);

    return res.status(200).json({
      message: 'Selfie uploadé avec succès',
      data: {
        selfiePhoto: relativePath,
        qualityScore: quality.score,
        faceDetected: faceDetection.detected,
        faceCount: faceDetection.faceCount
      }
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Erreur lors de l\'upload du selfie',
      details: error.message
    });
  }
};

// =============================================
// 3. SOUMETTRE LA DEMANDE DE VÉRIFICATION
// =============================================
exports.submitIdentityVerification = async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      documentType,
      documentNumber,
      documentCountry,
      frontImage,
      backImage,
      selfiePhoto
    } = req.body;

    // =====================
    // VALIDATION DES DONNÉES
    // =====================
    if (!documentType || !documentNumber || !documentCountry || !frontImage || !backImage || !selfiePhoto) {
      return res.status(400).json({
        error: 'Tous les champs sont requis'
      });
    }

    // Vérifier documentType
    const validDocTypes = ['NATIONAL_ID', 'PASSPORT', 'DRIVER_LICENSE'];
    if (!validDocTypes.includes(documentType)) {
      return res.status(400).json({
        error: `Type de document invalide. Accepté: ${validDocTypes.join(', ')}`
      });
    }

    // Vérifier qu'il n'y a pas déjà une vérification en cours
    const existingVerification = await prisma.identityVerification.findUnique({
      where: { userId }
    });

    if (existingVerification) {
      return res.status(400).json({
        error: `Une demande de vérification existe déjà avec le statut: ${existingVerification.status}`
      });
    }

    // =====================
    // CRÉER L'ENREGISTREMENT
    // =====================
    const verificationRecord = await prisma.identityVerification.create({
      data: {
        userId,
        documentType,
        documentNumber,
        documentCountry,
        documentFrontImage: frontImage,
        documentBackImage: backImage,
        selfiePhoto,
        status: 'PENDING',
        verificationMethod: 'MANUAL',
        createdAt: new Date()
      }
    });

    // =====================
    // EFFECTUER LA VÉRIFICATION FACIALE AUTOMATIQUE
    // =====================
    const faceVerification = await faceMatchingService.performFullFaceVerification(
      verificationRecord.id,
      selfiePhoto,
      frontImage
    );

    // =====================
    // DÉCISION - voir services/kycDecision.js
    // (revue manuelle par défaut tant que la décision automatique est désactivée)
    // =====================
    const outcome = decideKycOutcome(faceVerification.overallScore);

    if (outcome === KYC_OUTCOME.VERIFIED) {
      // ✅ SCORE EXCELLENT → VERIFIED AUTOMATIQUEMENT
      await identityVerificationService.updateVerificationStatus(
        verificationRecord.id,
        'VERIFIED',
        {
          faceSimilarityScore: faceVerification.overallScore,
          verificationMethod: 'AUTOMATED_HIGH_CONFIDENCE'
        }
      );

      // Notifier l'utilisateur
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, phone: true, fullName: true }
      });

      if (user) {
        await notificationService.notifyVerificationCompleted(
          verificationRecord.id,
          'VERIFIED',
          user.email,
          { userId, name: user.fullName }
        );
      }

      return res.status(201).json({
        message: 'Vérification automatique approuvée!',
        data: {
          verificationId: verificationRecord.id,
          status: 'VERIFIED',
          faceScore: faceVerification.overallScore,
          autoApproved: true,
          createdAt: verificationRecord.createdAt
        }
      });

    } else if (outcome === KYC_OUTCOME.MANUAL_REVIEW) {
      // ⏳ SCORE MOYEN → EN ATTENTE DE VÉRIFICATION ADMIN
      await identityVerificationService.updateVerificationStatus(
        verificationRecord.id,
        'PENDING',
        {
          faceSimilarityScore: faceVerification.overallScore,
          verificationMethod: 'MANUAL_REVIEW_NEEDED',
          verificationNotes: `Score automatique: ${faceVerification.overallScore}%. Vérification manuelle requise.`
        }
      );

      // Notifier l'admin
      await notificationService.sendAdminEmail('ADMIN_NEW_REQUEST', {
        verificationId: verificationRecord.id,
        userId: userId,
        documentType: documentType,
        faceSimilarityScore: faceVerification.overallScore,
        priority: 'MEDIUM'
      });

      return res.status(201).json({
        message: 'Demande en attente de vérification manuelle',
        data: {
          verificationId: verificationRecord.id,
          status: 'PENDING',
          faceScore: faceVerification.overallScore,
          requiresManualReview: true,
          createdAt: verificationRecord.createdAt
        }
      });

    } else {
      // ❌ SCORE FAIBLE → REJECTED AUTOMATIQUEMENT
      await identityVerificationService.updateVerificationStatus(
        verificationRecord.id,
        'REJECTED',
        {
          faceSimilarityScore: faceVerification.overallScore,
          rejectionReason: 'Qualité insuffisante du visage détecté',
          rejectionDetails: faceVerification.reason
        }
      );

      // Notifier l'utilisateur
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, phone: true, fullName: true }
      });

      if (user) {
        await notificationService.notifyVerificationCompleted(
          verificationRecord.id,
          'REJECTED',
          user.email,
          {
            userId,
            name: user.fullName,
            rejectionReason: 'La similarité faciale est insuffisante. Veuillez réessayer.'
          }
        );
      }

      return res.status(400).json({
        message: 'Vérification échouée - Score insuffisant',
        data: {
          verificationId: verificationRecord.id,
          status: 'REJECTED',
          faceScore: faceVerification.overallScore,
          reason: faceVerification.reason,
          createdAt: verificationRecord.createdAt
        }
      });
    }

  } catch (error) {
    return res.status(500).json({
      error: 'Erreur lors de la soumission de la demande',
      details: error.message
    });
  }
};

// =============================================
// 4. VÉRIFIER LE STATUT DE VÉRIFICATION
// =============================================
exports.getVerificationStatus = async (req, res) => {
  try {
    const userId = req.user.userId;

    // ===== UTILISER LE SERVICE POUR RÉCUPÉRER LES DÉTAILS =====
    const result = await identityVerificationService.getVerificationDetails(userId);

    if (!result.found) {
      return res.status(404).json({
        error: result.error
      });
    }

    return res.status(200).json({
      message: 'Statut de vérification récupéré',
      data: result.verification
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Erreur lors de la récupération du statut',
      details: error.message
    });
  }
};

module.exports = exports;