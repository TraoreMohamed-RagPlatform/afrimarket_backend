const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const fs = require('fs').promises;

const prisma = new PrismaClient();

// =============================================
// CONFIGURATION - API FACE RECOGNITION
// =============================================
// Vous pouvez utiliser: AWS Rekognition, Google Vision, Face++, ou Azure Face API
// Pour cet exemple, on utilise une approche générique avec axios

const FACE_API_CONFIG = {
  provider: process.env.FACE_API_PROVIDER || 'face-plus-plus', // 'aws', 'google', 'face-plus-plus', 'azure'
  apiKey: process.env.FACE_API_KEY,
  apiSecret: process.env.FACE_API_SECRET,
  endpoint: process.env.FACE_API_ENDPOINT
};

const SIMILARITY_THRESHOLDS = {
  MIN_CONFIDENCE: 0.8,      // 80% minimum de confiance
  MIN_SIMILARITY: 0.75,     // 75% minimum de similarité entre les deux visages
  LIVENESS_THRESHOLD: 0.7   // 70% minimum pour détecter une personne vivante
};

// =============================================
// 1. DÉTECTER LES VISAGES DANS UNE IMAGE
// =============================================
exports.detectFace = async (imagePath) => {
  try {
    const imageBuffer = await fs.readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');

    // Appel API pour détecter les visages
    let response;

    if (FACE_API_CONFIG.provider === 'face-plus-plus') {
      response = await detectFaceWithFacePlusPlus(base64Image);
    } else if (FACE_API_CONFIG.provider === 'google') {
      response = await detectFaceWithGoogle(base64Image);
    } else if (FACE_API_CONFIG.provider === 'aws') {
      response = await detectFaceWithAWS(base64Image);
    } else {
      throw new Error('Provider non supporté');
    }

    return response;
  } catch (error) {
    console.error('[faceMatchingService]', error);
    return {
      detected: false,
      error: 'Erreur lors de la détection du visage'
    };
  }
};

// =============================================
// 2. COMPARER DEUX VISAGES (Selfie vs Document)
// =============================================
exports.compareFaces = async (selfiePath, documentImagePath) => {
  try {
    // Étape 1: Détecter les visages
    const selfieDetection = await exports.detectFace(selfiePath);
    const docDetection = await exports.detectFace(documentImagePath);

    if (!selfieDetection.detected) {
      return {
        similar: false,
        score: 0,
        error: 'Visage non détecté dans le selfie'
      };
    }

    if (!docDetection.detected) {
      return {
        similar: false,
        score: 0,
        error: 'Visage non détecté dans le document'
      };
    }

    // Étape 2: Comparer les deux visages
    const comparison = await compareFacesAPI(selfiePath, documentImagePath);

    return {
      similar: comparison.similarity >= SIMILARITY_THRESHOLDS.MIN_SIMILARITY,
      score: Math.round(comparison.similarity * 100),
      confidence: comparison.confidence,
      details: {
        selfieQuality: selfieDetection.quality || 'unknown',
        documentQuality: docDetection.quality || 'unknown',
        facesDetected: {
          selfie: selfieDetection.faceCount || 0,
          document: docDetection.faceCount || 0
        }
      }
    };
  } catch (error) {
    console.error('[faceMatchingService]', error);
    return {
      similar: false,
      score: 0,
      error: 'Erreur lors de la comparaison'
    };
  }
};

// =============================================
// 3. DÉTECTER LE LIVENESS (Personne vivante)
// =============================================
exports.detectLiveness = async (imagePath) => {
  try {
    const imageBuffer = await fs.readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');

    // Appel API pour détecter le liveness
    let livenessResponse;

    if (FACE_API_CONFIG.provider === 'face-plus-plus') {
      livenessResponse = await detectLivenessWithFacePlusPlus(base64Image);
    } else if (FACE_API_CONFIG.provider === 'google') {
      livenessResponse = await detectLivenessWithGoogle(base64Image);
    } else {
      // Fallback: analyse basique des métadonnées
      livenessResponse = await analyzeImageMetadata(imagePath);
    }

    return livenessResponse;
  } catch (error) {
    console.error('[faceMatchingService]', error);
    return {
      isLive: false,
      confidence: 0,
      error: 'Erreur lors de la détection de liveness'
    };
  }
};

// =============================================
// 4. METTRE À JOUR LE SCORE DE SIMILARITÉ EN BD
// =============================================
exports.updateFaceSimilarityScore = async (verificationId, faceScore, livenessScore, _details = {}) => {
  try {
    const updated = await prisma.identityVerification.update({
      where: { id: verificationId },
      data: {
        faceSimilarityScore: faceScore,
        verificationNotes: `Face similarity: ${faceScore}%, Liveness: ${livenessScore}%`
      }
    });

    return {
      success: true,
      verificationId: updated.id,
      faceSimilarityScore: updated.faceSimilarityScore,
      message: 'Score de similarité faciale mis à jour'
    };
  } catch (error) {
    console.error('[faceMatchingService]', error);
    return {
      success: false,
      error: 'Erreur lors de la mise à jour du score'
    };
  }
};

// =============================================
// 5. EFFECTUER UNE VÉRIFICATION COMPLÈTE (Face + Liveness)
// =============================================
exports.performFullFaceVerification = async (verificationId, selfiePath, documentImagePath) => {
  try {
    // Étape 1: Comparer les visages
    const faceComparison = await exports.compareFaces(selfiePath, documentImagePath);

    if (!faceComparison.similar) {
      return {
        passed: false,
        overallScore: faceComparison.score,
        reason: 'Les visages ne correspondent pas',
        details: faceComparison
      };
    }

    // Étape 2: Vérifier le liveness du selfie
    const livenessCheck = await exports.detectLiveness(selfiePath);

    if (!livenessCheck.isLive) {
      return {
        passed: false,
        overallScore: faceComparison.score,
        reason: 'Le selfie ne montre pas une personne vivante (détection anti-spoofing échouée)',
        details: {
          faceComparison,
          livenessCheck
        }
      };
    }

    // Étape 3: Calculer le score global
    const overallScore = Math.round(
      (faceComparison.score * 0.7 + livenessCheck.confidence * 100 * 0.3)
    );

    // Étape 4: Mettre à jour la BD
    await exports.updateFaceSimilarityScore(
      verificationId,
      faceComparison.score,
      livenessCheck.confidence * 100,
      { faceComparison, livenessCheck }
    );

    return {
      passed: overallScore >= 75,
      overallScore: overallScore,
      details: {
        faceComparison,
        livenessCheck
      },
      message: `Vérification faciale complétée. Score: ${overallScore}%`
    };
  } catch (error) {
    console.error('[faceMatchingService]', error);
    return {
      passed: false,
      overallScore: 0,
      error: 'Erreur lors de la vérification faciale complète'
    };
  }
};

// =============================================
// HELPER FUNCTIONS - API INTEGRATIONS
// =============================================

// Face++ (Megvii) - Integration
async function detectFaceWithFacePlusPlus(base64Image) {
  const response = await axios.post(
    'https://api-us.faceplusplus.com/facepp/v3/detect',
    `image_base64=${base64Image}&return_attributes=quality,liveness`,
    {
      auth: {
        username: FACE_API_CONFIG.apiKey,
        password: FACE_API_CONFIG.apiSecret
      }
    }
  );

  if (response.data.faces && response.data.faces.length > 0) {
    return {
      detected: true,
      faceCount: response.data.faces.length,
      quality: response.data.faces[0].attributes?.quality || 'unknown',
      confidence: response.data.faces[0].face_confidence || 0
    };
  }

  return { detected: false, faceCount: 0 };
}

async function detectLivenessWithFacePlusPlus(base64Image) {
  const response = await axios.post(
    'https://api-us.faceplusplus.com/facepp/v3/liveness',
    `image_base64=${base64Image}`,
    {
      auth: {
        username: FACE_API_CONFIG.apiKey,
        password: FACE_API_CONFIG.apiSecret
      }
    }
  );

  return {
    isLive: response.data.thresholds?.face_liveness > SIMILARITY_THRESHOLDS.LIVENESS_THRESHOLD,
    confidence: response.data.thresholds?.face_liveness || 0
  };
}

async function compareFacesAPI(selfiePath, documentPath) {
  const selfieBuffer = await fs.readFile(selfiePath);
  const docBuffer = await fs.readFile(documentPath);

  const response = await axios.post(
    'https://api-us.faceplusplus.com/facepp/v3/compare',
    `image_base64_1=${selfieBuffer.toString('base64')}&image_base64_2=${docBuffer.toString('base64')}`,
    {
      auth: {
        username: FACE_API_CONFIG.apiKey,
        password: FACE_API_CONFIG.apiSecret
      }
    }
  );

  return {
    similarity: response.data.confidence / 100,
    confidence: response.data.confidence / 100
  };
}

// Google Vision : non implémenté (fermé par défaut).
function detectFaceWithGoogle(_base64Image) {
  return { detected: false, error: 'Google Vision non configuré' };
}

// Google Vision ne fournit pas de détection du vivant : non implémenté.
// Fermé par défaut : on ne déclare jamais « vivant » sans analyse réelle.
function detectLivenessWithGoogle(_base64Image) {
  return { isLive: false, confidence: 0, method: 'not_implemented' };
}

// AWS Rekognition : non implémenté (fermé par défaut).
function detectFaceWithAWS(_base64Image) {
  return { detected: false, error: 'AWS Rekognition non configuré' };
}

// Aucun fournisseur de détection du vivant configuré : non implémenté.
// Fermé par défaut : la demande partira en revue manuelle.
function analyzeImageMetadata(_imagePath) {
  return { isLive: false, confidence: 0, method: 'not_implemented' };
}

module.exports = exports;