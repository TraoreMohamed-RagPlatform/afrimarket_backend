const fs = require('fs').promises;
const path = require('path');

/**
 * Emplacement des fichiers KYC (pièces d'identité, selfies).
 *
 * Règle de sécurité : un chemin envoyé par le client n'est JAMAIS utilisé tel
 * quel. Seul le nom de fichier est repris, vérifié, puis le chemin est
 * reconstruit dans le dossier de l'utilisateur authentifié. Cela empêche :
 *  - de lire un fichier du serveur (« ../../.env ») et de l'envoyer au
 *    fournisseur de reconnaissance faciale (CWE-22) ;
 *  - d'utiliser la pièce d'identité d'un autre utilisateur (IDOR).
 */
const KYC_UPLOAD_ROOT = path.resolve(__dirname, '../../uploads/identity');

// Préfixe des chemins renvoyés au client et stockés en base (format POSIX,
// identique sous Windows et Linux).
const KYC_PUBLIC_PREFIX = 'uploads/identity';

const KYC_FILE_KIND = Object.freeze({
  DOCUMENT: 'documents',
  SELFIE: 'selfie',
});

// Les fichiers sont toujours enregistrés sous « <uuid v4>.png » par le serveur.
const STORED_FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/;
// Identifiant utilisateur (cuid / uuid) : jamais de séparateur ni de « .. ».
const SAFE_USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

const isKnownKind = (kind) => Object.values(KYC_FILE_KIND).includes(kind);

const userKindDir = (userId, kind) => {
  if (typeof userId !== 'string' || !SAFE_USER_ID.test(userId) || !isKnownKind(kind)) {
    throw new Error('Invalid KYC storage location');
  }
  return path.join(KYC_UPLOAD_ROOT, userId, kind);
};

/**
 * Dossier où ranger un nouveau fichier KYC de l'utilisateur.
 */
const getKycDir = (userId, kind) => userKindDir(userId, kind);

/**
 * Chemin public (stocké en base, renvoyé au client) d'un fichier KYC.
 */
const toPublicPath = (userId, kind, fileName) =>
  [KYC_PUBLIC_PREFIX, userId, kind, fileName].join('/');

/**
 * Retrouve un fichier KYC de l'utilisateur à partir de la valeur envoyée par
 * le client (le chemin renvoyé lors de l'upload).
 *
 * @param {string} userId Utilisateur authentifié (jamais le client).
 * @param {string} kind Une valeur de KYC_FILE_KIND.
 * @param {unknown} clientValue Chemin envoyé par le client.
 * @returns {Promise<{ absolutePath: string, publicPath: string } | null>}
 *   null si la valeur est invalide ou si le fichier n'existe pas.
 */
const resolveKycFile = async (userId, kind, clientValue) => {
  if (typeof clientValue !== 'string' || clientValue.length > 512) {
    return null;
  }

  // On ne garde que le dernier segment (séparateurs « / » et « \ »).
  const fileName = clientValue.split(/[\\/]/).pop();
  if (!STORED_FILE_NAME.test(fileName)) {
    return null;
  }

  const dir = userKindDir(userId, kind);
  const absolutePath = path.resolve(dir, fileName);

  // Défense en profondeur : le chemin final doit rester dans le dossier attendu.
  if (!absolutePath.startsWith(dir + path.sep)) {
    return null;
  }

  try {
    const stats = await fs.stat(absolutePath);
    if (!stats.isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  return { absolutePath, publicPath: toPublicPath(userId, kind, fileName) };
};

module.exports = {
  KYC_UPLOAD_ROOT,
  KYC_FILE_KIND,
  getKycDir,
  toPublicPath,
  resolveKycFile,
};
