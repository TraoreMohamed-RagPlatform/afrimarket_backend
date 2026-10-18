const express = require('express');
const request = require('supertest');
const { useTestJwtSecret, bearerFor } = require('./helpers/auth');

const mockPrisma = {
  user: { findUnique: jest.fn() },
  userSettings: { upsert: jest.fn() },
};
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockPrisma) }));

const userRoutes = require('../routes/user');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/users', userRoutes);
  return app;
};

const account = (settings = null) => ({
  id: 'u1',
  email: 'u1@example.com',
  role: 'USER',
  status: 'ACTIVE',
  verifiedEmail: true,
  verifiedPhone: true,
  settings,
});

describe('Paramètres utilisateur (enregistrés en base)', () => {
  beforeAll(useTestJwtSecret);

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.userSettings.upsert.mockResolvedValue({});
  });

  test('GET sans paramètres enregistrés : numéro masqué par défaut', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(account());

    const res = await request(buildApp())
      .get('/api/users/me/settings')
      .set('Authorization', bearerFor('u1'));

    expect(res.status).toBe(200);
    expect(res.body.settings.privacy).toEqual({ showPhoneNumber: false, whatsappEnabled: false });
    expect(res.body.settings.notifications).toEqual({
      messageAlerts: true,
      listingAlerts: true,
      ratingAlerts: true,
    });
    expect(res.body.settings.phoneVerified).toBe(true);
  });

  test('GET : valeurs enregistrées', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(
      account({
        showPhone: true,
        whatsappEnabled: true,
        messageAlerts: false,
        listingAlerts: true,
        ratingAlerts: true,
      }),
    );

    const res = await request(buildApp())
      .get('/api/users/me/settings')
      .set('Authorization', bearerFor('u1'));

    expect(res.body.settings.privacy).toEqual({ showPhoneNumber: true, whatsappEnabled: true });
    expect(res.body.settings.notifications.messageAlerts).toBe(false);
  });

  test('PUT : seuls les champs envoyés sont enregistrés, pour l’utilisateur connecté', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(account());

    const res = await request(buildApp())
      .put('/api/users/me/settings')
      .set('Authorization', bearerFor('u1'))
      .send({ privacy: { showPhoneNumber: true, whatsappEnabled: true }, userId: 'victim' });

    expect(res.status).toBe(200);
    expect(mockPrisma.userSettings.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: { userId: 'u1', showPhone: true, whatsappEnabled: true },
      update: { showPhone: true, whatsappEnabled: true },
    });
  });

  test.each([
    ['texte au lieu d’un booléen', { privacy: { showPhoneNumber: 'true' } }],
    ['nombre au lieu d’un booléen', { notifications: { messageAlerts: 1 } }],
    ['groupe qui n’est pas un objet', { privacy: 'public' }],
  ])('PUT %s : 400', async (_name, body) => {
    const res = await request(buildApp())
      .put('/api/users/me/settings')
      .set('Authorization', bearerFor('u1'))
      .send(body);

    expect(res.status).toBe(400);
    expect(mockPrisma.userSettings.upsert).not.toHaveBeenCalled();
  });

  test('PUT sans token : 401', async () => {
    const res = await request(buildApp())
      .put('/api/users/me/settings')
      .send({ privacy: { showPhoneNumber: true } });

    expect(res.status).toBe(401);
  });
});
