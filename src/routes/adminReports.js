const express = require('express');
const AdminReportController = require('../controllers/adminReportController');
const authMiddleware = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

// Toutes les routes de ce fichier sont réservées aux administrateurs.
router.use(authMiddleware, requireRole('ADMIN'));

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
