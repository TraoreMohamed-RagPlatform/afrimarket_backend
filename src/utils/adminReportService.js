const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Tri et pagination : seules ces valeurs sont acceptées. Une clé de tri venant
// de la requête ne doit jamais devenir directement un nom de propriété
// (injection de propriété, CWE-915).
const REPORT_SORT_FIELDS = Object.freeze(['createdAt', 'updatedAt', 'title', 'type']);
const SORT_ORDERS = Object.freeze(['asc', 'desc']);
const MAX_REPORTS_PER_PAGE = 100;

// Construit l'objet de tri à partir d'une liste fixe (aucune clé dynamique).
const buildOrderBy = (sortBy, sortOrder) => {
  switch (sortBy) {
    case 'updatedAt':
      return { updatedAt: sortOrder };
    case 'title':
      return { title: sortOrder };
    case 'type':
      return { type: sortOrder };
    default:
      return { createdAt: sortOrder };
  }
};

const toReportQueryOptions = ({ page, limit, sortBy, sortOrder } = {}) => {
  const pageNum = Number.parseInt(page, 10);
  const limitNum = Number.parseInt(limit, 10);
  return {
    page: Number.isInteger(pageNum) && pageNum > 0 ? pageNum : 1,
    limit: Number.isInteger(limitNum) && limitNum > 0 ? Math.min(limitNum, MAX_REPORTS_PER_PAGE) : 10,
    sortBy: REPORT_SORT_FIELDS.includes(sortBy) ? sortBy : 'createdAt',
    sortOrder: SORT_ORDERS.includes(sortOrder) ? sortOrder : 'desc',
  };
};

class AdminReportService {
  // Créer un rapport
  static async createReport(data) {
    try {
      const report = await prisma.adminReport.create({
        data: {
          title: data.title,
          type: data.type,
          description: data.description,
          filters: data.filters || {},
          data: data.data || {},
          generatedBy: data.generatedBy,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              fullName: true,
            },
          },
        },
      });

      return report;
    } catch (error) {
      throw new Error(`Erreur création rapport: ${error.message}`);
    }
  }

  // Lister les rapports avec filtrage et pagination
  static async getReports(filters = {}, options = {}) {
    try {
      // Bug corrigé : les filtres étaient passés mais jamais lus.
      const { type, generatedBy } = filters;
      const { page, limit, sortBy, sortOrder } = toReportQueryOptions(options);
      const skip = (page - 1) * limit;

      const where = {};
      // Uniquement des chaînes : un objet ({ contains: ... }) changerait le filtre.
      if (typeof type === 'string' && type) where.type = type;
      if (typeof generatedBy === 'string' && generatedBy) where.generatedBy = generatedBy;

      const reports = await prisma.adminReport.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              fullName: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: buildOrderBy(sortBy, sortOrder),
      });

      const total = await prisma.adminReport.count({ where });

      return {
        data: reports,
        pagination: {
          total,
          pages: Math.ceil(total / limit),
          currentPage: page,
          limit,
        },
      };
    } catch (error) {
      throw new Error(`Erreur récupération rapports: ${error.message}`);
    }
  }

  // Obtenir un rapport par ID
  static async getReportById(id) {
    try {
      const report = await prisma.adminReport.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              fullName: true,
            },
          },
        },
      });

      return report;
    } catch (error) {
      throw new Error(`Erreur récupération rapport: ${error.message}`);
    }
  }

  // Mettre à jour un rapport
  static async updateReport(id, data) {
    try {
      const report = await prisma.adminReport.update({
        where: { id },
        data: {
          title: data.title,
          description: data.description,
          filters: data.filters,
          data: data.data,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              fullName: true,
            },
          },
        },
      });

      return report;
    } catch (error) {
      throw new Error(`Erreur mise à jour rapport: ${error.message}`);
    }
  }

  // Supprimer un rapport
  static async deleteReport(id) {
    try {
      await prisma.adminReport.delete({
        where: { id },
      });

      return { message: 'Rapport supprimé avec succès' };
    } catch (error) {
      throw new Error(`Erreur suppression rapport: ${error.message}`);
    }
  }

  // Générer rapport utilisateurs
  static async generateUsersReport(filters = {}, userId) {
    try {
      const { status, role, dateFrom, dateTo } = filters;

      const where = {};
      if (status) where.status = status;
      if (role) where.role = role;
      if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) where.createdAt.gte = new Date(dateFrom);
        if (dateTo) where.createdAt.lte = new Date(dateTo);
      }

      const users = await prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          username: true,
          fullName: true,
          role: true,
          status: true,
          avgRating: true,
          totalRatings: true,
          createdAt: true,
        },
      });

      const report = await this.createReport({
        title: `Rapport Utilisateurs - ${new Date().toLocaleDateString()}`,
        type: 'USERS',
        description: `Rapport généré avec filtres: status=${status || 'tous'}, role=${role || 'tous'}`,
        filters,
        data: {
          totalUsers: users.length,
          users,
          summary: {
            totalActiveUsers: users.filter(u => u.status === 'ACTIVE').length,
            totalSuspendedUsers: users.filter(u => u.status === 'SUSPENDED').length,
            averageRating: users.length > 0 ? (users.reduce((sum, u) => sum + (u.avgRating || 0), 0) / users.length).toFixed(2) : 0,
          },
        },
        generatedBy: userId,
      });

      return report;
    } catch (error) {
      throw new Error(`Erreur génération rapport utilisateurs: ${error.message}`);
    }
  }

  // Générer rapport annonces
  static async generateListingsReport(filters = {}, userId) {
    try {
      const { status, categoryId, dateFrom, dateTo, minPrice, maxPrice } = filters;

      const where = {};
      if (status) where.status = status;
      if (categoryId) where.categoryId = categoryId;
      if (minPrice || maxPrice) {
        where.price = {};
        if (minPrice) where.price.gte = parseFloat(minPrice);
        if (maxPrice) where.price.lte = parseFloat(maxPrice);
      }
      if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) where.createdAt.gte = new Date(dateFrom);
        if (dateTo) where.createdAt.lte = new Date(dateTo);
      }

      const listings = await prisma.listing.findMany({
        where,
        select: {
          id: true,
          title: true,
          price: true,
          status: true,
          views: true,
          isSold: true,
          createdAt: true,
          category: {
            select: { name: true },
          },
          user: {
            select: { username: true, email: true },
          },
        },
      });

      const report = await this.createReport({
        title: `Rapport Annonces - ${new Date().toLocaleDateString()}`,
        type: 'LISTINGS',
        description: `Rapport généré avec filtres: status=${status || 'toutes'}, categoryId=${categoryId || 'toutes'}`,
        filters,
        data: {
          totalListings: listings.length,
          listings,
          summary: {
            activeListings: listings.filter(l => l.status === 'ACTIVE').length,
            soldListings: listings.filter(l => l.isSold).length,
            totalViews: listings.reduce((sum, l) => sum + l.views, 0),
            averagePrice: listings.length > 0 ? (listings.reduce((sum, l) => sum + l.price, 0) / listings.length).toFixed(2) : 0,
          },
        },
        generatedBy: userId,
      });

      return report;
    } catch (error) {
      throw new Error(`Erreur génération rapport annonces: ${error.message}`);
    }
  }

  // Générer rapport support
  static async generateSupportReport(filters = {}, userId) {
    try {
      const { status, priority, dateFrom, dateTo } = filters;

      const where = {};
      if (status) where.status = status;
      if (priority) where.priority = priority;
      if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) where.createdAt.gte = new Date(dateFrom);
        if (dateTo) where.createdAt.lte = new Date(dateTo);
      }

      const tickets = await prisma.supportTicket.findMany({
        where,
        select: {
          id: true,
          ticketNumber: true,
          title: true,
          status: true,
          priority: true,
          createdAt: true,
          user: {
            select: { username: true, email: true },
          },
        },
      });

      const report = await this.createReport({
        title: `Rapport Support - ${new Date().toLocaleDateString()}`,
        type: 'SUPPORT',
        description: `Rapport généré avec filtres: status=${status || 'tous'}, priority=${priority || 'toutes'}`,
        filters,
        data: {
          totalTickets: tickets.length,
          tickets,
          summary: {
            openTickets: tickets.filter(t => t.status === 'OPEN').length,
            inProgressTickets: tickets.filter(t => t.status === 'IN_PROGRESS').length,
            resolvedTickets: tickets.filter(t => t.status === 'RESOLVED').length,
            urgentTickets: tickets.filter(t => t.priority === 'URGENT').length,
          },
        },
        generatedBy: userId,
      });

      return report;
    } catch (error) {
      throw new Error(`Erreur génération rapport support: ${error.message}`);
    }
  }
}

module.exports = AdminReportService;
module.exports.toReportQueryOptions = toReportQueryOptions;
module.exports.buildOrderBy = buildOrderBy;