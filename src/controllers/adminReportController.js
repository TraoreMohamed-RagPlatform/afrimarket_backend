const AdminReportService = require('../utils/adminReportService');

class AdminReportController {
  // Créer un rapport personnalisé
  static async createReport(req, res) {
    try {
      const { title, type, description, filters, data } = req.body;
      const userId = req.user.userId;

      if (!title || !type) {
        return res.status(400).json({
          success: false,
          message: 'Titre et type sont obligatoires',
        });
      }

      const report = await AdminReportService.createReport({
        title,
        type,
        description,
        filters: filters || {},
        data: data || {},
        generatedBy: userId,
      });

      res.status(201).json({
        success: true,
        message: 'Rapport créé avec succès',
        data: report,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Lister les rapports
  static async getReports(req, res) {
    try {
      const { page = 1, limit = 10, type, generatedBy, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

      const reports = await AdminReportService.getReports(
        { type, generatedBy },
        { page: parseInt(page), limit: parseInt(limit), sortBy, sortOrder }
      );

      res.status(200).json({
        success: true,
        data: reports.data,
        pagination: reports.pagination,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Obtenir un rapport par ID
  static async getReportById(req, res) {
    try {
      const { id } = req.params;

      const report = await AdminReportService.getReportById(id);

      if (!report) {
        return res.status(404).json({
          success: false,
          message: 'Rapport non trouvé',
        });
      }

      res.status(200).json({
        success: true,
        data: report,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Mettre à jour un rapport
  static async updateReport(req, res) {
    try {
      const { id } = req.params;
      const { title, description, filters, data } = req.body;

      const report = await AdminReportService.updateReport(id, {
        title,
        description,
        filters,
        data,
      });

      res.status(200).json({
        success: true,
        message: 'Rapport mis à jour avec succès',
        data: report,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Supprimer un rapport
  static async deleteReport(req, res) {
    try {
      const { id } = req.params;

      await AdminReportService.deleteReport(id);

      res.status(200).json({
        success: true,
        message: 'Rapport supprimé avec succès',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Générer rapport utilisateurs
  static async generateUsersReport(req, res) {
    try {
      const { status, role, dateFrom, dateTo } = req.query;
      const userId = req.user.userId;

      const report = await AdminReportService.generateUsersReport(
        { status, role, dateFrom, dateTo },
        userId
      );

      res.status(201).json({
        success: true,
        message: 'Rapport utilisateurs généré avec succès',
        data: report,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Générer rapport annonces
  static async generateListingsReport(req, res) {
    try {
      const { status, categoryId, dateFrom, dateTo, minPrice, maxPrice } = req.query;
      const userId = req.user.userId;

      const report = await AdminReportService.generateListingsReport(
        { status, categoryId, dateFrom, dateTo, minPrice, maxPrice },
        userId
      );

      res.status(201).json({
        success: true,
        message: 'Rapport annonces généré avec succès',
        data: report,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Générer rapport support
  static async generateSupportReport(req, res) {
    try {
      const { status, priority, dateFrom, dateTo } = req.query;
      const userId = req.user.userId;

      const report = await AdminReportService.generateSupportReport(
        { status, priority, dateFrom, dateTo },
        userId
      );

      res.status(201).json({
        success: true,
        message: 'Rapport support généré avec succès',
        data: report,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Exporter un rapport en CSV
  static async exportReportCSV(req, res) {
    try {
      const { id } = req.params;

      const report = await AdminReportService.getReportById(id);

      if (!report) {
        return res.status(404).json({
          success: false,
          message: 'Rapport non trouvé',
        });
      }

      // Générer CSV à partir des données du rapport
      let csv = `Rapport: ${report.title}\n`;
      csv += `Type: ${report.type}\n`;
      csv += `Généré par: ${report.user.fullName}\n`;
      csv += `Date: ${new Date(report.createdAt).toLocaleDateString()}\n\n`;

      // Ajouter les données du rapport
      if (report.data && report.data.summary) {
        csv += 'RÉSUMÉ\n';
        Object.entries(report.data.summary).forEach(([key, value]) => {
          csv += `${key},${value}\n`;
        });
        csv += '\n';
      }

      if (report.data && Array.isArray(report.data.users)) {
        csv += 'EMAIL,USERNAME,NOM COMPLET,RÔLE,STATUT,ÉVALUATION\n';
        report.data.users.forEach(user => {
          csv += `${user.email},${user.username},${user.fullName},${user.role},${user.status},${user.avgRating}\n`;
        });
      }

      if (report.data && Array.isArray(report.data.listings)) {
        csv += 'TITRE,PRIX,STATUT,VUES,VENDU\n';
        report.data.listings.forEach(listing => {
          csv += `${listing.title},${listing.price},${listing.status},${listing.views},${listing.isSold ? 'Oui' : 'Non'}\n`;
        });
      }

      if (report.data && Array.isArray(report.data.tickets)) {
        csv += 'NUMÉRO,TITRE,STATUT,PRIORITÉ,DATE\n';
        report.data.tickets.forEach(ticket => {
          csv += `${ticket.ticketNumber},${ticket.title},${ticket.status},${ticket.priority},${new Date(ticket.createdAt).toLocaleDateString()}\n`;
        });
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="rapport_${report.id}.csv"`);
      res.send(csv);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = AdminReportController;