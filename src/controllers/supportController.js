// src/controllers/supportController.js
const SupportService = require('../utils/supportService');
const { sendServerError } = require('../utils/httpErrors');

class SupportController {
  // Contact Form Endpoints
  static async createContactForm(req, res) {
    try {
      // Client déjà vérifié par la route (App Check ou reCAPTCHA).
      const { name, email, subject, message, category } = req.body;

      // Validation
      if (!name || !email || !subject || !message) {
        return res.status(400).json({
          success: false,
          message: 'Tous les champs obligatoires doivent être fournis',
        });
      }

      const contactForm = await SupportService.createContactForm({
        name,
        email,
        subject,
        message,
        category,
        userId: req.user?.userId || null,
      });

      res.status(201).json({
        success: true,
        message: 'Formulaire de contact créé avec succès',
        data: contactForm,
      });
    } catch (error) {
      sendServerError(res, error, 'supportController.createContactForm');
    }
  }

  static async getContactForms(req, res) {
    try {
      const { status, category } = req.query;
      const filters = {};

      if (status) filters.status = status;
      if (category) filters.category = category;

      const contactForms = await SupportService.getContactForms(filters);

      res.status(200).json({
        success: true,
        data: contactForms,
        total: contactForms.length,
      });
    } catch (error) {
      sendServerError(res, error, 'supportController.getContactForms');
    }
  }

  static async getContactFormById(req, res) {
    try {
      const { id } = req.params;
      const contactForm = await SupportService.getContactFormById(id);

      if (!contactForm) {
        return res.status(404).json({
          success: false,
          message: 'Formulaire de contact non trouvé',
        });
      }

      res.status(200).json({
        success: true,
        data: contactForm,
      });
    } catch (error) {
      sendServerError(res, error, 'supportController.getContactFormById');
    }
  }

  static async updateContactForm(req, res) {
    try {
      const { id } = req.params;
      const { status, response } = req.body;

      const updatedForm = await SupportService.updateContactForm(id, {
        status,
        response,
      });

      res.status(200).json({
        success: true,
        message: 'Formulaire de contact mis à jour avec succès',
        data: updatedForm,
      });
    } catch (error) {
      sendServerError(res, error, 'supportController.updateContactForm');
    }
  }

  static async deleteContactForm(req, res) {
    try {
      const { id } = req.params;
      await SupportService.deleteContactForm(id);

      res.status(200).json({
        success: true,
        message: 'Formulaire de contact supprimé avec succès',
      });
    } catch (error) {
      sendServerError(res, error, 'supportController.deleteContactForm');
    }
  }

  // Support Ticket Endpoints
  static async createSupportTicket(req, res) {
    try {
      const { title, description, priority } = req.body;
      const userId = req.user.userId;

      if (!title || !description) {
        return res.status(400).json({
          success: false,
          message: 'Titre et description sont obligatoires',
        });
      }

      const ticket = await SupportService.createSupportTicket({
        userId,
        title,
        description,
        priority,
      });

      res.status(201).json({
        success: true,
        message: 'Ticket de support créé avec succès',
        data: ticket,
      });
    } catch (error) {
      sendServerError(res, error, 'supportController.createSupportTicket');
    }
  }

  static async getSupportTickets(req, res) {
    try {
      const { status, priority, userId } = req.query;
      const filters = {};

      if (status) filters.status = status;
      if (priority) filters.priority = priority;
      if (userId) filters.userId = userId;

      const tickets = await SupportService.getSupportTickets(filters);

      res.status(200).json({
        success: true,
        data: tickets,
        total: tickets.length,
      });
    } catch (error) {
      sendServerError(res, error, 'supportController.getSupportTickets');
    }
  }

  static async getSupportTicketById(req, res) {
    try {
      const { id } = req.params;
      const ticket = await SupportService.getSupportTicketById(id);

      if (!ticket) {
        return res.status(404).json({
          success: false,
          message: 'Ticket de support non trouvé',
        });
      }

      res.status(200).json({
        success: true,
        data: ticket,
      });
    } catch (error) {
      sendServerError(res, error, 'supportController.getSupportTicketById');
    }
  }

  static async updateSupportTicket(req, res) {
    try {
      const { id } = req.params;
      const { status, priority, response } = req.body;

      const updatedTicket = await SupportService.updateSupportTicket(id, {
        status,
        priority,
        response,
      });

      res.status(200).json({
        success: true,
        message: 'Ticket de support mis à jour avec succès',
        data: updatedTicket,
      });
    } catch (error) {
      sendServerError(res, error, 'supportController.updateSupportTicket');
    }
  }

  static async deleteSupportTicket(req, res) {
    try {
      const { id } = req.params;
      await SupportService.deleteSupportTicket(id);

      res.status(200).json({
        success: true,
        message: 'Ticket de support supprimé avec succès',
      });
    } catch (error) {
      sendServerError(res, error, 'supportController.deleteSupportTicket');
    }
  }

  // FAQ Endpoints
  static async createFAQ(req, res) {
    try {
      const { category, question, answer, order } = req.body;

      if (!category || !question || !answer) {
        return res.status(400).json({
          success: false,
          message: 'Catégorie, question et réponse sont obligatoires',
        });
      }

      const faq = await SupportService.createFAQ({
        category,
        question,
        answer,
        order,
      });

      res.status(201).json({
        success: true,
        message: 'FAQ créée avec succès',
        data: faq,
      });
    } catch (error) {
      sendServerError(res, error, 'supportController.createFAQ');
    }
  }

  static async getFAQs(req, res) {
    try {
      const { category } = req.query;
      const faqs = await SupportService.getFAQs(category);

      res.status(200).json({
        success: true,
        data: faqs,
        total: faqs.length,
      });
    } catch (error) {
      sendServerError(res, error, 'supportController.getFAQs');
    }
  }

  static async getFAQById(req, res) {
    try {
      const { id } = req.params;
      const faq = await SupportService.getFAQById(id);

      if (!faq) {
        return res.status(404).json({
          success: false,
          message: 'FAQ non trouvée',
        });
      }

      res.status(200).json({
        success: true,
        data: faq,
      });
    } catch (error) {
      sendServerError(res, error, 'supportController.getFAQById');
    }
  }

  static async updateFAQ(req, res) {
    try {
      const { id } = req.params;
      const { category, question, answer, order } = req.body;

      const updatedFAQ = await SupportService.updateFAQ(id, {
        category,
        question,
        answer,
        order,
      });

      res.status(200).json({
        success: true,
        message: 'FAQ mise à jour avec succès',
        data: updatedFAQ,
      });
    } catch (error) {
      sendServerError(res, error, 'supportController.updateFAQ');
    }
  }

  static async deleteFAQ(req, res) {
    try {
      const { id } = req.params;
      await SupportService.deleteFAQ(id);

      res.status(200).json({
        success: true,
        message: 'FAQ supprimée avec succès',
      });
    } catch (error) {
      sendServerError(res, error, 'supportController.deleteFAQ');
    }
  }

  static async getFAQCategories(req, res) {
    try {
      const categories = await SupportService.getFAQCategories();

      res.status(200).json({
        success: true,
        data: categories,
      });
    } catch (error) {
      sendServerError(res, error, 'supportController.getFAQCategories');
    }
  }
}

module.exports = SupportController;