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
 *
 * @returns {Promise<{ listing: object } | { status: number, body: object }>}
 *   l'annonce, ou la réponse d'erreur à envoyer (404 / 403 ; 409 si elle
 *   est vendue : ses photos ne changent plus).
 */
const findOwnListing = async (req) => {
  const listing = await prisma.listing.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      userId: true,
      status: true,
      isSold: true,
      images: { select: { id: true, publicId: true, position: true }, orderBy: PHOTO_ORDER },
    },
  });

  if (!listing) {
    return { status: 404, body: { error: 'Listing not found' } };
  }
  if (listing.userId !== req.user.userId) {
    return { status: 403, body: { error: 'Unauthorized' } };
  }
  if (listing.isSold === true || listing.status === 'SOLD') {
    return { status: 409, body: { error: 'Annonce vendue : plus modifiable', code: 'LISTING_SOLD' } };
  }
  return { listing };
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
 * Ajout des photos. Renvoie la réponse à envoyer ; ne touche pas aux
 * fichiers temporaires (supprimés par l'appelant).
 */
const addPhotos = async (req, files) => {
  if (files.length === 0) {
    return { status: 400, body: { error: 'No image provided' } };
  }

  const owned = await findOwnListing(req);
  if (!owned.listing) return owned;
  const { listing } = owned;

  if (listing.images.length + files.length > MAX_LISTING_PHOTOS) {
    return {
      status: 400,
      body: {
        error: 'Too many photos',
        max: MAX_LISTING_PHOTOS,
        remaining: Math.max(0, MAX_LISTING_PHOTOS - listing.images.length),
      },
    };
  }

  const saved = [];
  for (const file of files) {
    try {
      saved.push(await savePhoto(tempUploadPath(file)));
    } catch {
      await removePhotos(saved.map((photo) => photo.name));
      return { status: 400, body: { error: 'Invalid image' } };
    }
  }

  const nextPosition = listing.images.length === 0
    ? 0
    : Math.max(...listing.images.map((image) => image.position)) + 1;

  try {
    const images = await prisma.$transaction(
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
    return { status: 201, body: { images } };
  } catch (error) {
    await removePhotos(saved.map((photo) => photo.name));
    throw error;
  }
};

/**
 * Ajoute des photos à la fin de l'annonce (10 au total au plus).
 * Chaque photo est réencodée (voir services/listingPhotos.js). Les fichiers
 * temporaires sont supprimés AVANT la réponse, dans tous les cas.
 */
const uploadListingImages = async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  let result;
  try {
    result = await addPhotos(req, files);
  } catch (error) {
    result = { error };
  }

  await removeTempUploads(...files);

  if (result.error instanceof Error) {
    return sendServerError(res, result.error, 'listingImageController.uploadListingImages');
  }
  return res.status(result.status).json(result.body);
};

// ========================================
// DELETE /api/listings/:id/images/:imageId
// ========================================

const deleteListingImage = async (req, res) => {
  try {
    const owned = await findOwnListing(req);
    if (!owned.listing) return res.status(owned.status).json(owned.body);
    const { listing } = owned;

    const image = listing.images.find((item) => item.id === req.params.imageId);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Une annonce publiée garde au moins une photo (la photo du fil).
    if (listing.status !== 'INACTIVE' && listing.images.length <= 1) {
      return res.status(409).json({ error: 'Une annonce publiée garde au moins une photo', code: 'LAST_PHOTO' });
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
    const owned = await findOwnListing(req);
    if (!owned.listing) return res.status(owned.status).json(owned.body);
    const { listing } = owned;

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
