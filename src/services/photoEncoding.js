const sharp = require('sharp');

/**
 * Réencodage commun des photos envoyées (annonces, messages).
 *
 * - le contenu réel est décodé par sharp : un faux « .jpg » est refusé ;
 * - l'orientation EXIF est appliquée, puis TOUTES les métadonnées sont
 *   retirées (dont la position GPS, qui révélerait le domicile) ;
 * - la taille est ramenée à 1600 px maximum, en JPEG.
 */

/** Côté le plus long d'une photo enregistrée (suffisant pour un écran plein). */
const MAX_PHOTO_SIDE = 1600;
const JPEG_QUALITY = 80;
// Refuse les images démesurées (bombe de décompression).
const MAX_INPUT_PIXELS = 40_000_000;

/**
 * @param {string} input Fichier temporaire (déjà validé par multer).
 * @param {string} destination Chemin final (choisi par le serveur).
 * @returns {Promise<{ width: number, height: number }>} dimensions enregistrées.
 * @throws si le fichier n'est pas une image lisible.
 */
const encodeJpeg = async (input, destination) => {
  const info = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
    .rotate()
    .resize({
      width: MAX_PHOTO_SIDE,
      height: MAX_PHOTO_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toFile(destination);
  return { width: info.width, height: info.height };
};

module.exports = { MAX_PHOTO_SIDE, encodeJpeg };
