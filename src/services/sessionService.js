const { createHash, randomBytes, randomUUID } = require('crypto');

const prisma = require('../lib/prisma');
const { ACCESS_TOKEN_TTL_SECONDS, generateAccessToken } = require('../utils/tokenUtils');

/**
 * Sessions utilisateur : jetons de rafraîchissement opaques, avec rotation.
 *
 * - Le jeton est une valeur aléatoire (256 bits), pas un JWT : il ne peut pas
 *   servir de jeton d'accès, et il est révocable.
 * - Seule son empreinte SHA-256 est stockée en base.
 * - Chaque utilisation le remplace par un nouveau (rotation) dans la même
 *   « famille » (une famille = une connexion sur un appareil).
 * - Présenter un jeton déjà utilisé signifie qu'il a été copié : toute la
 *   famille est révoquée (détection de réutilisation, OWASP / RFC 9700).
 * - Durée : 30 jours d'inactivité au plus, 90 jours au total par connexion.
 */
const REFRESH_TOKEN_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const ACTIVE_STATUS = 'ACTIVE';

const SESSION_ERROR = Object.freeze({
  INVALID: 'INVALID',
  REUSED: 'REUSED',
  INACTIVE_USER: 'INACTIVE_USER',
});

const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const newTokenValue = () => randomBytes(32).toString('base64url');

const expiryFor = (sessionStartedAt, now) =>
  new Date(Math.min(now.getTime() + REFRESH_TOKEN_IDLE_MS, sessionStartedAt.getTime() + SESSION_MAX_AGE_MS));

const revokeFamily = (db, familyId, now = new Date()) =>
  db.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: now },
  });

const createRefreshToken = async (db, { userId, familyId, sessionStartedAt, now }) => {
  const value = newTokenValue();
  const record = await db.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(value),
      familyId,
      sessionStartedAt,
      expiresAt: expiryFor(sessionStartedAt, now),
    },
    select: { id: true },
  });
  return { value, id: record.id };
};

const sessionPayload = (userId, refreshToken) => ({
  accessToken: generateAccessToken(userId),
  refreshToken,
  accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
});

/**
 * Ouvre une nouvelle session (connexion, inscription, changement de mot de passe).
 */
const startSession = async (userId) => {
  const now = new Date();
  // Ménage : les jetons expirés de l'utilisateur ne servent plus à rien.
  await prisma.refreshToken.deleteMany({ where: { userId, expiresAt: { lt: now } } });

  const { value } = await createRefreshToken(prisma, {
    userId,
    familyId: randomUUID(),
    sessionStartedAt: now,
    now,
  });
  return sessionPayload(userId, value);
};

/**
 * Échange un jeton de rafraîchissement contre une nouvelle paire de jetons.
 *
 * @returns {Promise<{ ok: true, session: object } | { ok: false, error: string }>}
 */
const rotateSession = async (presentedToken) => {
  if (typeof presentedToken !== 'string' || !REFRESH_TOKEN_PATTERN.test(presentedToken)) {
    return { ok: false, error: SESSION_ERROR.INVALID };
  }

  const now = new Date();
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(presentedToken) },
    include: { user: { select: { id: true, status: true } } },
  });

  if (!record) {
    return { ok: false, error: SESSION_ERROR.INVALID };
  }

  if (record.revokedAt) {
    await revokeFamily(prisma, record.familyId, now);
    return { ok: false, error: SESSION_ERROR.REUSED };
  }

  if (record.expiresAt <= now) {
    return { ok: false, error: SESSION_ERROR.INVALID };
  }

  if (record.user?.status !== ACTIVE_STATUS) {
    await revokeFamily(prisma, record.familyId, now);
    return { ok: false, error: SESSION_ERROR.INACTIVE_USER };
  }

  const rotated = await prisma.$transaction(async (tx) => {
    // Réservation atomique : si deux requêtes utilisent le même jeton en même
    // temps, une seule obtient la rotation ; l'autre est traitée comme une
    // réutilisation.
    const claimed = await tx.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: now },
    });
    if (claimed.count !== 1) {
      await revokeFamily(tx, record.familyId, now);
      return null;
    }

    const next = await createRefreshToken(tx, {
      userId: record.userId,
      familyId: record.familyId,
      sessionStartedAt: record.sessionStartedAt,
      now,
    });
    await tx.refreshToken.update({
      where: { id: record.id },
      data: { replacedById: next.id },
    });
    return next.value;
  });

  if (!rotated) {
    return { ok: false, error: SESSION_ERROR.REUSED };
  }
  return { ok: true, session: sessionPayload(record.userId, rotated) };
};

/**
 * Déconnexion de l'appareil : révoque la famille du jeton présenté.
 * Ne révèle jamais si le jeton existait.
 */
const endSession = async (presentedToken) => {
  if (typeof presentedToken !== 'string' || !REFRESH_TOKEN_PATTERN.test(presentedToken)) {
    return;
  }
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(presentedToken) },
    select: { familyId: true },
  });
  if (record) {
    await revokeFamily(prisma, record.familyId);
  }
};

/**
 * Déconnexion de tous les appareils (mot de passe changé ou réinitialisé,
 * compte compromis...).
 */
const endAllSessions = (userId, db = prisma) =>
  db.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

module.exports = {
  REFRESH_TOKEN_IDLE_MS,
  SESSION_MAX_AGE_MS,
  SESSION_ERROR,
  hashToken,
  startSession,
  rotateSession,
  endSession,
  endAllSessions,
};
