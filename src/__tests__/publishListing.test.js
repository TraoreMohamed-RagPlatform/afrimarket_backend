const express = require('express');
const request = require('supertest');
const { useTestJwtSecret, bearerFor } = require('./helpers/auth');

const mockPrisma = {
  listing: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  category: { findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
};
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockPrisma) }));
jest.mock('../utils/emailService', () => ({ sendEmail: jest.fn() }));

const listingRoutes = require('../routes/listing');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/listings', listingRoutes);
  return app;
};

const body = (extra = {}) => ({
  title: 'Vélo de ville',
  description: 'Vélo en bon état, freins neufs.',
  price: 900,
  categoryId: 'c1',
  district: 'maarif',
  condition: 'GOOD',
  status: 'INACTIVE',
  ...extra,
});

describe('Publication d’une annonce', () => {
  beforeAll(useTestJwtSecret);
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.category.findUnique.mockResolvedValue({ id: 'c1' });
    mockPrisma.listing.create.mockImplementation(({ data }) => Promise.resolve({ id: 'new', ...data }));
    mockPrisma.listing.update.mockImplementation(({ data }) => Promise.resolve({ id: 'l1', ...data }));
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'seller', username: 'aminata' });
  });

  test('10 annonces par heure et par vendeur ; les refus ne comptent pas', async () => {
    const app = buildApp();
    const post = (userId, payload) =>
      request(app).post('/api/listings').set('Authorization', bearerFor(userId)).send(payload);

    // Formulaires invalides : refusés, mais pas décomptés.
    for (let i = 0; i < 3; i += 1) {
      expect((await post('seller-a', body({ district: null }))).status).toBe(400);
    }
    for (let i = 0; i < 10; i += 1) {
      expect((await post('seller-a', body())).status).toBe(201);
    }

    expect((await post('seller-a', body())).status).toBe(429);
    // Un autre vendeur n'est pas bloqué.
    expect((await post('seller-b', body())).status).toBe(201);
  });

  describe('PUT /api/listings/:id', () => {
    const update = (payload) =>
      request(buildApp())
        .put('/api/listings/l1')
        .set('Authorization', bearerFor('seller'))
        .send(payload);

    beforeEach(() => {
      mockPrisma.listing.findUnique.mockResolvedValue({
        id: 'l1',
        userId: 'seller',
        title: 'Vélo',
        price: 900,
        status: 'INACTIVE',
      });
    });

    test('publication après l’envoi des photos : INACTIVE → ACTIVE', async () => {
      const res = await update({ status: 'ACTIVE' });

      expect(res.status).toBe(200);
      expect(mockPrisma.listing.update.mock.calls[0][0].data).toEqual({ status: 'ACTIVE' });
    });

    test('état modifiable', async () => {
      const res = await update({ condition: 'FAIR' });

      expect(res.status).toBe(200);
      expect(mockPrisma.listing.update.mock.calls[0][0].data).toEqual({ condition: 'FAIR' });
    });

    test('état inconnu : 400', async () => {
      const res = await update({ condition: 'PARFAIT' });

      expect(res.status).toBe(400);
      expect(mockPrisma.listing.update).not.toHaveBeenCalled();
    });

    test('catégorie inexistante : 400', async () => {
      mockPrisma.category.findUnique.mockResolvedValue(null);

      const res = await update({ categoryId: 'inconnue' });

      expect(res.status).toBe(400);
      expect(mockPrisma.listing.update).not.toHaveBeenCalled();
    });
  });
});
