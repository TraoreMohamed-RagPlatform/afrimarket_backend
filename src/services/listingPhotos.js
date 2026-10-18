const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const sharp = require('sharp');

/**
 * Photos des annonces : seul dossier de « uploads » servi publiquement.
 *
 * Les pièces d'identité (uploads/identity) et les fichiers temporaires
 * (uploads/temp) ne sont JAMAIS servis : app.js ne publie que ce dossier.
 */
const LISTING_PHOTOS_DIR = path.resolve(__dirname, '../../uploads/listings');

/** Préfixe des adresses renvoyées aux clients (relatif au serveur). */
const LISTING_PHOTOS_URL_PREFIX = '/uploads/listings';

// Les photos sont toujours réencodées en « <uuid v4>.jpg » par le serveur.
const STORED_PHOTO_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/;

/** Côté le plus long d'une photo enregistrée (suffisant pour un écran plein). */
const MAX_PHOTO_SIDE = 1600;
const JPEG_QUALITY = 80;
// Refuse les images démesurées (bombe de décompression).
const MAX_INPUT_PIXELS = 40_000_000;

fs.mkdirSync(LISTING_PHOTOS_DIR, { recursive: true });

/**
 * Chemin d'une photo enregistrée, à partir de son nom (stocké en `publicId`).
 * Le nom est revérifié : jamais de « .. » ni de séparateur (CWE-22).
 *
 * @param {unknown} name
 * @returns {string | null}
 */
const storedPhotoPath = (name) => {
  if (typeof name !== 'string' || !STORED_PHOTO_NAME.test(name)) {
    return null;
  }
  const resolved = path.resolve(LISTING_PHOTOS_DIR, name);
  return resolved.startsWith(LISTING_PHOTOS_DIR + path.sep) ? resolved : null;
};

/**
 * Réencode une photo envoyée (fichier temporaire) en JPEG.
 *
 * - le contenu réel est décodé par sharp : un faux « .jpg » est refusé ;
 * - l'orientation EXIF est appliquée, puis TOUTES les métadonnées sont
 *   retirées (dont la position GPS, qui révélerait le domicile du vendeur) ;
 * - la taille est ramenée à 1600 px maximum.
 *
 * @param {string} tempPath Fichier temporaire (déjà validé par multer).
 * @returns {Promise<{ name: string, url: string }>}
 * @throws si le fichier n'est pas une image lisible.
 */
const savePhoto = async (tempPath) => {
  const name = `${randomUUID()}.jpg`;
  const destination = storedPhotoPath(name);

  await sharp(tempPath, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
    .rotate()
    .resize({
      width: MAX_PHOTO_SIDE,
      height: MAX_PHOTO_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toFile(destination);

  return { name, url: `${LISTING_PHOTOS_URL_PREFIX}/${name}` };
};

/**
 * Supprime des photos enregistrées. Ne lève jamais d'erreur.
 *
 * @param {Array<string | null | undefined>} names Valeurs de `publicId`.
 */
const removePhotos = (names) =>
  Promise.all(
    names.map(async (name) => {
      const file = storedPhotoPath(name);
      if (!file) return;
      try {
        await fs.promises.unlink(file);
      } catch {
        // Déjà supprimée : rien à faire.
      }
    }),
  );

module.exports = {
  LISTING_PHOTOS_DIR,
  LISTING_PHOTOS_URL_PREFIX,
  storedPhotoPath,
  savePhoto,
  removePhotos,
};
