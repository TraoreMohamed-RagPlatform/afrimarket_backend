const { PrismaClient } = require('@prisma/client');
const { sendServerError } = require('../utils/httpErrors');
const { tempUploadPath, removeTempUploads } = require('../middleware/uploadMiddleware');
const { savePhoto, removePhotos } = require('../services/listingPhotos');
const { MAX_LISTING_PHOTOS } = require('../config/listingOptions');

const prisma = new PrismaClient();

const IMAGE_SELECT = { id: true, url: true, position: true };
const PHOTO_ORDER = [{ position: 'asc' }, { createdAt: 'asc' }];

/**
 * Annonce de l'utilisateur, avec ses photos dans l'ordre.
 * Répond 404 / 403 elle-même et renvoie null dans ce cas.
 */
const findOwnListing = async (req, res) => {
  const listing = await prisma.listing.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      userId: true,
      images: { select: { id: true, publicId: true, position: true }, orderBy: PHOTO_ORDER },
    },
  });

  if (!listing) {
    res.status(404).json({ error: 'Listing not found' });
    return null;
  }
  if (listing.userId !== req.user.userId) {
    res.status(403).json({ error: 'Unauthorized' });
    return null;
  }
  return listing;
};

/** Renumérote les photos restantes : 0, 1, 2... dans l'ordre donné. */
const savePositions = (imageIds) =>
  prisma.$transaction(
    imageIds.map((imageId, position) =>
      prisma.image.update({ where: { id: imageId }, data: { position }, select: IMAGE_SELECT }),
    ),
  );

// ========================================
// POST /api/listings/:id/images
// ========================================

/**
 * Ajoute des photos à la fin de l'annonce (10 au total au plus).
 * Chaque photo est réencodée (voir services/listingPhotos.js) ; les fichiers
 * temporaires sont toujours supprimés.
 */
const uploadListingImages = async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  const saved = [];

  try {
    if (files.length === 0) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const listing = await findOwnListing(req, res);
    if (!listing) return undefined;

    if (listing.images.length + files.length > MAX_LISTING_PHOTOS) {
      return res.status(400).json({
        error: 'Too many photos',
        max: MAX_LISTING_PHOTOS,
        remaining: Math.max(0, MAX_LISTING_PHOTOS - listing.images.length),
      });
    }

    for (const file of files) {
      try {
        saved.push(await savePhoto(tempUploadPath(file)));
      } catch {
        await removePhotos(saved.map((photo) => photo.name));
        return res.status(400).json({ error: 'Invalid image' });
      }
    }

    const nextPosition = listing.images.length === 0
      ? 0
      : Math.max(...listing.images.map((image) => image.position)) + 1;

    let images;
    try {
      images = await prisma.$transaction(
        saved.map((photo, index) =>
          prisma.image.create({
            data: {
              listingId: listing.id,
              url: photo.url,
              publicId: photo.name,
              position: nextPosition + index,
            },
            select: IMAGE_SELECT,
          }),
        ),
      );
    } catch (error) {
      await removePhotos(saved.map((photo) => photo.name));
      throw error;
    }

    return res.status(201).json({ images });
  } catch (error) {
    return sendServerError(res, error, 'listingImageController.uploadListingImages');
  } finally {
    await removeTempUploads(...files);
  }
};

// ========================================
// DELETE /api/listings/:id/images/:imageId
// ========================================

const deleteListingImage = async (req, res) => {
  try {
    const listing = await findOwnListing(req, res);
    if (!listing) return undefined;

    const image = listing.images.find((item) => item.id === req.params.imageId);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    await prisma.image.delete({ where: { id: image.id } });
    await removePhotos([image.publicId]);

    const images = await savePositions(
      listing.images.filter((item) => item.id !== image.id).map((item) => item.id),
    );
    return res.json({ images });
  } catch (error) {
    return sendServerError(res, error, 'listingImageController.deleteListingImage');
  }
};

// ========================================
// PUT /api/listings/:id/images/order
// ========================================

/**
 * Nouvel ordre des photos. `imageIds` doit contenir exactement les photos
 * de l'annonce, chacune une fois ; la première devient la photo principale.
 */
const reorderListingImages = async (req, res) => {
  try {
    const listing = await findOwnListing(req, res);
    if (!listing) return undefined;

    const { imageIds } = req.body;
    const current = new Set(listing.images.map((image) => image.id));
    const sameSet =
      imageIds.length === current.size &&
      new Set(imageIds).size === imageIds.length &&
      imageIds.every((imageId) => current.has(imageId));

    if (!sameSet) {
      return res.status(400).json({ error: 'imageIds must list every photo of the listing once' });
    }

    const images = await savePositions(imageIds);
    return res.json({ images });
  } catch (error) {
    return sendServerError(res, error, 'listingImageController.reorderListingImages');
  }
};

module.exports = {
  uploadListingImages,
  deleteListingImage,
  reorderListingImages,
};
