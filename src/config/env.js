/**
 * Configuration de l'application, lue et vérifiée une seule fois au démarrage.
 *
 * Fermé par défaut : si une valeur indispensable manque ou est dangereuse
 * (secret trop court, valeur d'exemple), le serveur refuse de démarrer
 * plutôt que de tourner dans un état non sûr.
 */

const MIN_JWT_SECRET_LENGTH = 32;
const PLACEHOLDER_PATTERN = /your|votre|change|example|secret_here|placeholder|xxx/i;

const splitList = (value) =>
  (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/** Origine d'une URL http(s), ou null si l'URL est invalide. */
const toOrigin = (url) => {
  try {
    const { protocol, origin } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? origin : null;
  } catch {
    return null;
  }
};

/**
 * Valide les variables d'environnement et renvoie une configuration typée.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ ok: true, config: object } | { ok: false, errors: string[] }}
 */
const validateEnv = (env = process.env) => {
  const errors = [];

  const jwtSecret = env.JWT_SECRET || '';
  if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    errors.push(`JWT_SECRET doit contenir au moins ${MIN_JWT_SECRET_LENGTH} caractères.`);
  } else if (PLACEHOLDER_PATTERN.test(jwtSecret)) {
    errors.push('JWT_SECRET contient une valeur d’exemple : générez un secret aléatoire.');
  }

  if (!env.DATABASE_URL) {
    errors.push('DATABASE_URL est obligatoire.');
  }

  const port = Number.parseInt(env.PORT || '3000', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('PORT doit être un entier entre 1 et 65535.');
  }

  // Origines web autorisées (CORS). Les applications mobiles n'envoient pas
  // d'en-tête Origin et ne sont donc pas concernées.
  const corsOrigins = splitList(env.CORS_ORIGINS);
  if (corsOrigins.length === 0) {
    // Repli : origine (schéma + hôte + port) des URL déjà configurées,
    // ex. « http://localhost:5173/admin » → « http://localhost:5173 ».
    for (const url of splitList([env.CLIENT_URL, env.ADMIN_DASHBOARD_URL].join(','))) {
      const origin = toOrigin(url);
      if (origin && !corsOrigins.includes(origin)) corsOrigins.push(origin);
    }
  }
  const invalidOrigin = corsOrigins.find((origin) => !/^https?:\/\/[^/\s]+$/.test(origin));
  if (invalidOrigin) {
    errors.push(`Origine CORS invalide : « ${invalidOrigin} » (format attendu : https://domaine).`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    config: {
      nodeEnv: env.NODE_ENV || 'development',
      isProduction: env.NODE_ENV === 'production',
      port,
      host: env.HOST || '127.0.0.1',
      corsOrigins,
    },
  };
};

module.exports = { validateEnv, MIN_JWT_SECRET_LENGTH };
