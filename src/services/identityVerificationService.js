const sharp = require('sharp');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// =============================================
// CONSTANTES - SEUILS DE QUALITÉ
// =============================================
const QUALITY_THRESHOLDS = {
  MIN_SHARPNESS: 30,        // stdDev minimum pour considérer l'image nette
  MIN_CONTRAST: 0.3,        // Contraste minimum
  MIN_BRIGHTNESS: 0.2,      // Luminosité minimum
  MAX_BRIGHTNESS: 0.95,     // Luminosité maximum
  MIN_RESOLUTION: 1200 * 800, // 1200x800 pixels minimum
  MIN_QUALITY_SCORE: 60     // Score minimum accepté (0-100)
};

const DOCUMENT_EXPIRY_DAYS = 365 * 10; // Documents expirent après 10 ans

// =============================================
// 1. VALIDER LA QUALITÉ DU DOCUMENT (sharp stats)
// =============================================
exports.validateDocumentQuality = async (imagePath) => {
  try {
    const metadata = await sharp(imagePath).metadata();
    const stats = await sharp(imagePath).stats();

    const issues = [];
    let score = 100;

    // 1. Vérifier la netteté (sharpness via stdDev)
    const r_stdDev = stats.channels[0].std;
    const g_stdDev = stats.channels[1].std;
    const b_stdDev = stats.channels[2].std;
    const avgStdDev = (r_stdDev + g_stdDev + b_stdDev) / 3;

    if (avgStdDev < QUALITY_THRESHOLDS.MIN_SHARPNESS) {
      issues.push('Image floue détectée (stdDev < 30)');
      score -= 30;
    }

    // 2. Vérifier le contraste
    const channels = stats.channels;
    const contrasts = channels.map(ch => {
      if (ch.max === ch.min) return 0;
      return (ch.max - ch.min) / 255;
    });
    const avgContrast = contrasts.reduce((a, b) => a + b) / contrasts.length;

    if (avgContrast < QUALITY_THRESHOLDS.MIN_CONTRAST) {
      issues.push(`Contraste insuffisant (${avgContrast.toFixed(2)} < 0.3)`);
      score -= 20;
    }

    // 3. Vérifier la luminosité
    const means = channels.map(ch => ch.mean / 255);
    const avgMean = means.reduce((a, b) => a + b) / means.length;

    if (avgMean < QUALITY_THRESHOLDS.MIN_BRIGHTNESS || avgMean > QUALITY_THRESHOLDS.MAX_BRIGHTNESS) {
      issues.push(`Luminosité incorrect (${avgMean.toFixed(2)}) - trop sombre ou trop clair`);
      score -= 15;
    }

    // 4. Vérifier la résolution
    const resolution = metadata.width * metadata.height;
    if (resolution < QUALITY_THRESHOLDS.MIN_RESOLUTION) {
      issues.push(`Résolution trop faible (${metadata.width}x${metadata.height})`);
      score -= 25;
    }

    // Score minimum 0
    score = Math.max(0, score);

    return {
      valid: score >= QUALITY_THRESHOLDS.MIN_QUALITY_SCORE,
      score: score,
      issues: issues,
      metadata: {
        width: metadata.width,
        height: metadata.height,
        sharpness: Math.round(avgStdDev),
        contrast: avgContrast.toFixed(2),
        brightness: avgMean.toFixed(2)
      }
    };
  } catch (error) {
    return {
      valid: false,
      score: 0,
      error: `Erreur lors de l'analyse de qualité: ${error.message}`,
      issues: ['Impossible d\'analyser l\'image']
    };
  }
};

// =============================================
// 2. VALIDER L'EXPIRATION DU DOCUMENT
// =============================================
exports.validateDocumentExpiry = async (documentNumber, documentType, documentCountry, submittedDate) => {
  try {
    // Pour une implémentation réelle, vous intégreriez une API externe
    // qui vérifie si le numéro de document est valide et pas expiré
    // Pour cet exemple, on simule une vérification basique

    if (!documentNumber || documentNumber.length < 5) {
      return {
        valid: false,
        error: 'Numéro de document invalide'
      };
    }

    // Simuler une vérification (dans la réalité: appel API, base de données gouvernementale, etc.)
    const expiryDate = new Date(submittedDate);
    expiryDate.setDate(expiryDate.getDate() + DOCUMENT_EXPIRY_DAYS);

    return {
      valid: true,
      documentNumber: documentNumber,
      documentType: documentType,
      documentCountry: documentCountry,
      expiresAt: expiryDate,
      message: 'Document valide'
    };
  } catch (error) {
    return {
      valid: false,
      error: `Erreur lors de la validation d'expiration: ${error.message}`
    };
  }
};

// =============================================
// 3. METTRE À JOUR LE STATUT DE VÉRIFICATION
// =============================================
exports.updateVerificationStatus = async (verificationId, status, data = {}) => {
  try {
    const updateData = {
      status,
      lastReviewedAt: new Date(),
      ...data
    };

    if (status === 'VERIFIED') {
      updateData.verifiedAt = new Date();
    }

    if (status === 'REJECTED') {
      updateData.rejectionReason = data.rejectionReason || 'Vérification échouée';
      updateData.rejectionDetails = data.rejectionDetails || null;
    }

    const updated = await prisma.identityVerification.update({
      where: { id: verificationId },
      data: updateData
    });

    return {
      success: true,
      verificationId: updated.id,
      status: updated.status,
      message: `Statut mis à jour: ${status}`
    };
  } catch (error) {
    return {
      success: false,
      error: `Erreur lors de la mise à jour du statut: ${error.message}`
    };
  }
};

// =============================================
// 4. RÉCUPÉRER LES DÉTAILS DE VÉRIFICATION
// =============================================
exports.getVerificationDetails = async (verificationId) => {
  try {
    const verification = await prisma.identityVerification.findUnique({
      where: { id: verificationId },
      select: {
        id: true,
        userId: true,
        documentType: true,
        documentNumber: true,
        documentCountry: true,
        status: true,
        verificationMethod: true,
        faceSimilarityScore: true,
        rejectionReason: true,
        rejectionDetails: true,
        verificationNotes: true,
        verifiedBy: true,
        verifiedAt: true,
        lastReviewedAt: true,
        reviewCount: true,
        expiresAt: true,
        createdAt: true
      }
    });

    if (!verification) {
      return {
        found: false,
        error: 'Vérification d\'identité non trouvée'
      };
    }

    return {
      found: true,
      verification: verification
    };
  } catch (error) {
    return {
      found: false,
      error: `Erreur lors de la récupération des détails: ${error.message}`
    };
  }
};

// =============================================
// 5. INCRÉMENTER LE COMPTEUR DE RÉVISIONS
// =============================================
exports.incrementReviewCount = async (verificationId) => {
  try {
    const verification = await prisma.identityVerification.findUnique({
      where: { id: verificationId },
      select: { reviewCount: true }
    });

    if (!verification) {
      return {
        success: false,
        error: 'Vérification d\'identité non trouvée'
      };
    }

    const updated = await prisma.identityVerification.update({
      where: { id: verificationId },
      data: {
        reviewCount: (verification.reviewCount || 0) + 1,
        lastReviewedAt: new Date()
      }
    });

    return {
      success: true,
      reviewCount: updated.reviewCount,
      message: `Compteur de révision mis à jour: ${updated.reviewCount}`
    };
  } catch (error) {
    return {
      success: false,
      error: `Erreur lors de l'incrémentation: ${error.message}`
    };
  }
};

module.exports = exports;