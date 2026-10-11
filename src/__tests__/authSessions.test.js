const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');

const { createFakePrisma } = require('./helpers/fakePrisma');
const { TEST_JWT_SECRET, useTestJwtSecret } = require('./helpers/auth');

const mockDb = createFakePrisma();
jest.mock('../lib/prisma', () => mockDb);
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => ({})) }));
// Les limiteurs de connexion/inscription (testés à part) bloqueraient les
// nombreuses inscriptions de cette suite : ils sont neutralisés ici.
jest.mock('../middleware/rateLimitMiddleware', () => {
  const pass = (req, res, next) => next();
  return { loginLimiter: pass, registerLimiter: pass };
});
// reCAPTCHA et e-mails : aucun appel réseau pendant les tests.
jest.mock('../utils/recaptchaService', () => ({ verifyToken: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock('../utils/passwordService', () => ({
  sendResetPasswordEmail: jest.fn().mockResolvedValue(),
  sendPasswordChangeConfirmation: jest.fn().mockResolvedValue(),
}));

const authRoutes = require('../routes/auth');
const { verifyPassword } = require('../utils/passwordPolicy');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

const PASSWORD = 'Correct-horse-42';
let counter = 0;

const register = (password = PASSWORD) => {
  counter += 1;
  return request(app)
    .post('/api/auth/register')
    .send({ email: `user${counter}@afrimarket.test`, username: `user${counter}`, password, fullName: 'Awa Traoré' });
};

const login = (email, password = PASSWORD) =>
  request(app).post('/api/auth/login').send({ email, password, recaptchaToken: 'ok' });

const me = (accessToken) => request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
const refresh = (refreshToken) => request(app).post('/api/auth/refresh-token').send({ refreshToken });

describe('Authentification : jetons et sessions (S2)', () => {
  beforeAll(useTestJwtSecret);
  beforeAll(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));

  test('inscription : mot de passe trop court refusé (8 caractères minimum)', async () => {
    const res = await register('Abc-123');

    expect(res.status).toBe(400);
  });

  test('inscription : mot de passe de plus de 72 octets refusé (limite bcrypt)', async () => {
    const res = await register('é'.repeat(37)); // 74 octets

    expect(res.status).toBe(400);
  });

  test('inscription : mot de passe haché avec bcrypt coût 12, paire de jetons renvoyée', async () => {
    const res = await register();

    expect(res.status).toBe(201);
    expect(res.body.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = mockDb._users.find((u) => u.id === res.body.user.id);
    expect(stored.password).toMatch(/^\$2[aby]\$12\$/);
    await expect(verifyPassword(PASSWORD, stored.password)).resolves.toBe(true);
  });

  test('connexion : e-mail inconnu et mauvais mot de passe donnent la même réponse', async () => {
    const { body } = await register();

    const unknown = await login('personne@afrimarket.test');
    const wrong = await login(body.user.email, 'Mauvais-mot-de-passe');

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  test('connexion puis /me avec le jeton d’accès : 200', async () => {
    const { body: reg } = await register();
    const { body } = await login(reg.user.email);

    const res = await me(body.accessToken);

    expect(res.status).toBe(200);
  });

  test('le jeton de rafraîchissement n’ouvre pas l’API', async () => {
    const { body } = await register();

    const res = await me(body.refreshToken);

    expect(res.status).toBe(401);
  });

  test('ancien format de jeton (sans type) refusé', async () => {
    const { body } = await register();
    const legacy = jwt.sign({ userId: body.user.id }, TEST_JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' });

    expect((await me(legacy)).status).toBe(401);
    expect((await refresh(legacy)).status).toBe(401);
  });

  test('rafraîchissement : rotation, puis l’ancien jeton est refusé', async () => {
    const { body } = await register();

    const first = await refresh(body.refreshToken);
    const replay = await refresh(body.refreshToken);

    expect(first.status).toBe(200);
    expect(first.body.refreshToken).not.toBe(body.refreshToken);
    expect((await me(first.body.accessToken)).status).toBe(200);
    expect(replay.status).toBe(401);
    // Réutilisation détectée : la session entière est coupée.
    expect((await refresh(first.body.refreshToken)).status).toBe(401);
  });

  test('rafraîchissement avec un objet au lieu d’une chaîne : 400', async () => {
    const res = await refresh({ $ne: null });

    expect(res.status).toBe(400);
  });

  test('déconnexion : le jeton de rafraîchissement est révoqué', async () => {
    const { body } = await register();

    const res = await request(app).post('/api/auth/logout').send({ refreshToken: body.refreshToken });

    expect(res.status).toBe(200);
    expect((await refresh(body.refreshToken)).status).toBe(401);
  });

  test('déconnexion de tous les appareils', async () => {
    const { body: reg } = await register();
    const { body: second } = await login(reg.user.email);

    const res = await request(app).post('/api/auth/logout-all').set('Authorization', `Bearer ${reg.accessToken}`);

    expect(res.status).toBe(200);
    expect((await refresh(reg.refreshToken)).status).toBe(401);
    expect((await refresh(second.refreshToken)).status).toBe(401);
  });

  test('changement de mot de passe : autres appareils déconnectés, nouvelle session pour celui-ci', async () => {
    const { body: reg } = await register();
    const { body: otherDevice } = await login(reg.user.email);

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send({ oldPassword: PASSWORD, newPassword: 'Nouveau-mot-de-passe-7' });

    expect(res.status).toBe(200);
    expect((await refresh(otherDevice.refreshToken)).status).toBe(401);
    expect((await refresh(reg.refreshToken)).status).toBe(401);
    expect((await refresh(res.body.refreshToken)).status).toBe(200);
  });

  test('changement de mot de passe : nouveau mot de passe trop court refusé', async () => {
    const { body: reg } = await register();

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send({ oldPassword: PASSWORD, newPassword: 'court' });

    expect(res.status).toBe(400);
  });

  test('changement de mot de passe : identique à l’ancien refusé, sessions conservées', async () => {
    const { body: reg } = await register();

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send({ oldPassword: PASSWORD, newPassword: PASSWORD });

    expect(res.status).toBe(400);
    expect((await refresh(reg.refreshToken)).status).toBe(200);
  });

  test('changement de mot de passe : ancien mot de passe absent ou faux refusé', async () => {
    const { body: reg } = await register();
    const send = (payload) =>
      request(app).post('/api/auth/change-password').set('Authorization', `Bearer ${reg.accessToken}`).send(payload);

    expect((await send({ newPassword: 'Nouveau-mot-de-passe-7' })).status).toBe(400);
    expect((await send({ oldPassword: { $ne: null }, newPassword: 'Nouveau-mot-de-passe-7' })).status).toBe(400);
    expect((await send({ oldPassword: 'Faux-mot-de-passe', newPassword: 'Nouveau-mot-de-passe-7' })).status).toBe(401);
  });

  test('réinitialisation : champs manquants ou mot de passe trop court refusés par la route', async () => {
    const reset = (payload) => request(app).post('/api/auth/reset-password').send(payload);

    expect((await reset({ email: 'a@afrimarket.test', code: '123456' })).status).toBe(400);
    expect((await reset({ email: 'a@afrimarket.test', code: '123456', newPassword: 'court' })).status).toBe(400);
  });

  test('compte suspendu : statut révélé seulement avec le bon mot de passe', async () => {
    const { body: reg } = await register();
    await mockDb.user.update({ where: { id: reg.user.id }, data: { status: 'SUSPENDED' } });

    expect((await login(reg.user.email, 'Mauvais-mot-de-passe')).status).toBe(401);
    expect((await login(reg.user.email)).status).toBe(403);
    expect((await refresh(reg.refreshToken)).status).toBe(401);
  });
});
