const express = require('express');
const request = require('supertest');
const { useTestJwtSecret, bearerFor } = require('./helpers/auth');

// Base de données simulée : le contrôleur crée son propre PrismaClient.
const mockPrisma = {
  favorite: {
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
  listing: { findUnique: jest.fn() },
};
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockPrisma) }));

const favoriteRoutes = require('../routes/favorite');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/favorites', favoriteRoutes);
  return app;
};

describe('Favoris : chaque utilisateur ne voit que les siens', () => {
  beforeAll(useTestJwtSecret);

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.favorite.findMany.mockResolvedValue([]);
    mockPrisma.favorite.count.mockResolvedValue(0);
  });

  test('GET /api/favorites filtre sur l’utilisateur du token', async () => {
    const res = await request(buildApp())
      .get('/api/favorites')
      .set('Authorization', bearerFor('alice'));

    expect(res.status).toBe(200);
    expect(mockPrisma.favorite.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.favorite.findMany.mock.calls[0][0].where).toEqual({ userId: 'alice' });
    expect(mockPrisma.favorite.count).toHaveBeenCalledWith({ where: { userId: 'alice' } });
  });

  test('le filtre ne peut jamais être vide (régression req.userId)', async () => {
    await request(buildApp())
      .get('/api/favorites')
      .set('Authorization', bearerFor('bob'));

    const { where } = mockPrisma.favorite.findMany.mock.calls[0][0];
    expect(where.userId).toBe('bob');
  });

  test('sans token : 401 et aucune requête en base', async () => {
    const res = await request(buildApp()).get('/api/favorites');

    expect(res.status).toBe(401);
    expect(mockPrisma.favorite.findMany).not.toHaveBeenCalled();
  });

  test('vérifier un favori utilise l’utilisateur du token', async () => {
    mockPrisma.favorite.findUnique.mockResolvedValue(null);

    await request(buildApp())
      .get('/api/favorites/check/listing-1')
      .set('Authorization', bearerFor('alice'));

    expect(mockPrisma.favorite.findUnique.mock.calls[0][0].where).toEqual({
      userId_listingId: { userId: 'alice', listingId: 'listing-1' },
    });
  });
});
