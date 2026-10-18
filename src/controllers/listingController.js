const { PrismaClient } = require('@prisma/client');
const { sendEmail } = require('../utils/emailService');
const { sendServerError } = require('../utils/httpErrors');
const { escapeHtml } = require('../utils/html');
const { sanitizeForLog } = require('../utils/logSafe');
const { DEFAULT_CITY, DEFAULT_DELIVERY_MODE } = require('../config/listingOptions');
const { publicResponseTime } = require('../services/responseTime');
const { removePhotos } = require('../services/listingPhotos');

const prisma = new PrismaClient();

/** Ordre d'affichage des photos : principale d'abord. */
const PHOTO_ORDER = [{ position: 'asc' }, { createdAt: 'asc' }];

// ========================================
// Create Listing
// ========================================
const createListing = async (req, res) => {
  try {
    const { title, description, price, categoryId } = req.body;
    const userId = req.user.userId;

    // Validation
    if (!title || !description || price === undefined || price === null || !categoryId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { city, district, isNegotiable, deliveryMode } = req.body;

    const listing = await prisma.listing.create({
      data: {
        title,
        description,
        price: Number(price),
        categoryId,
        userId: userId,
        status: 'ACTIVE',
        condition: req.body.condition || 'NEW',
        city: city || DEFAULT_CITY,
        district: district || null,
        isNegotiable: isNegotiable === true,
        deliveryMode: deliveryMode || DEFAULT_DELIVERY_MODE,
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
        images: { orderBy: PHOTO_ORDER },
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
 * Le vendeur accepte-t-il d'être appelé ? Trois conditions : un numéro,
 * VÉRIFIÉ par code SMS, et son consentement explicite (paramètre
 * « Afficher mon numéro », désactivé par défaut).
 */
const sellerAcceptsCalls = (seller) =>
  Boolean(
    seller &&
      typeof seller.phone === 'string' &&
      seller.phone.length > 0 &&
      seller.verifiedPhone === true &&
      seller.settings?.showPhone === true,
  );

/**
 * Vendeur tel qu'il apparaît publiquement dans une annonce.
 *
 * Sécurité (OWASP API3:2023, exposition excessive de données) : le numéro
 * de téléphone n'est JAMAIS renvoyé ici, car cette route est publique et
 * permettrait à un robot de récupérer les numéros de tous les vendeurs.
 * Seuls les indicateurs `canCall` / `canWhatsapp` sont exposés ; le numéro
 * s'obtient via `GET /api/listings/:id/contact` (connexion requise, débit
 * limité).
 */
const toPublicSeller = (seller) => {
  const {
    phone: _phone,
    verifiedPhone: _verifiedPhone,
    settings,
    responseTimeMinutes,
    responseSampleCount,
    ...rest
  } = seller;
  const canCall = sellerAcceptsCalls(seller);
  return {
    ...rest,
    responseTimeMinutes: publicResponseTime({ responseTimeMinutes, responseSampleCount }),
    canCall,
    canWhatsapp: canCall && settings?.whatsappEnabled === true,
  };
};

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
            totalRatings: true,
            isIdentityVerified: true,
            // Ancienneté : « Membre depuis 2024 ».
            createdAt: true,
            responseTimeMinutes: true,
            responseSampleCount: true,
            // Lus uniquement pour calculer `canCall`, jamais renvoyés.
            phone: true,
            verifiedPhone: true,
            settings: { select: { showPhone: true, whatsappEnabled: true } },
          },
        },
        category: true,
        images: { orderBy: PHOTO_ORDER },
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
 * SMS et consentement du vendeur (« Afficher mon numéro »).
 * Sinon : 404, sans préciser la raison (pas d'énumération).
 * `whatsapp` indique si le vendeur accepte aussi WhatsApp.
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
        user: {
          select: {
            phone: true,
            verifiedPhone: true,
            status: true,
            settings: { select: { showPhone: true, whatsappEnabled: true } },
          },
        },
      },
    });

    const seller = listing?.user;
    const available =
      listing &&
      listing.status === 'ACTIVE' &&
      !listing.isSold &&
      seller &&
      seller.status === 'ACTIVE' &&
      sellerAcceptsCalls(seller);

    res.set('Cache-Control', 'no-store');

    if (!available) {
      return res.status(404).json({ error: 'Contact not available' });
    }

    console.info(
      `[contact] annonce=${sanitizeForLog(id)} consultée par=${sanitizeForLog(req.user.userId)}`,
    );
    res.json({
      phone: seller.phone,
      whatsapp: seller.settings.whatsappEnabled === true,
    });
  } catch (error) {
    sendServerError(res, error, 'listingController.getListingContact');
  }
};

// ========================================
// Similar Listings (Public)
// ========================================

const SIMILAR_DEFAULT_LIMIT = 12;
const SIMILAR_MAX_LIMIT = 20;

/** Champs d'une annonce dans une liste (même forme que le fil). */
const LISTING_CARD_SELECT = {
  id: true,
  title: true,
  price: true,
  previousPrice: true,
  isNegotiable: true,
  isSold: true,
  city: true,
  district: true,
  createdAt: true,
  images: { select: { url: true }, orderBy: PHOTO_ORDER, take: 1 },
};

/**
 * « Annonces similaires » : même catégorie, actives et non vendues,
 * celles du même quartier d'abord, puis les plus récentes.
 */
const getSimilarListings = async (req, res) => {
  try {
    const { id } = req.params;
    const requested = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(requested) && requested > 0
      ? Math.min(requested, SIMILAR_MAX_LIMIT)
      : SIMILAR_DEFAULT_LIMIT;

    const listing = await prisma.listing.findUnique({
      where: { id },
      select: { id: true, categoryId: true, city: true, district: true },
    });

    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    const base = {
      status: 'ACTIVE',
      isSold: false,
      categoryId: listing.categoryId,
    };
    const query = (where, take) =>
      prisma.listing.findMany({
        where: { ...base, ...where },
        select: LISTING_CARD_SELECT,
        orderBy: { createdAt: 'desc' },
        take,
      });

    const nearby = listing.district
      ? await query({ id: { not: id }, city: listing.city, district: listing.district }, limit)
      : [];

    const others = nearby.length < limit
      ? await query({ id: { notIn: [id, ...nearby.map((item) => item.id)] } }, limit - nearby.length)
      : [];

    res.json({ listings: [...nearby, ...others] });
  } catch (error) {
    sendServerError(res, error, 'listingController.getSimilarListings');
  }
};

// ========================================
// Update Listing
// ========================================

/**
 * Nouveau prix et ancien prix affiché (barré), comme Facebook Marketplace :
 * - baisse : l'ancien prix devient le prix actuel ;
 * - hausse : plus d'ancien prix (afficher « baisse » serait trompeur) ;
 * - inchangé : rien ne bouge.
 * L'ancien prix est toujours calculé par le serveur, jamais envoyé par le client.
 */
const priceChange = (listing, newPrice) => {
  if (newPrice < listing.price) {
    return { price: newPrice, previousPrice: listing.price };
  }
  if (newPrice > listing.price) {
    return { price: newPrice, previousPrice: null };
  }
  return {};
};

const updateListing = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const {
      title,
      description,
      price,
      categoryId,
      status,
      city,
      district,
      isNegotiable,
      deliveryMode,
    } = req.body;

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
        ...(price !== undefined && price !== null && priceChange(listing, parseFloat(price))),
        ...(categoryId && { categoryId }),
        ...(status && { status }),
        ...(city && { city }),
        // null retire le quartier.
        ...(district !== undefined && { district: district || null }),
        ...(typeof isNegotiable === 'boolean' && { isNegotiable }),
        ...(deliveryMode && { deliveryMode }),
      },
    });

    // ✅ ENVOYER EMAIL SI ANNONCE MISE À JOUR
    if (title || description || price !== undefined) {
      try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const updatedFields = [];
        if (title) updatedFields.push(`Titre: ${title}`);
        if (description) updatedFields.push(`Description mise à jour`);
        if (price !== undefined) updatedFields.push(`Nouveau prix: ${price} DH`);

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
      include: { images: { select: { publicId: true } } },
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

    // Les lignes Image sont supprimées en cascade ; les fichiers, ici.
    await removePhotos((listing.images ?? []).map((image) => image.publicId));

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
  getSimilarListings,
  updateListing,
  deleteListing,
  markAsSold,
};