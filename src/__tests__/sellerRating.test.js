const express = require('express');
const request = require('supertest');
const { useTestJwtSecret, bearerFor } = require('./helpers/auth');

const mockPrisma = {
  rating: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    aggregate: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  listing: { findUnique: jest.fn() },
  user: { update: jest.fn(), findUnique: jest.fn() },
  notification: { create: jest.fn() },
  // Transaction : le même faux client, appelé avec la fonction.
  $transaction: jest.fn((fn) => fn(mockPrisma)),
};
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockPrisma) }));
jest.mock('../lib/prisma', () => mockPrisma);
jest.mock('../utils/emailTemplates', () => ({
  sendRatingReceivedEmail: jest.fn().mockResolvedValue(undefined),
}));

const ratingRoutes = require('../routes/rating');
const { recomputeSellerRating, roundRating } = require('../services/sellerRating');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/ratings', ratingRoutes);
  return app;
};

const as = (userId) => ({ Authorization: bearerFor(userId) });

/** Moyenne et nombre d'avis renvoyés par la base. */
const aggregateGives = (avg, count) =>
  mockPrisma.rating.aggregate.mockResolvedValue({
    _avg: { score: avg },
    _count: { _all: count },
  });

describe('Note moyenne du vendeur', () => {
  beforeAll(useTestJwtSecret);
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));
    mockPrisma.user.update.mockResolvedValue({});
  });

  describe('recomputeSellerRating', () => {
    test('moyenne arrondie à 2 décimales et nombre d’avis', async () => {
      aggregateGives(14 / 3, 3);

      const result = await recomputeSellerRating(mockPrisma, 's1');

      expect(result).toEqual({ avgRating: 4.67, totalRatings: 3 });
      expect(mockPrisma.rating.aggregate).toHaveBeenCalledWith({
        where: { sellerId: 's1' },
        _avg: { score: true },
        _count: { _all: true },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { avgRating: 4.67, totalRatings: 3 },
      });
    });

    test('plus aucun avis : retour à zéro', async () => {
      aggregateGives(null, 0);

      const result = await recomputeSellerRating(mockPrisma, 's1');

      expect(result).toEqual({ avgRating: 0, totalRatings: 0 });
    });

    test('arrondi', () => {
      expect(roundRating(4.666)).toBe(4.67);
      expect(roundRating(4.8)).toBe(4.8);
    });
  });

  describe('POST /api/ratings', () => {
    beforeEach(() => {
      mockPrisma.listing.findUnique.mockResolvedValue({
        id: 'l1',
        title: 'Vélo',
        userId: 's1',
        user: { id: 's1', username: 'aminata', email: 'a@example.com' },
      });
      mockPrisma.rating.findUnique.mockResolvedValue(null);
      mockPrisma.rating.create.mockResolvedValue({
        id: 'r1',
        score: 5,
        user: { id: 'u1', username: 'moussa', avatar: null },
        listing: { id: 'l1', title: 'Vélo' },
      });
      aggregateGives(4.5, 2);
    });

    test('avis créé : moyenne du vendeur recalculée dans la transaction', async () => {
      const res = await request(buildApp())
        .post('/api/ratings')
        .set(as('u1'))
        .send({ listingId: 'l1', score: 5, comment: 'Très bien' });

      expect(res.status).toBe(201);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.rating.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sellerId: 's1', score: 5, comment: 'Très bien' }),
        }),
      );
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { avgRating: 4.5, totalRatings: 2 },
      });
    });

    test('déjà noté : 409, rien n’est recalculé', async () => {
      mockPrisma.rating.findUnique.mockResolvedValue({ id: 'r0' });

      const res = await request(buildApp())
        .post('/api/ratings')
        .set(as('u1'))
        .send({ listingId: 'l1', score: 4 });

      expect(res.status).toBe(409);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    test('deux envois simultanés : 409 au lieu d’une erreur serveur', async () => {
      mockPrisma.rating.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint'), { code: 'P2002' }),
      );

      const res = await request(buildApp())
        .post('/api/ratings')
        .set(as('u1'))
        .send({ listingId: 'l1', score: 4 });

      expect(res.status).toBe(409);
    });

    test('sa propre annonce : refusé', async () => {
      const res = await request(buildApp())
        .post('/api/ratings')
        .set(as('s1'))
        .send({ listingId: 'l1', score: 5 });

      expect(res.status).toBe(400);
      expect(mockPrisma.rating.create).not.toHaveBeenCalled();
    });

    test.each([
      ['note hors limites', { listingId: 'l1', score: 6 }],
      ['note décimale', { listingId: 'l1', score: 4.5 }],
      ['identifiant non texte', { listingId: { $ne: null }, score: 5 }],
      ['commentaire trop long', { listingId: 'l1', score: 5, comment: 'a'.repeat(1001) }],
      ['commentaire non texte', { listingId: 'l1', score: 5, comment: ['x'] }],
    ])('%s : 400 avant toute requête en base', async (_, body) => {
      const res = await request(buildApp())
        .post('/api/ratings')
        .set(as('u1'))
        .send(body);

      expect(res.status).toBe(400);
      expect(mockPrisma.listing.findUnique).not.toHaveBeenCalled();
    });

    test('sans connexion : 401', async () => {
      const res = await request(buildApp())
        .post('/api/ratings')
        .send({ listingId: 'l1', score: 5 });

      expect(res.status).toBe(401);
    });
  });

  describe('PUT et DELETE /api/ratings/:ratingId', () => {
    beforeEach(() => {
      mockPrisma.rating.findUnique.mockResolvedValue({
        id: 'r1',
        userId: 'u1',
        sellerId: 's1',
        score: 2,
        comment: 'Bof',
      });
      mockPrisma.rating.update.mockResolvedValue({ id: 'r1', score: 4 });
      mockPrisma.rating.delete.mockResolvedValue({});
      aggregateGives(4, 1);
    });

    test('modification : moyenne recalculée', async () => {
      const res = await request(buildApp())
        .put('/api/ratings/r1')
        .set(as('u1'))
        .send({ score: 4 });

      expect(res.status).toBe(200);
      expect(mockPrisma.rating.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { score: 4, comment: 'Bof' } }),
      );
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { avgRating: 4, totalRatings: 1 },
      });
    });

    test('suppression : moyenne recalculée', async () => {
      aggregateGives(null, 0);

      const res = await request(buildApp()).delete('/api/ratings/r1').set(as('u1'));

      expect(res.status).toBe(200);
      expect(mockPrisma.rating.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { avgRating: 0, totalRatings: 0 },
      });
    });

    test('avis d’un autre : 403, rien n’est recalculé', async () => {
      const res = await request(buildApp()).delete('/api/ratings/r1').set(as('u2'));

      expect(res.status).toBe(403);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  test('GET /seller/:id : moyenne enregistrée, sans relire tous les avis', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 's1', avgRating: 4.67, totalRatings: 3 });
    mockPrisma.rating.findMany.mockResolvedValue([]);
    mockPrisma.rating.count.mockResolvedValue(3);

    const res = await request(buildApp()).get('/api/ratings/seller/s1');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ avgScore: 4.67, totalRatings: 3 });
    expect(mockPrisma.rating.findMany).toHaveBeenCalledTimes(1);
  });
});
