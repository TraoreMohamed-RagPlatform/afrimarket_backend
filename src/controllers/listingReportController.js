const { PrismaClient } = require('@prisma/client');
const { sendServerError } = require('../utils/httpErrors');
const { sanitizeForLog } = require('../utils/logSafe');

const prisma = new PrismaClient();

// ========================================
// POST /api/listings/:id/report
// ========================================

/**
 * Signale une annonce à la modération (une fois par annonce et par personne).
 * Le motif est une valeur fixe (validée par la route) ; le détail est optionnel.
 */
const reportListing = async (req, res) => {
  try {
    const { id } = req.params;
    const reporterId = req.user.userId;
    const { reason, details } = req.body;

    const listing = await prisma.listing.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });

    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    if (listing.userId === reporterId) {
      return res.status(400).json({ error: 'You cannot report your own listing' });
    }

    try {
      const report = await prisma.listingReport.create({
        data: {
          listingId: listing.id,
          reporterId,
          reason,
          details: details || null,
        },
        select: { id: true, reason: true, status: true, createdAt: true },
      });

      console.info(
        `[report] annonce=${sanitizeForLog(id)} motif=${sanitizeForLog(reason)} par=${sanitizeForLog(reporterId)}`,
      );
      return res.status(201).json({ message: 'Report received', report });
    } catch (error) {
      // Contrainte unique (annonce, auteur) : déjà signalée par cette personne.
      if (error?.code === 'P2002') {
        return res.status(409).json({ error: 'Listing already reported' });
      }
      throw error;
    }
  } catch (error) {
    return sendServerError(res, error, 'listingReportController.reportListing');
  }
};

module.exports = { reportListing };
