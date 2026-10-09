const express = require('express');
const router = express.Router();
const adminIdentityVerificationController = require('../controllers/adminIdentityVerificationController');
const authMiddleware = require('../middleware/authMiddleware');

// =============================================
// MIDDLEWARE - Vérifier que l'utilisateur est admin
// =============================================
const adminMiddleware = async (req, res, next) => {
  try {
    // Vérifier que l'utilisateur a le rôle 'admin'
    // À adapter selon votre structure utilisateur
    const user = await require('@prisma/client').PrismaClient().user.findUnique({
      where: { id: req.userId },
      select: { role: true }
    });

    if (!user || user.role !== 'admin') {
      return res.status(403).json({
        error: 'Accès refusé - Droits administrateur requis'
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({
      error: 'Erreur lors de la vérification des droits',
      details: error.message
    });
  }
};

// =============================================
// ROUTES ADMIN - VÉRIFICATION D'IDENTITÉ
// =============================================

// 1. Récupérer les demandes en attente
router.get(
  '/pending',
  authMiddleware,
  adminMiddleware,
  adminIdentityVerificationController.getVerificationsPending
);

// 2. Récupérer les statistiques
router.get(
  '/stats',
  authMiddleware,
  adminMiddleware,
  adminIdentityVerificationController.getVerificationStats
);

// 3. Récupérer toutes les vérifications (avec filtres)
router.get(
  '/',
  authMiddleware,
  adminMiddleware,
  adminIdentityVerificationController.getAllVerifications
);

// 4. Récupérer les détails d'une vérification
router.get(
  '/:verificationId',
  authMiddleware,
  adminMiddleware,
  adminIdentityVerificationController.getVerificationById
);

// 5. Approuver une demande
router.put(
  '/:verificationId/approve',
  authMiddleware,
  adminMiddleware,
  adminIdentityVerificationController.approveVerification
);

// 6. Rejeter une demande
router.put(
  '/:verificationId/reject',
  authMiddleware,
  adminMiddleware,
  adminIdentityVerificationController.rejectVerification
);

// 7. Ajouter des notes de vérification
router.put(
  '/:verificationId/notes',
  authMiddleware,
  adminMiddleware,
  adminIdentityVerificationController.addVerificationNotes
);

module.exports = router;