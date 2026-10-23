const express = require('express');
const request = require('supertest');
const { useTestJwtSecret, bearerFor } = require('./helpers/auth');

// Onglet Notifications : liste paginée, « vue » / « lue », suppression.

const mockPrisma = {
  notification: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  user: { findUnique: jest.fn() },
};
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockPrisma) }));
jest.mock('../lib/prisma', () => mockPrisma);

const notificationRoutes = require('../routes/notification');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', notificationRoutes);
  return app;
};

const as = (userId) => ({ Authorization: bearerFor(userId) });

const row = (id, overrides = {}) => ({
  id,
  type: 'LISTING_INTEREST',
  title: 'Votre annonce intéresse',
  message: 'Quelqu’un a enregistré votre annonce « Vélo ».',
  read: false,
  seenAt: null,
  createdAt: new Date('2026-10-23T09:00:00Z'),
  listing: {
    id: 'l1',
    title: 'Vélo',
    status: 'ACTIVE',
    isSold: false,
    images: [{ url: '/uploads/velo.jpg' }],
  },
  ...overrides,
});

beforeAll(useTestJwtSecret);
beforeEach(() => jest.clearAllMocks());

describe('GET /api/notifications', () => {
  test('sans connexion : 401', async () => {
    const res = await request(buildApp()).get('/api/notifications');

    expect(res.status).toBe(401);
  });

  test('forme : type, lue, vue, annonce (photo principale), jamais d’autre utilisateur', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([
      row('n2', { seenAt: new Date() }),
      row('n1', { read: true, seenAt: new Date(), listing: null, type: 'SYSTEM' }),
      row('n0', { listing: { id: 'l2', title: 'Lampe', status: 'ACTIVE', isSold: true, images: [] } }),
    ]);

    const res = await request(buildApp()).get('/api/notifications').set(as('u1'));

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const args = mockPrisma.notification.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: 'u1' });
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(args.take).toBe(21);
    const [first, system, sold] = res.body.notifications;
    expect(first).toEqual({
      id: 'n2',
      type: 'LISTING_INTEREST',
      title: 'Votre annonce intéresse',
      message: 'Quelqu’un a enregistré votre annonce « Vélo ».',
      read: false,
      seen: true,
      createdAt: '2026-10-23T09:00:00.000Z',
      listing: { id: 'l1', title: 'Vélo', status: 'ACTIVE', photo: '/uploads/velo.jpg' },
    });
    expect(system).toMatchObject({ read: true, listing: null });
    expect(sold.seen).toBe(false);
    expect(sold.listing).toEqual({ id: 'l2', title: 'Lampe', status: 'SOLD', photo: null });
    expect(res.body.nextCursor).toBeNull();
  });

  test('pagination : une de plus est lue ; page suivante par curseur', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([row('n3'), row('n2'), row('n1')]);

    const res = await request(buildApp()).get('/api/notifications?limit=2').set(as('u1'));

    expect(mockPrisma.notification.findMany.mock.calls[0][0].take).toBe(3);
    expect(res.body.notifications.map((n) => n.id)).toEqual(['n3', 'n2']);
    expect(res.body.nextCursor).toBe('n2');

    mockPrisma.notification.findFirst.mockResolvedValue({ id: 'n2' });
    mockPrisma.notification.findMany.mockResolvedValue([row('n1')]);
    const next = await request(buildApp()).get('/api/notifications?cursor=n2').set(as('u1'));

    expect(mockPrisma.notification.findFirst.mock.calls[0][0].where).toEqual({ id: 'n2', userId: 'u1' });
    expect(mockPrisma.notification.findMany.mock.calls[1][0]).toMatchObject({ cursor: { id: 'n2' }, skip: 1 });
    expect(next.body.nextCursor).toBeNull();
  });

  test('curseur d’une notification d’autrui : 400', async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(null);

    const res = await request(buildApp()).get('/api/notifications?cursor=n-autre').set(as('u1'));

    expect(res.status).toBe(400);
    expect(mockPrisma.notification.findMany).not.toHaveBeenCalled();
  });

  test.each(['?limit=0', '?limit=51', '?cursor=../x'])('paramètre invalide %s : 400', async (query) => {
    const res = await request(buildApp()).get(`/api/notifications${query}`).set(as('u1'));

    expect(res.status).toBe(400);
  });
});

describe('Vue, lue, suppression', () => {
  test('onglet ouvert : toutes mes notifications pas vues deviennent vues', async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 4 });

    const res = await request(buildApp()).put('/api/notifications/seen').set(as('u1'));

    expect(res.body).toEqual({ updated: 4 });
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', seenAt: null },
      data: { seenAt: expect.any(Date) },
    });
  });

  test('touchée : lue, et vue si elle ne l’était pas', async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(buildApp()).put('/api/notifications/n1/read').set(as('u1'));

    expect(res.status).toBe(200);
    expect(mockPrisma.notification.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'n1', userId: 'u1' },
      data: { read: true },
    });
    expect(mockPrisma.notification.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'n1', userId: 'u1', seenAt: null },
      data: { seenAt: expect.any(Date) },
    });
  });

  test('tout lu : lues et vues', async () => {
    mockPrisma.notification.updateMany.mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 1 });

    const res = await request(buildApp()).put('/api/notifications/read-all').set(as('u1'));

    expect(res.body).toEqual({ updated: 2 });
    expect(mockPrisma.notification.updateMany).toHaveBeenNthCalledWith(2, {
      where: { userId: 'u1', seenAt: null },
      data: { seenAt: expect.any(Date) },
    });
  });

  test('supprimer la mienne : 204', async () => {
    mockPrisma.notification.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(buildApp()).delete('/api/notifications/n1').set(as('u1'));

    expect(res.status).toBe(204);
    expect(mockPrisma.notification.deleteMany).toHaveBeenCalledWith({ where: { id: 'n1', userId: 'u1' } });
  });

  test('supprimer celle d’un autre : 404', async () => {
    mockPrisma.notification.deleteMany.mockResolvedValue({ count: 0 });

    const res = await request(buildApp()).delete('/api/notifications/n-autre').set(as('u1'));

    expect(res.status).toBe(404);
  });

  test.each([
    ['put', '/api/notifications/..%2Fx/read'],
    ['delete', '/api/notifications/a%20b'],
  ])('identifiant invalide (%s) : 400', async (method, url) => {
    const res = await request(buildApp())[method](url).set(as('u1'));

    expect(res.status).toBe(400);
    expect(mockPrisma.notification.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.notification.deleteMany).not.toHaveBeenCalled();
  });

  test('sans connexion : 401 partout', async () => {
    const app = buildApp();
    const responses = await Promise.all([
      request(app).put('/api/notifications/seen'),
      request(app).put('/api/notifications/n1/read'),
      request(app).delete('/api/notifications/n1'),
    ]);

    expect(responses.map((r) => r.status)).toEqual([401, 401, 401]);
  });
});
