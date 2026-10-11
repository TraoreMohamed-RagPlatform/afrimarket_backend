const RecaptchaService = require('../utils/recaptchaService');
const { initializeFirebase } = require('../utils/firebaseService');

/**
 * Vérifie que la requête vient d'un vrai client AfriMarket (pas d'un robot)
 * avant une action sensible : connexion, inscription, formulaire de contact.
 *
 * Deux preuves acceptées, une seule suffit :
 * - application mobile : jeton Firebase App Check dans l'en-tête
 *   `X-Firebase-AppCheck` (attestation Play Integrity / App Attest). Jeton à
 *   usage unique : il est « consommé », un rejeu est refusé ;
 * - site web : jeton reCAPTCHA v3 dans `recaptchaToken`.
 *
 * Fermé par défaut : sans preuve valide, la requête est refusée (403).
 */
const APP_CHECK_HEADER = 'x-firebase-appcheck';
const MAX_APP_CHECK_TOKEN_LENGTH = 4096;

/** Identifiants d'applications Firebase autorisés (APP_CHECK_APP_IDS). */
const allowedAppIds = (env = process.env) =>
  (env.APP_CHECK_APP_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

/**
 * Vérification App Check par défaut (Firebase Admin SDK).
 * Renvoie `{ appId, alreadyConsumed }` ou lève une erreur si le jeton est invalide.
 */
const verifyWithFirebase = (token) => {
  const app = initializeFirebase();
  if (!app) {
    throw new Error('Firebase Admin SDK indisponible');
  }
  // Chargé ici : le module n'est utile que si une application mobile se présente.
  const { getAppCheck } = require('firebase-admin/app-check');
  return getAppCheck(app).verifyToken(token, { consume: true });
};

const createVerifyClient = ({
  verifyAppCheck = verifyWithFirebase,
  verifyRecaptcha = (token) => RecaptchaService.verifyToken(token),
  // Lu à chaque requête : la configuration (.env) est chargée au démarrage.
  getAppIds = () => allowedAppIds(),
} = {}) => {
  const appCheckIsValid = async (token) => {
    if (token.length === 0 || token.length > MAX_APP_CHECK_TOKEN_LENGTH) {
      return false;
    }
    try {
      const result = await verifyAppCheck(token);
      if (result.alreadyConsumed) {
        return false;
      }
      const appIds = getAppIds();
      return appIds.length === 0 || appIds.includes(result.appId);
    } catch {
      return false;
    }
  };

  const recaptchaIsValid = async (token) => {
    const result = await verifyRecaptcha(token);
    return result.success === true;
  };

  return async (req, res, next) => {
    try {
      const appCheckToken = req.get(APP_CHECK_HEADER);
      // Chaque branche effectue une vérification complète ; aucune ne laisse
      // passer une requête sans preuve.
      const verified =
        typeof appCheckToken === 'string'
          ? await appCheckIsValid(appCheckToken)
          : await recaptchaIsValid(req.body?.recaptchaToken);

      if (!verified) {
        return res.status(403).json({ error: 'Client verification failed' });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
};

const verifyClient = createVerifyClient();

module.exports = {
  APP_CHECK_HEADER,
  MAX_APP_CHECK_TOKEN_LENGTH,
  allowedAppIds,
  createVerifyClient,
  verifyClient,
};
