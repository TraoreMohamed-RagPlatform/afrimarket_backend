jest.mock('../services/realtime', () => ({
  EVENTS: { NOTIFICATION: 'notification:new', MESSAGE: 'message:new' },
  emitToUser: jest.fn(() => true),
  disconnectUser: jest.fn(),
}));

const realtime = require('../services/realtime');
const { createNotification } = require('../services/notificationService');

describe('Événements temps réel déclenchés par le serveur', () => {
  beforeEach(() => jest.clearAllMocks());

  test('notification enregistrée : envoyée à son seul destinataire', async () => {
    const prisma = {
      notification: {
        create: jest.fn().mockResolvedValue({
          id: 'n1',
          title: 'Nouvel avis',
          message: 'Vous avez reçu 5/5',
          createdAt: new Date('2026-10-21T10:00:00Z'),
        }),
      },
    };

    await createNotification({
      prisma,
      userId: 'seller',
      actorId: 'buyer',
      type: 'RATING_RECEIVED',
      title: 'Nouvel avis',
      message: 'Vous avez reçu 5/5',
    });

    expect(realtime.emitToUser).toHaveBeenCalledWith('seller', 'notification:new', {
      id: 'n1',
      type: 'RATING_RECEIVED',
      title: 'Nouvel avis',
      message: 'Vous avez reçu 5/5',
      listingId: null,
      createdAt: new Date('2026-10-21T10:00:00Z'),
    });
  });

  test('notification non enregistrée : rien n’est envoyé', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const prisma = { notification: { create: jest.fn().mockRejectedValue(new Error('db')) } };

    await createNotification({ prisma, userId: 'seller', type: 'X', title: 't', message: 'm' });

    expect(realtime.emitToUser).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('sa propre action : ni notification ni événement', async () => {
    const prisma = { notification: { create: jest.fn() } };

    await createNotification({ prisma, userId: 'u1', actorId: 'u1', type: 'X', title: 't', message: 'm' });

    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });
});

describe('Message envoyé dans une conversation', () => {
  const express = require('express');
  const request = require('supertest');
  const { useTestJwtSecret, bearerFor } = require('./helpers/auth');

  test('l’autre participant reçoit « message:new », pas l’expéditeur', async () => {
    jest.resetModules();
    const mockPrisma = {
      conversation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c1',
          buyerId: 'alice',
          sellerId: 'bob',
          listing: { title: 'Vélo' },
          buyer: { id: 'alice', status: 'ACTIVE', email: 'a@test.local', username: 'alice' },
          seller: { id: 'bob', status: 'ACTIVE', email: 'b@test.local', username: 'bob' },
          messages: [],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      message: {
        create: jest.fn().mockResolvedValue({
          id: 'm1',
          content: 'Toujours disponible ?',
          senderId: 'alice',
          conversationId: 'c1',
          readAt: null,
          createdAt: new Date('2026-10-21T10:00:00Z'),
        }),
      },
      user: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
    };
    jest.doMock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockPrisma) }));
    jest.doMock('../lib/prisma', () => mockPrisma);
    jest.doMock('../utils/emailTemplates', () => ({ sendMessageReceivedEmail: jest.fn() }));
    jest.doMock('../services/responseTime', () => ({ recordReply: jest.fn() }));
    const mockedRealtime = require('../services/realtime');
    useTestJwtSecret();

    const app = express();
    app.use(express.json());
    app.use('/api/messages', require('../routes/message'));

    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', bearerFor('alice'))
      .send({ conversationId: 'c1', content: 'Toujours disponible ?' });

    expect(res.status).toBe(201);
    expect(mockedRealtime.emitToUser).toHaveBeenCalledTimes(1);
    expect(mockedRealtime.emitToUser).toHaveBeenCalledWith('bob', 'message:new', {
      conversationId: 'c1',
      messageId: 'm1',
      senderId: 'alice',
      content: 'Toujours disponible ?',
      createdAt: new Date('2026-10-21T10:00:00Z'),
    });
  });
});
