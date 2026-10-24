const express = require('express');
const request = require('supertest');
const { useTestJwtSecret, bearerFor } = require('./helpers/auth');

// Base de données simulée : les contrôleurs créent leur propre PrismaClient.
const mockPrisma = {
  listing: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    aggregate: jest.fn(),
  },
  category: { findMany: jest.fn(), findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
  favorite: { findMany: jest.fn() },
  notification: { findMany: jest.fn(), create: jest.fn() },
};
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockPrisma) }));
// Aucun e-mail pendant les tests.
jest.mock('../utils/emailService', () => ({ sendEmail: jest.fn() }));

const listingRoutes = require('../routes/listing');
const searchRoutes = require('../routes/search');
const { MIN_SAMPLES } = require('../services/responseTime');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/listings', listingRoutes);
  app.use('/api', searchRoutes);
  return app;
};

const OWNER = 'seller-1';

const validListing = (extra = {}) => ({
  title: 'Canapé 3 places',
  description: 'Très bon état, à récupérer sur place.',
  price: 1200,
  categoryId: 'c1',
  district: 'maarif',
  ...extra,
});

/** Annonce existante (avant modification). */
const storedListing = (extra = {}) => ({
  id: 'listing-1',
  userId: OWNER,
  title: 'Canapé',
  price: 1000,
  previousPrice: null,
  user: { id: OWNER, username: 'aminata', email: 'a@example.com' },
  ...extra,
});

describe('Détails d’une annonce (quartier, négociable, remise, ancien prix)', () => {
  beforeAll(useTestJwtSecret);

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.listing.create.mockImplementation(({ data }) => Promise.resolve({ id: 'new', ...data }));
    mockPrisma.listing.update.mockImplementation(({ data }) => Promise.resolve({ id: 'listing-1', ...data }));
    mockPrisma.user.findUnique.mockResolvedValue({ id: OWNER, username: 'aminata', email: 'a@example.com' });
    mockPrisma.category.findUnique.mockResolvedValue({ id: 'c1' });
    mockPrisma.favorite.findMany.mockResolvedValue([]);
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.notification.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: `n-${data.userId}`, createdAt: new Date(), ...data }),
    );
  });

  describe('POST /api/listings', () => {
    const create = (body) =>
      request(buildApp()).post('/api/listings').set('Authorization', bearerFor(OWNER)).send(body);

    test('valeurs par défaut : Casablanca, publiée, neuf, non négociable, main propre', async () => {
      const res = await create(validListing());

      expect(res.status).toBe(201);
      expect(mockPrisma.listing.create.mock.calls[0][0].data).toMatchObject({
        city: 'casablanca',
        district: 'maarif',
        status: 'ACTIVE',
        condition: 'NEW',
        isNegotiable: false,
        deliveryMode: 'PICKUP',
        price: 1200,
      });
    });

    test('créée masquée (INACTIVE) le temps d’envoyer les photos', async () => {
      const res = await create(validListing({ status: 'INACTIVE', condition: 'GOOD' }));

      expect(res.status).toBe(201);
      expect(mockPrisma.listing.create.mock.calls[0][0].data).toMatchObject({
        status: 'INACTIVE',
        condition: 'GOOD',
      });
    });

    test('catégorie inexistante : 400, rien n’est créé', async () => {
      mockPrisma.category.findUnique.mockResolvedValue(null);

      const res = await create(validListing({ categoryId: 'inconnue' }));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Catégorie inconnue');
      expect(mockPrisma.listing.create).not.toHaveBeenCalled();
    });

    test('quartier, négociable et livraison enregistrés', async () => {
      const res = await create(
        validListing({ district: 'maarif', isNegotiable: true, deliveryMode: 'BOTH' }),
      );

      expect(res.status).toBe(201);
      expect(mockPrisma.listing.create.mock.calls[0][0].data).toMatchObject({
        district: 'maarif',
        isNegotiable: true,
        deliveryMode: 'BOTH',
      });
    });

    test('l’ancien prix ne peut pas être fourni par le client', async () => {
      await create(validListing({ previousPrice: 99999 }));

      expect(mockPrisma.listing.create.mock.calls[0][0].data).not.toHaveProperty('previousPrice');
    });

    test('gratuit (0 MAD) accepté', async () => {
      const res = await create(validListing({ price: 0 }));

      expect(res.status).toBe(201);
    });

    test.each([
      ['quartier inconnu', { district: 'quartier-imaginaire' }],
      ['quartier en texte libre', { district: 'Maârif' }],
      ['ville inconnue', { city: 'paris' }],
      ['négociable en texte', { isNegotiable: 'true' }],
      ['mode de remise inconnu', { deliveryMode: 'DRONE' }],
      ['quartier absent', { district: undefined }],
      ['quartier nul', { district: null }],
      ['état inconnu', { condition: 'EXCELLENT' }],
      ['statut « vendue » à la création', { status: 'SOLD' }],
      ['statut « réservée » à la création', { status: 'RESERVED' }],
      ['prix démesuré', { price: 1e12 }],
      ['catégorie non texte', { categoryId: { $ne: null } }],
    ])('%s : 400', async (_name, extra) => {
      const res = await create(validListing(extra));

      expect(res.status).toBe(400);
      expect(mockPrisma.listing.create).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/listings/:id (ancien prix automatique)', () => {
    const update = (body) =>
      request(buildApp())
        .put('/api/listings/listing-1')
        .set('Authorization', bearerFor(OWNER))
        .send(body);

    test('baisse de prix : l’ancien prix est mémorisé', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(storedListing({ price: 1000 }));

      const res = await update({ price: 800 });

      expect(res.status).toBe(200);
      expect(mockPrisma.listing.update.mock.calls[0][0].data).toMatchObject({
        price: 800,
        previousPrice: 1000,
      });
    });

    test('nouvelle baisse : l’ancien prix est le dernier prix affiché', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(storedListing({ price: 800, previousPrice: 1000 }));

      await update({ price: 700 });

      expect(mockPrisma.listing.update.mock.calls[0][0].data).toMatchObject({
        price: 700,
        previousPrice: 800,
      });
    });

    test('hausse de prix : plus d’ancien prix (pas de fausse « baisse »)', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(storedListing({ price: 800, previousPrice: 1000 }));

      await update({ price: 900 });

      expect(mockPrisma.listing.update.mock.calls[0][0].data).toMatchObject({
        price: 900,
        previousPrice: null,
      });
    });

    test('prix inchangé : rien ne bouge', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(storedListing({ price: 800, previousPrice: 1000 }));

      await update({ price: 800, title: 'Canapé gris' });

      const { data } = mockPrisma.listing.update.mock.calls[0][0];
      expect(data).not.toHaveProperty('price');
      expect(data).not.toHaveProperty('previousPrice');
    });

    test('baisse jusqu’à 0 (gratuit) prise en compte', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(storedListing({ price: 300 }));

      await update({ price: 0 });

      expect(mockPrisma.listing.update.mock.calls[0][0].data).toMatchObject({
        price: 0,
        previousPrice: 300,
      });
    });

    test('quartier retiré avec null, négociable modifié', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(storedListing());

      const res = await update({ district: null, isNegotiable: false, deliveryMode: 'DELIVERY' });

      expect(res.status).toBe(200);
      expect(mockPrisma.listing.update.mock.calls[0][0].data).toMatchObject({
        district: null,
        isNegotiable: false,
        deliveryMode: 'DELIVERY',
      });
    });

    test.each([['SOLD'], ['BANNED'], ['DELETED']])(
      'statut %s refusé (réservé au serveur)',
      async (status) => {
        const res = await update({ status });

        expect(res.status).toBe(400);
        expect(mockPrisma.listing.update).not.toHaveBeenCalled();
      },
    );

    test('l’ancien prix envoyé par le client est ignoré', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(storedListing());

      await update({ previousPrice: 5000, title: 'Canapé gris' });

      expect(mockPrisma.listing.update.mock.calls[0][0].data).not.toHaveProperty('previousPrice');
    });

    test('annonce vendue : 409, rien n’est modifié', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(storedListing({ isSold: true, status: 'SOLD' }));

      const res = await update({ title: 'Canapé gris' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('LISTING_SOLD');
      expect(mockPrisma.listing.update).not.toHaveBeenCalled();
    });

    test('plus d’e-mail au vendeur à chaque modification', async () => {
      const { sendEmail } = require('../utils/emailService');
      mockPrisma.listing.findUnique.mockResolvedValue(storedListing());

      const res = await update({ title: 'Canapé gris', price: 900 });

      expect(res.status).toBe(200);
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/listings/:id (baisse de prix notifiée)', () => {
    const update = (body) =>
      request(buildApp())
        .put('/api/listings/listing-1')
        .set('Authorization', bearerFor(OWNER))
        .send(body);

    const notified = () => mockPrisma.notification.create.mock.calls.map(([{ data }]) => data);

    test('baisse : les personnes qui l’ont enregistrée sont prévenues, pas le vendeur', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(storedListing({ price: 1000, status: 'ACTIVE' }));
      mockPrisma.favorite.findMany.mockResolvedValue([{ userId: 'buyer-1' }, { userId: 'buyer-2' }]);

      const res = await update({ price: 800 });

      expect(res.status).toBe(200);
      expect(mockPrisma.favorite.findMany.mock.calls[0][0].where).toEqual({
        listingId: 'listing-1',
        userId: { not: OWNER },
      });
      expect(notified().map((data) => [data.userId, data.type, data.listingId])).toEqual([
        ['buyer-1', 'PRICE_DROP', 'listing-1'],
        ['buyer-2', 'PRICE_DROP', 'listing-1'],
      ]);
      expect(notified()[0].message).toMatch(/de 1\s000 DH à 800 DH/u);
    });

    test('déjà prévenue dans les 24 h : pas de nouvelle notification', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(storedListing({ price: 1000, status: 'ACTIVE' }));
      mockPrisma.favorite.findMany.mockResolvedValue([{ userId: 'buyer-1' }, { userId: 'buyer-2' }]);
      mockPrisma.notification.findMany.mockResolvedValue([{ userId: 'buyer-1' }]);

      await update({ price: 700 });

      const since = mockPrisma.notification.findMany.mock.calls[0][0].where.createdAt.gte;
      expect(Date.now() - since.getTime()).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
      expect(notified().map((data) => data.userId)).toEqual(['buyer-2']);
    });

    test.each([
      ['hausse de prix', { price: 1000, status: 'ACTIVE' }, { price: 1200 }],
      ['prix inchangé', { price: 1000, status: 'ACTIVE' }, { price: 1000 }],
      ['annonce masquée', { price: 1000, status: 'INACTIVE' }, { price: 800 }],
      ['masquée en même temps', { price: 1000, status: 'ACTIVE' }, { price: 800, status: 'INACTIVE' }],
      ['titre seulement', { price: 1000, status: 'ACTIVE' }, { title: 'Canapé gris' }],
    ])('%s : personne n’est prévenu', async (_, stored, body) => {
      mockPrisma.listing.findUnique.mockResolvedValue(storedListing(stored));
      mockPrisma.favorite.findMany.mockResolvedValue([{ userId: 'buyer-1' }]);

      const res = await update(body);

      expect(res.status).toBe(200);
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });

    test('erreur de lecture des favoris : la modification réussit quand même', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockPrisma.listing.findUnique.mockResolvedValue(storedListing({ price: 1000, status: 'ACTIVE' }));
      mockPrisma.favorite.findMany.mockRejectedValue(new Error('db down'));

      const res = await update({ price: 500 });

      expect(res.status).toBe(200);
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
      console.warn.mockRestore();
    });
  });

  describe('GET /api/listings/:id (vendeur)', () => {
    const detail = (seller = {}) => ({
      id: 'listing-1',
      title: 'Canapé',
      district: 'maarif',
      user: {
        id: OWNER,
        username: 'aminata',
        createdAt: new Date('2024-03-01T00:00:00Z'),
        totalRatings: 12,
        isIdentityVerified: true,
        responseTimeMinutes: 45,
        responseSampleCount: MIN_SAMPLES,
        phone: null,
        verifiedPhone: false,
        settings: null,
        ...seller,
      },
      images: [],
      ratings: [],
    });

    test('ancienneté, avis, identité vérifiée et temps de réponse', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(detail());

      const res = await request(buildApp()).get('/api/listings/listing-1');

      expect(res.status).toBe(200);
      expect(res.body.listing.user).toMatchObject({
        createdAt: '2024-03-01T00:00:00.000Z',
        totalRatings: 12,
        isIdentityVerified: true,
        responseTimeMinutes: 45,
      });
      expect(res.body.listing.user).not.toHaveProperty('responseSampleCount');
    });

    test('trop peu de réponses : temps de réponse non affiché', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(
        detail({ responseSampleCount: MIN_SAMPLES - 1 }),
      );

      const res = await request(buildApp()).get('/api/listings/listing-1');

      expect(res.body.listing.user.responseTimeMinutes).toBeNull();
    });

    test('photos lues dans l’ordre choisi par le vendeur', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(detail());

      await request(buildApp()).get('/api/listings/listing-1');

      const { include } = mockPrisma.listing.findUnique.mock.calls[0][0];
      expect(include.images.orderBy[0]).toEqual({ position: 'asc' });
    });
  });

  describe('GET /api/listings/:id/similar', () => {
    const card = (id) => ({ id, title: `Annonce ${id}`, price: 100, images: [] });

    test('annonce introuvable : 404', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(null);

      const res = await request(buildApp()).get('/api/listings/nope/similar');

      expect(res.status).toBe(404);
    });

    test('même quartier d’abord, puis le reste de la catégorie', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue({
        id: 'listing-1',
        categoryId: 'c1',
        city: 'casablanca',
        district: 'maarif',
      });
      mockPrisma.listing.findMany
        .mockResolvedValueOnce([card('a')])
        .mockResolvedValueOnce([card('b'), card('c')]);

      const res = await request(buildApp()).get('/api/listings/listing-1/similar?limit=3');

      expect(res.status).toBe(200);
      expect(res.body.listings.map((item) => item.id)).toEqual(['a', 'b', 'c']);

      const [nearby, others] = mockPrisma.listing.findMany.mock.calls.map(([args]) => args);
      expect(nearby.where).toMatchObject({
        status: 'ACTIVE',
        isSold: false,
        categoryId: 'c1',
        district: 'maarif',
        id: { not: 'listing-1' },
      });
      expect(nearby.take).toBe(3);
      expect(others.where.id).toEqual({ notIn: ['listing-1', 'a'] });
      expect(others.take).toBe(2);
      // Jamais de donnée privée du vendeur dans les cartes.
      expect(nearby.select).not.toHaveProperty('user');
    });

    test('sans quartier : une seule requête sur la catégorie', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue({
        id: 'listing-1',
        categoryId: 'c1',
        city: 'casablanca',
        district: null,
      });
      mockPrisma.listing.findMany.mockResolvedValue([card('a')]);

      await request(buildApp()).get('/api/listings/listing-1/similar');

      expect(mockPrisma.listing.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.listing.findMany.mock.calls[0][0].take).toBe(12);
    });

    test('limite plafonnée à 20', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue({ id: 'listing-1', categoryId: 'c1', district: null });
      mockPrisma.listing.findMany.mockResolvedValue([]);

      await request(buildApp()).get('/api/listings/listing-1/similar?limit=500');

      expect(mockPrisma.listing.findMany.mock.calls[0][0].take).toBe(20);
    });
  });

  describe('GET /api/filters', () => {
    test('quartiers de Casablanca, modes de remise et motifs de signalement', async () => {
      mockPrisma.category.findMany.mockResolvedValue([]);
      mockPrisma.listing.aggregate.mockResolvedValue({ _min: {}, _max: {}, _avg: {} });

      const res = await request(buildApp()).get('/api/filters');

      expect(res.status).toBe(200);
      const [casablanca] = res.body.data.locations;
      expect(casablanca.slug).toBe('casablanca');
      expect(casablanca.districts).toContainEqual({ slug: 'maarif', name: 'Maârif' });
      expect(res.body.data.deliveryModes).toEqual(['PICKUP', 'DELIVERY', 'BOTH']);
      expect(res.body.data.reportReasons).toContain('SCAM');
    });
  });
});
