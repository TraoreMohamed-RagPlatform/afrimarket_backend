const express = require('express');
const request = require('supertest');
const { useTestJwtSecret, bearerFor } = require('./helpers/auth');

const mockPrisma = {
  listing: { findUnique: jest.fn() },
  listingReport: { create: jest.fn() },
};
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockPrisma) }));

const listingRoutes = require('../routes/listing');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/listings', listingRoutes);
  return app;
};

const report = (app, body, userId = 'buyer-1') =>
  request(app)
    .post('/api/listings/listing-1/report')
    .set('Authorization', bearerFor(userId))
    .send(body);

describe('POST /api/listings/:id/report', () => {
  beforeAll(useTestJwtSecret);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'info').mockImplementation(() => {});
    mockPrisma.listing.findUnique.mockResolvedValue({ id: 'listing-1', userId: 'seller-1' });
    mockPrisma.listingReport.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'r1', reason: data.reason, status: 'OPEN', createdAt: new Date() }),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  test('sans token : 401', async () => {
    const res = await request(buildApp()).post('/api/listings/listing-1/report').send({ reason: 'SCAM' });

    expect(res.status).toBe(401);
    expect(mockPrisma.listingReport.create).not.toHaveBeenCalled();
  });

  test('signalement enregistré : 201', async () => {
    const res = await report(buildApp(), { reason: 'SCAM', details: '  Demande un virement  ' });

    expect(res.status).toBe(201);
    expect(res.body.report).toMatchObject({ id: 'r1', reason: 'SCAM', status: 'OPEN' });
    expect(mockPrisma.listingReport.create.mock.calls[0][0].data).toEqual({
      listingId: 'listing-1',
      reporterId: 'buyer-1',
      reason: 'SCAM',
      details: 'Demande un virement',
    });
  });

  test('l’auteur est toujours l’utilisateur connecté, jamais le corps de la requête', async () => {
    await report(buildApp(), { reason: 'SPAM', reporterId: 'someone-else' });

    expect(mockPrisma.listingReport.create.mock.calls[0][0].data.reporterId).toBe('buyer-1');
  });

  test.each([
    ['motif absent', {}],
    ['motif inconnu', { reason: 'I_DONT_LIKE_IT' }],
    ['détail trop long', { reason: 'OTHER', details: 'x'.repeat(501) }],
    ['détail non texte', { reason: 'OTHER', details: { html: '<b>' } }],
  ])('%s : 400', async (_name, body) => {
    const res = await report(buildApp(), body);

    expect(res.status).toBe(400);
    expect(mockPrisma.listingReport.create).not.toHaveBeenCalled();
  });

  test('annonce introuvable : 404', async () => {
    mockPrisma.listing.findUnique.mockResolvedValue(null);

    const res = await report(buildApp(), { reason: 'SCAM' });

    expect(res.status).toBe(404);
  });

  test('sa propre annonce : 400', async () => {
    const res = await report(buildApp(), { reason: 'SCAM' }, 'seller-1');

    expect(res.status).toBe(400);
    expect(mockPrisma.listingReport.create).not.toHaveBeenCalled();
  });

  test('déjà signalée par cette personne : 409', async () => {
    mockPrisma.listingReport.create.mockRejectedValue(Object.assign(new Error('Unique'), { code: 'P2002' }));

    const res = await report(buildApp(), { reason: 'SCAM' });

    expect(res.status).toBe(409);
  });

  test('débit limité par utilisateur (10 par heure)', async () => {
    const app = buildApp();

    for (let i = 0; i < 10; i += 1) {
      expect((await report(app, { reason: 'SPAM' }, 'spammer')).status).toBe(201);
    }

    expect((await report(app, { reason: 'SPAM' }, 'spammer')).status).toBe(429);
    expect((await report(app, { reason: 'SPAM' }, 'buyer-2')).status).toBe(201);
  });
});
