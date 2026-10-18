const { PrismaClient } = require('@prisma/client');
const { sendEmail } = require('../utils/emailService');
const { sendServerError } = require('../utils/httpErrors');
const { escapeHtml } = require('../utils/html');
const { sanitizeForLog } = require('../utils/logSafe');

const prisma = new PrismaClient();

// ========================================
// Create Listing
// ========================================
const createListing = async (req, res) => {
  try {
    const { title, description, price, categoryId } = req.body;
    const userId = req.user.userId;

    // Validation
    if (!title || !description || !price || !categoryId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const listing = await prisma.listing.create({
      data: {
        title: req.body.title,
        description: req.body.description,
        price: req.body.price,
        categoryId: req.body.categoryId,
        userId: userId,
        status: 'ACTIVE',
        condition: req.body.condition || 'NEW',
      },
    });

    res.status(201).json({
      message: 'Listing created successfully',
      listing,
    });
  } catch (error) {
    sendServerError(res, error, 'listingController.createListing');
  }
};

// ========================================
// Get All Listings
// ========================================
const getListings = async (req, res) => {
  try {
    const { page = 1, limit = 10, categoryId, search } = req.query;
    const skip = (page - 1) * limit;

    const where = {
      status: 'ACTIVE',
    };

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const listings = await prisma.listing.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatar: true,
            avgRating: true,
          },
        },
        category: true,
        images: true,
      },
      skip: parseInt(skip),
      take: parseInt(limit),
      orderBy: {
        createdAt: 'desc',
      },
    });

    const total = await prisma.listing.count({ where });

    res.json({
      listings,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    sendServerError(res, error, 'listingController.getListings');
  }
};

// ========================================
// Get Single Listing
// ========================================

/**
 * Vendeur tel qu'il apparaît publiquement dans une annonce.
 *
 * Sécurité (OWASP API3:2023, exposition excessive de données) : le numéro
 * de téléphone n'est JAMAIS renvoyé ici, car cette route est publique et
 * permettrait à un robot de récupérer les numéros de tous les vendeurs.
 * Seul l'indicateur `canCall` est exposé ; le numéro s'obtient via
 * `GET /api/listings/:id/contact` (connexion requise, débit limité).
 */
const toPublicSeller = ({ phone, verifiedPhone, ...seller }) => ({
  ...seller,
  canCall: Boolean(phone && verifiedPhone),
});

const getListing = async (req, res) => {
  try {
    const { id } = req.params;

    const listing = await prisma.listing.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatar: true,
            avgRating: true,
            // Lus uniquement pour calculer `canCall`, jamais renvoyés.
            phone: true,
            verifiedPhone: true,
          },
        },
        category: true,
        images: true,
        ratings: true,
      },
    });

    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    res.json({ listing: { ...listing, user: toPublicSeller(listing.user) } });
  } catch (error) {
    sendServerError(res, error, 'listingController.getListing');
  }
};

// ========================================
// Get Seller Contact (Protected)
// ========================================

/**
 * Numéro du vendeur, pour le bouton « Appeler » / WhatsApp.
 *
 * Conditions (fermé par défaut) : utilisateur connecté (route protégée),
 * annonce active et non vendue, vendeur actif, numéro VÉRIFIÉ par code
 * SMS. Sinon : 404, sans préciser la raison (pas d'énumération).
 * La réponse n'est jamais mise en cache ; chaque consultation est
 * journalisée sans le numéro.
 */
const getListingContact = async (req, res) => {
  try {
    const { id } = req.params;

    const listing = await prisma.listing.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        isSold: true,
        user: { select: { phone: true, verifiedPhone: true, status: true } },
      },
    });

    const seller = listing?.user;
    const available =
      listing &&
      listing.status === 'ACTIVE' &&
      !listing.isSold &&
      seller &&
      seller.status === 'ACTIVE' &&
      seller.verifiedPhone === true &&
      typeof seller.phone === 'string' &&
      seller.phone.length > 0;

    res.set('Cache-Control', 'no-store');

    if (!available) {
      return res.status(404).json({ error: 'Contact not available' });
    }

    console.info(
      `[contact] annonce=${sanitizeForLog(id)} consultée par=${sanitizeForLog(req.user.userId)}`,
    );
    res.json({ phone: seller.phone });
  } catch (error) {
    sendServerError(res, error, 'listingController.getListingContact');
  }
};

// ========================================
// Update Listing
// ========================================
const updateListing = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const { title, description, price, categoryId, status } = req.body;

    // Vérifier que l'utilisateur est propriétaire
    const listing = await prisma.listing.findUnique({
      where: { id },
      include: { user: true }
    });

    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    if (listing.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const updatedListing = await prisma.listing.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(description && { description }),
        ...(price && { price: parseFloat(price) }),
        ...(categoryId && { categoryId }),
        ...(status && { status }),
      },
    });

    // ✅ ENVOYER EMAIL SI ANNONCE MISE À JOUR
    if (title || description || price) {
      try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const updatedFields = [];
        if (title) updatedFields.push(`Titre: ${title}`);
        if (description) updatedFields.push(`Description mise à jour`);
        if (price) updatedFields.push(`Nouveau prix: ${price} DH`);

        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #9C27B0; color: white; padding: 20px; text-align: center; border-radius: 5px;">
              <h1>🔄 Annonce mise à jour</h1>
            </div>
            <div style="padding: 20px; background: #f9f9f9; margin: 20px 0; border-left: 4px solid #9C27B0;">
              <p>Bonjour ${escapeHtml(user.username)},</p>
              <p>Votre annonce <strong>${escapeHtml(listing.title)}</strong> a été mise à jour avec succès.</p>
              <p><strong>Modifications:</strong></p>
              <ul>
                ${updatedFields.map((field) => `<li>${escapeHtml(field)}</li>`).join('')}
              </ul>
              <p>Les acheteurs verront les changements immédiatement.</p>
            </div>
          </div>
        `;

        await sendEmail(
          user.email,
          `🔄 Votre annonce "${listing.title}" a été mise à jour`,
          html
        );
      } catch (emailError) {
        console.warn('⚠️ Email de mise à jour non envoyé:', emailError.message);
      }
    }

    res.json({
      message: 'Listing updated successfully',
      listing: updatedListing,
    });
  } catch (error) {
    sendServerError(res, error, 'listingController.updateListing');
  }
};

// ========================================
// Delete Listing
// ========================================
const deleteListing = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Vérifier que l'utilisateur est propriétaire
    const listing = await prisma.listing.findUnique({
      where: { id },
    });

    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    if (listing.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await prisma.listing.delete({
      where: { id },
    });

    res.json({ message: 'Listing deleted successfully' });
  } catch (error) {
    sendServerError(res, error, 'listingController.deleteListing');
  }
};

// ========================================
// Mark Listing as Sold
// ========================================
const markAsSold = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const { buyerName } = req.body;

    // Vérifier que l'utilisateur est propriétaire
    const listing = await prisma.listing.findUnique({
      where: { id },
      include: { user: true }
    });

    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    if (listing.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (listing.status === 'SOLD') {
      return res.status(400).json({ error: 'Cette annonce est déjà marquée comme vendue' });
    }

    // Marquer comme vendue
    const soldListing = await prisma.listing.update({
      where: { id },
      data: { status: 'SOLD', isSold: true },
    });

    // ✅ ENVOYER EMAIL AU VENDEUR
    try {
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #FF9800; color: white; padding: 20px; text-align: center; border-radius: 5px;">
            <h1>🎉 Annonce vendue!</h1>
          </div>
          <div style="padding: 20px; background: #f9f9f9; margin: 20px 0; border-left: 4px solid #FF9800;">
            <p>Félicitations ${escapeHtml(listing.user.username)}!</p>
            <p>Votre annonce <strong>${escapeHtml(listing.title)}</strong> a été vendue avec succès! 🎉</p>
            <p><strong>Informations:</strong></p>
            <ul>
              <li>Prix de vente: <strong>${escapeHtml(listing.price)} DH</strong></li>
              <li>Acheteur: <strong>${escapeHtml(buyerName || 'Non spécifié')}</strong></li>
              <li>Date de vente: ${new Date().toLocaleDateString('fr-FR')}</li>
            </ul>
            <p>Merci d'avoir utilisé AfriMarket. Bonne transaction! 🤝</p>
          </div>
          <div style="text-align: center; font-size: 12px; color: #999; margin-top: 20px; border-top: 1px solid #ddd; padding-top: 10px;">
            <p>© AfriMarket 2026 | Marketplace de confiance</p>
          </div>
        </div>
      `;

      await sendEmail(
        listing.user.email,
        `🎉 Votre annonce "${listing.title}" a été vendue!`,
        html
      );
    } catch (emailError) {
      console.warn('⚠️ Email de vente non envoyé:', emailError.message);
    }

    res.json({
      message: 'Listing marked as sold successfully',
      listing: soldListing,
    });
  } catch (error) {
    sendServerError(res, error, 'listingController.markAsSold');
  }
};

module.exports = {
  createListing,
  getListings,
  getListing,
  getListingContact,
  updateListing,
  deleteListing,
  markAsSold,
};