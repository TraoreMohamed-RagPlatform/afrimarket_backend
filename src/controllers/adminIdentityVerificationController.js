const { PrismaClient } = require('@prisma/client');
const identityVerificationService = require('../services/identityVerificationService');
const notificationService = require('../services/notificationService');
const { sendServerError } = require('../utils/httpErrors');

const prisma = new PrismaClient();

// =============================================
// 1. RÉCUPÉRER LES DEMANDES EN ATTENTE
// =============================================
exports.getVerificationsPending = async (req, res) => {
  try {
    const pending = await prisma.identityVerification.findMany({
      where: { status: 'PENDING' },
      select: {
        id: true,
        userId: true,
        documentType: true,
        documentCountry: true,
        status: true,
        faceSimilarityScore: true,
        createdAt: true,
        lastReviewedAt: true,
        reviewCount: true
      },
      orderBy: { createdAt: 'asc' }
    });

    return res.status(200).json({
      message: `${pending.length} demande(s) en attente`,
      data: pending
    });

  } catch (error) {
    return sendServerError(res, error, 'adminIdentityVerificationController.getVerificationsPending');
  }
};

// =============================================
// 2. RÉCUPÉRER LES DÉTAILS D'UNE DEMANDE
// =============================================
exports.getVerificationById = async (req, res) => {
  try {
    const { verificationId } = req.params;

    const verification = await prisma.identityVerification.findUnique({
      where: { id: verificationId },
      select: {
        id: true,
        userId: true,
        documentType: true,
        documentNumber: true,
        documentCountry: true,
        documentFrontImage: true,
        documentBackImage: true,
        selfiePhoto: true,
        status: true,
        faceSimilarityScore: true,
        verificationMethod: true,
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
      return res.status(404).json({
        error: 'Demande de vérification non trouvée'
      });
    }

    // Récupérer les infos de l'utilisateur
    const user = await prisma.user.findUnique({
      where: { id: verification.userId },
      select: { email: true, phone: true, fullName: true }
    });

    return res.status(200).json({
      message: 'Détails de la vérification',
      data: {
        verification,
        user
      }
    });

  } catch (error) {
    return sendServerError(res, error, 'adminIdentityVerificationController.getVerificationById');
  }
};

// =============================================
// 3. APPROUVER UNE DEMANDE
// =============================================
exports.approveVerification = async (req, res) => {
  try {
    const { verificationId } = req.params;
    const adminId = req.user.userId; // Admin qui approuve
    const { notes } = req.body;

    // Vérifier que la demande existe
    const verification = await prisma.identityVerification.findUnique({
      where: { id: verificationId }
    });

    if (!verification) {
      return res.status(404).json({
        error: 'Demande de vérification non trouvée'
      });
    }

    // Mettre à jour le statut
    await identityVerificationService.updateVerificationStatus(
      verificationId,
      'VERIFIED',
      {
        verifiedBy: adminId,
        verifiedAt: new Date(),
        verificationNotes: notes || 'Approuvé par l\'administrateur'
      }
    );

    // Incrémenter le compteur de révisions
    await identityVerificationService.incrementReviewCount(verificationId);

    // Notifier l'utilisateur
    const user = await prisma.user.findUnique({
      where: { id: verification.userId },
      select: { email: true, phone: true, fullName: true }
    });

    if (user) {
      await notificationService.notifyVerificationCompleted(
        verificationId,
        'VERIFIED',
        user.email,
        { userId: verification.userId, name: user.fullName }
      );
    }

    return res.status(200).json({
      message: 'Demande approuvée avec succès',
      data: {
        verificationId: verificationId,
        status: 'VERIFIED',
        approvedBy: adminId,
        approvedAt: new Date()
      }
    });

  } catch (error) {
    return sendServerError(res, error, 'adminIdentityVerificationController.approveVerification');
  }
};

// =============================================
// 4. REJETER UNE DEMANDE
// =============================================
exports.rejectVerification = async (req, res) => {
  try {
    const { verificationId } = req.params;
    const adminId = req.user.userId; // Admin qui rejette
    const { rejectionReason, rejectionDetails } = req.body;

    // Vérifier les champs requis
    if (!rejectionReason) {
      return res.status(400).json({
        error: 'La raison du rejet est requise'
      });
    }

    // Vérifier que la demande existe
    const verification = await prisma.identityVerification.findUnique({
      where: { id: verificationId }
    });

    if (!verification) {
      return res.status(404).json({
        error: 'Demande de vérification non trouvée'
      });
    }

    // Mettre à jour le statut
    await identityVerificationService.updateVerificationStatus(
      verificationId,
      'REJECTED',
      {
        rejectionReason: rejectionReason,
        rejectionDetails: rejectionDetails || null,
        verifiedBy: adminId,
        verificationNotes: `Rejeté par l'administrateur: ${rejectionReason}`
      }
    );

    // Incrémenter le compteur de révisions
    await identityVerificationService.incrementReviewCount(verificationId);

    // Notifier l'utilisateur
    const user = await prisma.user.findUnique({
      where: { id: verification.userId },
      select: { email: true, phone: true, fullName: true }
    });

    if (user) {
      await notificationService.notifyVerificationCompleted(
        verificationId,
        'REJECTED',
        user.email,
        {
          userId: verification.userId,
          name: user.fullName,
          rejectionReason: rejectionReason
        }
      );
    }

    return res.status(200).json({
      message: 'Demande rejetée avec succès',
      data: {
        verificationId: verificationId,
        status: 'REJECTED',
        rejectionReason: rejectionReason,
        rejectedBy: adminId,
        rejectedAt: new Date()
      }
    });

  } catch (error) {
    return sendServerError(res, error, 'adminIdentityVerificationController.rejectVerification');
  }
};

// =============================================
// 5. AJOUTER DES NOTES DE VÉRIFICATION
// =============================================
exports.addVerificationNotes = async (req, res) => {
  try {
    const { verificationId } = req.params;
    const { notes } = req.body;

    if (!notes) {
      return res.status(400).json({
        error: 'Les notes sont requises'
      });
    }

    const updated = await prisma.identityVerification.update({
      where: { id: verificationId },
      data: {
        verificationNotes: notes,
        lastReviewedAt: new Date()
      }
    });

    return res.status(200).json({
      message: 'Notes ajoutées avec succès',
      data: {
        verificationId: updated.id,
        notes: updated.verificationNotes
      }
    });

  } catch (error) {
    return sendServerError(res, error, 'adminIdentityVerificationController.addVerificationNotes');
  }
};

// =============================================
// 6. OBTENIR LES STATISTIQUES DE VÉRIFICATION
// =============================================
exports.getVerificationStats = async (req, res) => {
  try {
    // Compter par statut
    const verified = await prisma.identityVerification.count({
      where: { status: 'VERIFIED' }
    });

    const rejected = await prisma.identityVerification.count({
      where: { status: 'REJECTED' }
    });

    const pending = await prisma.identityVerification.count({
      where: { status: 'PENDING' }
    });

    const expired = await prisma.identityVerification.count({
      where: { status: 'EXPIRED' }
    });

    const total = verified + rejected + pending + expired;

    // Temps moyen de traitement (verified)
    const verifiedRecords = await prisma.identityVerification.findMany({
      where: { status: 'VERIFIED', verifiedAt: { not: null } },
      select: { createdAt: true, verifiedAt: true }
    });

    const avgProcessingTime = verifiedRecords.length > 0
      ? Math.round(
          verifiedRecords.reduce((sum, record) => {
            return sum + (record.verifiedAt - record.createdAt);
          }, 0) / verifiedRecords.length / 1000 / 60
        ) // en minutes
      : 0;

    // Score facial moyen
    const avgFaceScore = await prisma.identityVerification.aggregate({
      _avg: { faceSimilarityScore: true }
    });

    return res.status(200).json({
      message: 'Statistiques de vérification',
      data: {
        summary: {
          total: total,
          verified: verified,
          rejected: rejected,
          pending: pending,
          expired: expired
        },
        rates: {
          successRate: total > 0 ? Math.round((verified / total) * 100) : 0,
          rejectionRate: total > 0 ? Math.round((rejected / total) * 100) : 0,
          pendingRate: total > 0 ? Math.round((pending / total) * 100) : 0
        },
        averages: {
          processingTimeMinutes: avgProcessingTime,
          faceSimilarityScore: avgFaceScore._avg.faceSimilarityScore
            ? Math.round(avgFaceScore._avg.faceSimilarityScore)
            : 0
        }
      }
    });

  } catch (error) {
    return sendServerError(res, error, 'adminIdentityVerificationController.getVerificationStats');
  }
};

// =============================================
// 7. RÉCUPÉRER TOUTES LES VÉRIFICATIONS (avec filtres)
// =============================================
exports.getAllVerifications = async (req, res) => {
  try {
    const { status, skip = 0, take = 10 } = req.query;

    const where = status ? { status } : {};

    const verifications = await prisma.identityVerification.findMany({
      where,
      select: {
        id: true,
        userId: true,
        documentType: true,
        status: true,
        faceSimilarityScore: true,
        createdAt: true,
        verifiedAt: true,
        reviewCount: true
      },
      skip: parseInt(skip),
      take: parseInt(take),
      orderBy: { createdAt: 'desc' }
    });

    const total = await prisma.identityVerification.count({ where });

    return res.status(200).json({
      message: 'Liste des vérifications',
      data: verifications,
      pagination: {
        total,
        skip: parseInt(skip),
        take: parseInt(take)
      }
    });

  } catch (error) {
    return sendServerError(res, error, 'adminIdentityVerificationController.getAllVerifications');
  }
};

module.exports = exports;