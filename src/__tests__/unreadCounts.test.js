const express = require('express');
const request = require('supertest');
const { useTestJwtSecret, bearerFor } = require('./helpers/auth');

// Contrôleurs anciens (leur propre PrismaClient) et nouveaux (lib/prisma) :
// le même faux pour les deux.
const mockPrisma = {
  message: { count: jest.fn(), updateMany: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
  conversation: { findUnique: jest.fn(), findMany: jest.fn() },
  notification: { count: jest.fn(), findMany: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
  user: { findUnique: jest.fn() },
  listing: { findUnique: jest.fn() },
  favorite: { findUnique: jest.fn(), create: jest.fn() },
};
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockPrisma) }));
jest.mock('../lib/prisma', () => mockPrisma);

const messageRoutes = require('../routes/message');
const notificationRoutes = require('../routes/notification');
const favoriteRoutes = require('../routes/favorite');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.set('io', { emit: jest.fn() });
  app.use('/api/messages', messageRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/favorites', favoriteRoutes);
  return app;
};

const as = (userId) => ({ Authorization: bearerFor(userId) });

describe('Messages non lus (B4)', () => {
  beforeAll(useTestJwtSecret);
  beforeEach(() => jest.clearAllMocks());

  test('compteur : messages reçus non lus, dans mes conversations', async () => {
    mockPrisma.message.count.mockResolvedValue(3);

    const res = await request(buildApp()).get('/api/messages/unread-count').set(as('u1'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 3 });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(mockPrisma.message.count).toHaveBeenCalledWith({
      where: {
        readAt: null,
        senderId: { not: 'u1' },
        conversation: { is: { participants: { has: 'u1' } } },
      },
    });
  });

  test('sans connexion : 401', async () => {
    const res = await request(buildApp()).get('/api/messages/unread-count');

    expect(res.status).toBe(401);
  });

  test('ouvrir une conversation marque comme lus les messages reçus (pas les miens)', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({ id: 'c1', participants: ['u1', 'u2'] });
    mockPrisma.message.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.message.findMany.mockResolvedValue([]);

    const res = await request(buildApp()).get('/api/messages/c1').set(as('u1'));

    expect(res.status).toBe(200);
    expect(mockPrisma.message.updateMany).toHaveBeenCalledWith({
      where: { conversationId: 'c1', senderId: { not: 'u1' }, readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  test('conversation d’autrui : 403, rien n’est marqué lu', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({ id: 'c1', participants: ['u2', 'u3'] });

    const res = await request(buildApp()).get('/api/messages/c1').set(as('u1'));

    expect(res.status).toBe(403);
    expect(mockPrisma.message.updateMany).not.toHaveBeenCalled();
  });

  test('liste des conversations : non lus par conversation', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([
      { id: 'c1', participants: ['u1', 'u2'], messages: [] },
      { id: 'c2', participants: ['u1', 'u3'], messages: [] },
    ]);
    mockPrisma.message.groupBy.mockResolvedValue([{ conversationId: 'c1', _count: { _all: 4 } }]);

    const res = await request(buildApp()).get('/api/messages/conversations').set(as('u1'));

    expect(res.body.map((c) => [c.id, c.unreadCount])).toEqual([
      ['c1', 4],
      ['c2', 0],
    ]);
  });
});

describe('Notifications (B4)', () => {
  beforeAll(useTestJwtSecret);
  beforeEach(() => jest.clearAllMocks());

  test('compteur des non lues de l’utilisateur connecté', async () => {
    mockPrisma.notification.count.mockResolvedValue(5);

    const res = await request(buildApp()).get('/api/notifications/unread-count').set(as('u1'));

    expect(res.body).toEqual({ count: 5 });
    expect(mockPrisma.notification.count).toHaveBeenCalledWith({ where: { userId: 'u1', read: false } });
  });

  test('liste : seulement les miennes, paginée', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([{ id: 'n1' }]);
    mockPrisma.notification.count.mockResolvedValue(21);

    const res = await request(buildApp()).get('/api/notifications?page=2').set(as('u1'));

    expect(res.status).toBe(200);
    const args = mockPrisma.notification.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: 'u1' });
    expect(args.skip).toBe(20);
    expect(res.body.pagination.pages).toBe(2);
  });

  test('marquer lue : uniquement la sienne (sinon 404)', async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(buildApp()).put('/api/notifications/n-autre/read').set(as('u1'));

    expect(res.status).toBe(404);
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'n-autre', userId: 'u1' },
      data: { read: true },
    });
  });

  test('tout marquer comme lu', async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 3 });

    const res = await request(buildApp()).put('/api/notifications/read-all').set(as('u1'));

    expect(res.body).toEqual({ updated: 3 });
  });

  describe('Sécurité : diffusion réservée aux administrateurs', () => {
    test('utilisateur ordinaire : 403, rien n’est diffusé', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ role: 'USER', status: 'ACTIVE' });
      const app = buildApp();

      const res = await request(app)
        .post('/api/notifications')
        .set(as('u1'))
        .send({ userId: 'u2', type: 'message', message: 'Votre compte est bloqué, cliquez ici' });

      expect(res.status).toBe(403);
      expect(app.get('io').emit).not.toHaveBeenCalled();
    });

    test('route de test sans connexion : 401', async () => {
      const app = buildApp();

      const res = await request(app).get('/api/notifications/test');

      expect(res.status).toBe(401);
      expect(app.get('io').emit).not.toHaveBeenCalled();
    });

    test('administrateur : diffusion possible', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ role: 'ADMIN', status: 'ACTIVE' });

      const res = await request(buildApp()).get('/api/notifications/test').set(as('admin'));

      expect(res.status).toBe(200);
    });
  });

  describe('Création automatique', () => {
    test('annonce enregistrée : le vendeur est notifié', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue({ id: 'l1', userId: 'seller-1' });
      mockPrisma.favorite.findUnique.mockResolvedValue(null);
      mockPrisma.favorite.create.mockResolvedValue({ id: 'f1', listing: { id: 'l1', title: 'Canapé' } });

      const res = await request(buildApp()).post('/api/favorites').set(as('buyer-1')).send({ listingId: 'l1' });

      expect(res.status).toBe(201);
      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'seller-1', type: 'LISTING_INTEREST', listingId: 'l1' }),
      });
    });

    test('son propre favori : aucune notification', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue({ id: 'l1', userId: 'seller-1' });
      mockPrisma.favorite.findUnique.mockResolvedValue(null);
      mockPrisma.favorite.create.mockResolvedValue({ id: 'f1', listing: { id: 'l1', title: 'Canapé' } });

      await request(buildApp()).post('/api/favorites').set(as('seller-1')).send({ listingId: 'l1' });

      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });

    test('notification ratée : le favori est quand même enregistré', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockPrisma.listing.findUnique.mockResolvedValue({ id: 'l1', userId: 'seller-1' });
      mockPrisma.favorite.findUnique.mockResolvedValue(null);
      mockPrisma.favorite.create.mockResolvedValue({ id: 'f1', listing: { id: 'l1', title: 'Canapé' } });
      mockPrisma.notification.create.mockRejectedValue(new Error('db down'));

      const res = await request(buildApp()).post('/api/favorites').set(as('buyer-1')).send({ listingId: 'l1' });

      expect(res.status).toBe(201);
      console.warn.mockRestore();
    });
  });
});
