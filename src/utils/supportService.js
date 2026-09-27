// src/utils/supportService.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class SupportService {
  // Contact Form Methods
  static async createContactForm(data) {
    try {
      return await prisma.contactForm.create({
        data: {
          name: data.name,
          email: data.email,
          subject: data.subject,
          message: data.message,
          category: data.category || 'other',
          status: 'OPEN',
          userId: data.userId || null,
        },
      });
    } catch (error) {
      throw new Error(`Error creating contact form: ${error.message}`);
    }
  }

  static async getContactForms(filters = {}) {
    try {
      const where = {};
      if (filters.status) where.status = filters.status;
      if (filters.userId) where.userId = filters.userId;
      if (filters.category) where.category = filters.category;

      return await prisma.contactForm.findMany({
        where,
        include: { user: { select: { id: true, email: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      throw new Error(`Error fetching contact forms: ${error.message}`);
    }
  }

  static async getContactFormById(id) {
    try {
      return await prisma.contactForm.findUnique({
        where: { id },
        include: { user: { select: { id: true, email: true, fullName: true } } },
      });
    } catch (error) {
      throw new Error(`Error fetching contact form: ${error.message}`);
    }
  }

  static async updateContactForm(id, data) {
    try {
      return await prisma.contactForm.update({
        where: { id },
        data: {
          status: data.status || undefined,
          response: data.response || undefined,
        },
      });
    } catch (error) {
      throw new Error(`Error updating contact form: ${error.message}`);
    }
  }

  static async deleteContactForm(id) {
    try {
      return await prisma.contactForm.delete({
        where: { id },
      });
    } catch (error) {
      throw new Error(`Error deleting contact form: ${error.message}`);
    }
  }

  // Support Ticket Methods
  static async createSupportTicket(data) {
    try {
      // Generate ticket number
      const count = await prisma.supportTicket.count();
      const ticketNumber = `TK-${String(count + 1).padStart(3, '0')}`;

      return await prisma.supportTicket.create({
        data: {
          ticketNumber,
          userId: data.userId,
          title: data.title,
          description: data.description,
          status: 'OPEN',
          priority: data.priority || 'MEDIUM',
        },
      });
    } catch (error) {
      throw new Error(`Error creating support ticket: ${error.message}`);
    }
  }

  static async getSupportTickets(filters = {}) {
    try {
      const where = {};
      if (filters.status) where.status = filters.status;
      if (filters.userId) where.userId = filters.userId;
      if (filters.priority) where.priority = filters.priority;

      return await prisma.supportTicket.findMany({
        where,
        include: { user: { select: { id: true, email: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      throw new Error(`Error fetching support tickets: ${error.message}`);
    }
  }

  static async getSupportTicketById(id) {
    try {
      return await prisma.supportTicket.findUnique({
        where: { id },
        include: { user: { select: { id: true, email: true, fullName: true } } },
      });
    } catch (error) {
      throw new Error(`Error fetching support ticket: ${error.message}`);
    }
  }

  static async updateSupportTicket(id, data) {
    try {
      return await prisma.supportTicket.update({
        where: { id },
        data: {
          status: data.status || undefined,
          priority: data.priority || undefined,
          response: data.response || undefined,
        },
      });
    } catch (error) {
      throw new Error(`Error updating support ticket: ${error.message}`);
    }
  }

  static async deleteSupportTicket(id) {
    try {
      return await prisma.supportTicket.delete({
        where: { id },
      });
    } catch (error) {
      throw new Error(`Error deleting support ticket: ${error.message}`);
    }
  }

  // FAQ Methods
  static async createFAQ(data) {
    try {
      return await prisma.fAQ.create({
        data: {
          category: data.category,
          question: data.question,
          answer: data.answer,
          order: data.order || 0,
        },
      });
    } catch (error) {
      throw new Error(`Error creating FAQ: ${error.message}`);
    }
  }

  static async getFAQs(category = null) {
    try {
      const where = category ? { category } : {};
      return await prisma.fAQ.findMany({
        where,
        orderBy: [{ category: 'asc' }, { order: 'asc' }],
      });
    } catch (error) {
      throw new Error(`Error fetching FAQs: ${error.message}`);
    }
  }

  static async getFAQById(id) {
    try {
      return await prisma.fAQ.findUnique({
        where: { id },
      });
    } catch (error) {
      throw new Error(`Error fetching FAQ: ${error.message}`);
    }
  }

  static async updateFAQ(id, data) {
    try {
      return await prisma.fAQ.update({
        where: { id },
        data: {
          category: data.category || undefined,
          question: data.question || undefined,
          answer: data.answer || undefined,
          order: data.order || undefined,
        },
      });
    } catch (error) {
      throw new Error(`Error updating FAQ: ${error.message}`);
    }
  }

  static async deleteFAQ(id) {
    try {
      return await prisma.fAQ.delete({
        where: { id },
      });
    } catch (error) {
      throw new Error(`Error deleting FAQ: ${error.message}`);
    }
  }

  static async getFAQCategories() {
    try {
      const faqs = await prisma.fAQ.findMany({
        select: { category: true },
        distinct: ['category'],
      });
      return faqs.map((f) => f.category);
    } catch (error) {
      throw new Error(`Error fetching FAQ categories: ${error.message}`);
    }
  }
}

module.exports = SupportService;