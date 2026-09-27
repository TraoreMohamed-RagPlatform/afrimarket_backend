// src/routes/support.js
const express = require('express');
const router = express.Router();
const SupportController = require('../controllers/supportController');
const authMiddleware = require('../middleware/authMiddleware');

// Contact Form Routes
router.post('/contact-form', SupportController.createContactForm);
router.get('/contact-forms', SupportController.getContactForms);
router.get('/contact-form/:id', SupportController.getContactFormById);
router.put('/contact-form/:id', SupportController.updateContactForm);
router.delete('/contact-form/:id', SupportController.deleteContactForm);

// Support Ticket Routes (require authentication)
router.post('/ticket', authMiddleware, SupportController.createSupportTicket);
router.get('/tickets', SupportController.getSupportTickets);
router.get('/ticket/:id', SupportController.getSupportTicketById);
router.put('/ticket/:id', authMiddleware, SupportController.updateSupportTicket);
router.delete('/ticket/:id', authMiddleware, SupportController.deleteSupportTicket);

// FAQ Routes (public)
router.get('/faqs', SupportController.getFAQs);
router.get('/faq-categories', SupportController.getFAQCategories);
router.get('/faq/:id', SupportController.getFAQById);

// FAQ Admin Routes
router.post('/faq', SupportController.createFAQ);
router.put('/faq/:id', SupportController.updateFAQ);
router.delete('/faq/:id', SupportController.deleteFAQ);

module.exports = router;