const express = require('express');
const adminIdentityVerificationController = require('../controllers/adminIdentityVerificationController');
const authMiddleware = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

// Toutes les routes de ce fichier sont réservées aux administrateurs.
router.use(authMiddleware, requireRole('ADMIN'));

// Les routes fixes doivent rester avant '/:verificationId'.
router.get('/pending', adminIdentityVerificationController.getVerificationsPending);
router.get('/stats', adminIdentityVerificationController.getVerificationStats);
router.get('/', adminIdentityVerificationController.getAllVerifications);
router.get('/:verificationId', adminIdentityVerificationController.getVerificationById);

router.put('/:verificationId/approve', adminIdentityVerificationController.approveVerification);
router.put('/:verificationId/reject', adminIdentityVerificationController.rejectVerification);
router.put('/:verificationId/notes', adminIdentityVerificationController.addVerificationNotes);

module.exports = router;
