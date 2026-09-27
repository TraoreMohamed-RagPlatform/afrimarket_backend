const express = require('express');
const router = express.Router();
const AdminReportController = require('../controllers/adminReportController');
const authMiddleware = require('../middleware/authMiddleware');

// Middleware: Vérifier que l'utilisateur est admin
const isAdmin = (req, res, next) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Accès refusé - Administrateur requis',
    });
  }
  next();
};

// Routes protégées (Admin seulement)
router.use(authMiddleware, isAdmin);

// Rapports personnalisés
router.post('/create', AdminReportController.createReport);
router.get('/', AdminReportController.getReports);
router.get('/:id', AdminReportController.getReportById);
router.put('/:id', AdminReportController.updateReport);
router.delete('/:id', AdminReportController.deleteReport);

// Générer rapports spécifiques
router.post('/generate/users', AdminReportController.generateUsersReport);
router.post('/generate/listings', AdminReportController.generateListingsReport);
router.post('/generate/support', AdminReportController.generateSupportReport);

// Exporter en CSV
router.get('/:id/export/csv', AdminReportController.exportReportCSV);

module.exports = router;