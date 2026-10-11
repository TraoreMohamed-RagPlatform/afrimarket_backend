const { createFakePrisma } = require('./helpers/fakePrisma');
const { useTestJwtSecret } = require('./helpers/auth');

const mockDb = createFakePrisma();
jest.mock('../lib/prisma', () => mockDb);

const {
  SESSION_ERROR,
  SESSION_MAX_AGE_MS,
  hashToken,
  startSession,
  rotateSession,
  endSession,
  endAllSessions,
} = require('../services/sessionService');
const { verifyAccessToken } = require('../utils/tokenUtils');

const addUser = (status = 'ACTIVE') => mockDb.user.create({ data: { email: `${Math.random()}@x.ma`, status } });
const recordFor = (token) => mockDb._refreshTokens.find((t) => t.tokenHash === hashToken(token));

describe('Sessions : jetons de rafraîchissement avec rotation', () => {
  beforeAll(useTestJwtSecret);

  test('ouverture : jeton d’accès valide et jeton opaque dont seule l’empreinte est stockée', async () => {
    const user = await addUser();

    const session = await startSession(user.id);

    expect(verifyAccessToken(session.accessToken)).toEqual({ userId: user.id });
    expect(session.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session.accessTokenExpiresIn).toBe(900);
    expect(JSON.stringify(mockDb._refreshTokens)).not.toContain(session.refreshToken);
    expect(recordFor(session.refreshToken)).toBeDefined();
  });

  test('le jeton de rafraîchissement ne sert pas de jeton d’accès', async () => {
    const user = await addUser();
    const { refreshToken } = await startSession(user.id);

    expect(verifyAccessToken(refreshToken)).toBeNull();
  });

  test('rotation : nouvelle paire, l’ancien jeton est révoqué et chaîné au nouveau', async () => {
    const user = await addUser();
    const first = await startSession(user.id);

    const result = await rotateSession(first.refreshToken);

    expect(result.ok).toBe(true);
    expect(result.session.refreshToken).not.toBe(first.refreshToken);
    const oldRecord = recordFor(first.refreshToken);
    const newRecord = recordFor(result.session.refreshToken);
    expect(oldRecord.revokedAt).toBeInstanceOf(Date);
    expect(oldRecord.replacedById).toBe(newRecord.id);
    expect(newRecord.familyId).toBe(oldRecord.familyId);

    // Le nouveau jeton fonctionne à son tour.
    await expect(rotateSession(result.session.refreshToken)).resolves.toMatchObject({ ok: true });
  });

  test('réutilisation d’un ancien jeton : refus et révocation de toute la famille', async () => {
    const user = await addUser();
    const stolen = await startSession(user.id);
    const legit = await rotateSession(stolen.refreshToken);

    const replay = await rotateSession(stolen.refreshToken);

    expect(replay).toEqual({ ok: false, error: SESSION_ERROR.REUSED });
    // Le jeton légitime de la même famille est aussi coupé.
    await expect(rotateSession(legit.session.refreshToken)).resolves.toMatchObject({ ok: false });
  });

  test('les autres connexions de l’utilisateur ne sont pas touchées par une réutilisation', async () => {
    const user = await addUser();
    const phone = await startSession(user.id);
    const tablet = await startSession(user.id);
    await rotateSession(phone.refreshToken);
    await rotateSession(phone.refreshToken); // réutilisation

    await expect(rotateSession(tablet.refreshToken)).resolves.toMatchObject({ ok: true });
  });

  test('jeton expiré : refusé', async () => {
    const user = await addUser();
    const { refreshToken } = await startSession(user.id);
    recordFor(refreshToken).expiresAt = new Date(Date.now() - 1000);

    await expect(rotateSession(refreshToken)).resolves.toEqual({ ok: false, error: SESSION_ERROR.INVALID });
  });

  test('compte suspendu : refus et révocation de la session', async () => {
    const user = await addUser();
    const { refreshToken } = await startSession(user.id);
    await mockDb.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });

    await expect(rotateSession(refreshToken)).resolves.toEqual({ ok: false, error: SESSION_ERROR.INACTIVE_USER });
    expect(recordFor(refreshToken).revokedAt).toBeInstanceOf(Date);
  });

  test.each([undefined, '', 'court', { $ne: null }, 'x'.repeat(43) + '!'])('jeton mal formé (%p) : refusé', async (token) => {
    await expect(rotateSession(token)).resolves.toEqual({ ok: false, error: SESSION_ERROR.INVALID });
  });

  test('jeton inconnu bien formé : refusé', async () => {
    await expect(rotateSession('A'.repeat(43))).resolves.toEqual({ ok: false, error: SESSION_ERROR.INVALID });
  });

  test('durée maximale d’une connexion : 90 jours, même avec des rotations', async () => {
    const user = await addUser();
    const { refreshToken } = await startSession(user.id);
    const started = new Date(Date.now() - (SESSION_MAX_AGE_MS - 60 * 60 * 1000)); // il y a 89 j 23 h
    recordFor(refreshToken).sessionStartedAt = started;

    const result = await rotateSession(refreshToken);

    expect(recordFor(result.session.refreshToken).expiresAt.getTime()).toBe(started.getTime() + SESSION_MAX_AGE_MS);
  });

  test('déconnexion : la famille du jeton est révoquée', async () => {
    const user = await addUser();
    const { refreshToken } = await startSession(user.id);

    await endSession(refreshToken);

    await expect(rotateSession(refreshToken)).resolves.toMatchObject({ ok: false });
  });

  test('déconnexion avec un jeton inconnu ou invalide : aucune erreur', async () => {
    await expect(endSession('A'.repeat(43))).resolves.toBeUndefined();
    await expect(endSession({ $ne: null })).resolves.toBeUndefined();
  });

  test('déconnexion de tous les appareils : seulement ceux de l’utilisateur', async () => {
    const alice = await addUser();
    const bob = await addUser();
    const a1 = await startSession(alice.id);
    const a2 = await startSession(alice.id);
    const b1 = await startSession(bob.id);

    await endAllSessions(alice.id);

    await expect(rotateSession(a1.refreshToken)).resolves.toMatchObject({ ok: false });
    await expect(rotateSession(a2.refreshToken)).resolves.toMatchObject({ ok: false });
    await expect(rotateSession(b1.refreshToken)).resolves.toMatchObject({ ok: true });
  });
});
