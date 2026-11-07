const express = require('express');
const request = require('supertest');
const { useTestJwtSecret, bearerFor } = require('./helpers/auth');

// Bloquer / signaler une personne (comme Messenger) et effets du blocage :
// messagerie refusée dans les deux sens, annonces masquées.

const mockPrisma = {
  user: { findUnique: jest.fn() },
  userBlock: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
  userReport: { create: jest.fn() },
  conversation: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  message: { count: jest.fn(), create: jest.fn(), groupBy: jest.fn() },
  listing: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
};
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockPrisma) }));
jest.mock('../lib/prisma', () => mockPrisma);
jest.mock('../utils/emailTemplates', () => ({ sendMessageReceivedEmail: jest.fn() }));
jest.mock('../services/responseTime', () => ({ recordReply: jest.fn() }));
jest.mock('../services/realtime', () => ({
  EVENTS: { MESSAGE: 'message:new', NOTIFICATION: 'notification:new' },
  emitToUser: jest.fn(),
}));

const userRoutes = require('../routes/user');
const messageRoutes = require('../routes/message');
const listingRoutes = require('../routes/listing');
const { REPORT_MESSAGES_COPIED } = require('../config/safetyOptions');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/users', userRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/listings', listingRoutes);
  return app;
};

const as = (userId) => ({ Authorization: bearerFor(userId) });

const person = (id, overrides = {}) => ({
  id,
  fullName: `Nom ${id}`,
  username: id,
  avatar: `https://cdn.test/${id}.jpg`,
  isIdentityVerified: false,
  status: 'ACTIVE',
  ...overrides,
});

beforeAll(useTestJwtSecret);
beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.userBlock.findMany.mockResolvedValue([]);
  mockPrisma.userBlock.findFirst.mockResolvedValue(null);
  mockPrisma.userBlock.findUnique.mockResolvedValue(null);
  mockPrisma.message.count.mockResolvedValue(0);
});

describe('Bloquer / débloquer', () => {
  test('bloquer : 201, puis déjà bloquée : 200, même résultat', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(person('bob'));
    mockPrisma.userBlock.create
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));

    const first = await request(buildApp()).post('/api/users/me/blocks').set(as('alice')).send({ userId: 'bob' });
    const again = await request(buildApp()).post('/api/users/me/blocks').set(as('alice')).send({ userId: 'bob' });

    expect([first.status, again.status]).toEqual([201, 200]);
    expect(mockPrisma.userBlock.create).toHaveBeenCalledWith({ data: { blockerId: 'alice', blockedId: 'bob' } });
  });

  test('se bloquer soi-même : 400', async () => {
    const res = await request(buildApp()).post('/api/users/me/blocks').set(as('alice')).send({ userId: 'alice' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CANNOT_BLOCK_SELF');
    expect(mockPrisma.userBlock.create).not.toHaveBeenCalled();
  });

  test.each([
    ['inconnu', null],
    ['supprimé', person('bob', { status: 'DELETED' })],
  ])('compte %s : 404', async (_, found) => {
    mockPrisma.user.findUnique.mockResolvedValue(found);

    const res = await request(buildApp()).post('/api/users/me/blocks').set(as('alice')).send({ userId: 'bob' });

    expect(res.status).toBe(404);
  });

  test.each([[{}], [{ userId: '../x' }], [{ userId: 12 }]])('identifiant invalide %j : 400', async (body) => {
    const res = await request(buildApp()).post('/api/users/me/blocks').set(as('alice')).send(body);

    expect(res.status).toBe(400);
  });

  test('sans connexion : 401', async () => {
    const res = await request(buildApp()).post('/api/users/me/blocks').send({ userId: 'bob' });

    expect(res.status).toBe(401);
  });

  test('débloquer : 204, seulement mon blocage', async () => {
    mockPrisma.userBlock.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(buildApp()).delete('/api/users/me/blocks/bob').set(as('alice'));

    expect(res.status).toBe(204);
    expect(mockPrisma.userBlock.deleteMany).toHaveBeenCalledWith({
      where: { blockerId: 'alice', blockedId: 'bob' },
    });
  });

  test('liste : les plus récentes, compte supprimé sans nom ni photo', async () => {
    mockPrisma.userBlock.findMany.mockResolvedValue([
      { createdAt: new Date('2026-11-07T10:00:00Z'), blocked: person('bob') },
      { createdAt: new Date('2026-11-06T10:00:00Z'), blocked: person('carl', { status: 'DELETED' }) },
    ]);

    const res = await request(buildApp()).get('/api/users/me/blocks').set(as('alice'));

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(mockPrisma.userBlock.findMany.mock.calls[0][0].where).toEqual({ blockerId: 'alice' });
    expect(res.body.blocks).toEqual([
      { userId: 'bob', name: 'Nom bob', avatar: 'https://cdn.test/bob.jpg', blockedAt: '2026-11-07T10:00:00.000Z' },
      { userId: 'carl', name: null, avatar: null, blockedAt: '2026-11-06T10:00:00.000Z' },
    ]);
  });
});

describe('Signaler une personne', () => {
  let invalidCase = 0;
  const report = (userId, target, body) =>
    request(buildApp()).post(`/api/users/${target}/report`).set(as(userId)).send(body);

  const conversationBetween = (buyerId, sellerId, count = 3) => ({
    buyerId,
    sellerId,
    // Du plus récent au plus ancien (comme la requête).
    messages: Array.from({ length: count }, (_, i) => ({
      senderId: i % 2 === 0 ? sellerId : buyerId,
      content: `message ${count - i}`,
      createdAt: new Date(Date.UTC(2026, 10, 7, 10, count - i)),
    })),
  });

  test('depuis une discussion : derniers messages copiés, dans l’ordre', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(person('bob'));
    mockPrisma.conversation.findUnique.mockResolvedValue(conversationBetween('alice', 'bob'));
    mockPrisma.userReport.create.mockResolvedValue({});

    const res = await report('alice', 'bob', { reason: 'SCAM', details: '  Demande un acompte  ', conversationId: 'c1' });

    expect(res.status).toBe(201);
    const { data } = mockPrisma.userReport.create.mock.calls[0][0];
    expect(data).toMatchObject({
      reporterId: 'alice',
      reportedId: 'bob',
      conversationId: 'c1',
      reason: 'SCAM',
      details: 'Demande un acompte',
    });
    expect(data.messages.map((m) => [m.content, m.fromReported])).toEqual([
      ['message 1', true],
      ['message 2', false],
      ['message 3', true],
    ]);
    expect(mockPrisma.conversation.findUnique.mock.calls[0][0].select.messages.take).toBe(REPORT_MESSAGES_COPIED);
  });

  test('sans discussion : aucun message copié', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(person('bob'));
    mockPrisma.userReport.create.mockResolvedValue({});

    const res = await report('alice', 'bob', { reason: 'FAKE_PROFILE' });

    expect(res.status).toBe(201);
    expect(mockPrisma.userReport.create.mock.calls[0][0].data).toMatchObject({
      conversationId: null,
      details: null,
      messages: [],
    });
  });

  test.each([
    ['discussion d’autres personnes', conversationBetween('carl', 'dan')],
    ['discussion avec quelqu’un d’autre', conversationBetween('alice', 'carl')],
    ['discussion inconnue', null],
  ])('%s : 404, rien d’enregistré', async (_, conversation) => {
    mockPrisma.user.findUnique.mockResolvedValue(person('bob'));
    mockPrisma.conversation.findUnique.mockResolvedValue(conversation);

    const res = await report('alice', 'bob', { reason: 'SPAM', conversationId: 'c1' });

    expect(res.status).toBe(404);
    expect(mockPrisma.userReport.create).not.toHaveBeenCalled();
  });

  test('déjà signalée depuis cette discussion : 409', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(person('bob'));
    mockPrisma.conversation.findUnique.mockResolvedValue(conversationBetween('alice', 'bob'));
    mockPrisma.userReport.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

    const res = await report('alice', 'bob', { reason: 'HARASSMENT', conversationId: 'c1' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_REPORTED');
  });

  test('se signaler soi-même : 400 ; inconnue : 404', async () => {
    const self = await report('erin', 'erin', { reason: 'SPAM' });
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const unknown = await report('erin', 'bob', { reason: 'SPAM' });

    expect([self.status, unknown.status]).toEqual([400, 404]);
  });

  test.each([
    [{ reason: 'INCONNU' }],
    [{}],
    [{ reason: 'SPAM', details: 'x'.repeat(501) }],
    [{ reason: 'SPAM', conversationId: '../c1' }],
  ])('données invalides %j : 400', async (body) => {
    // Un compte par cas : la limite de signalements est par compte.
    invalidCase += 1;
    const res = await report(`reporter${invalidCase}`, 'bob', body);

    expect(res.status).toBe(400);
    expect(mockPrisma.userReport.create).not.toHaveBeenCalled();
  });
});

describe('Messagerie avec une personne bloquée', () => {
  const conversation = (overrides = {}) => ({
    id: 'c1',
    buyerId: 'alice',
    sellerId: 'bob',
    lastMessageAt: new Date('2026-11-07T10:00:00Z'),
    createdAt: new Date('2026-11-07T09:00:00Z'),
    listing: { id: 'l1', title: 'Vélo', price: 900, status: 'ACTIVE', isSold: false, images: [] },
    buyer: { ...person('alice'), email: 'a@test.local' },
    seller: { ...person('bob'), email: 'b@test.local' },
    messages: [],
    ...overrides,
  });

  test.each([
    ['je l’ai bloquée', { blockerId: 'alice', blockedId: 'bob' }],
    ['elle m’a bloquée', { blockerId: 'bob', blockedId: 'alice' }],
  ])('envoyer : refusé (%s), même réponse qu’un compte indisponible', async (_, block) => {
    mockPrisma.conversation.findUnique.mockResolvedValue(conversation());
    mockPrisma.userBlock.findFirst.mockResolvedValue({ id: 'b1', ...block });

    const res = await request(buildApp())
      .post('/api/messages')
      .set(as('alice'))
      .send({ conversationId: 'c1', content: 'Bonjour' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Recipient unavailable', code: 'RECIPIENT_UNAVAILABLE' });
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
    expect(mockPrisma.userBlock.findFirst.mock.calls[0][0].where).toEqual({
      OR: [
        { blockerId: 'alice', blockedId: 'bob' },
        { blockerId: 'bob', blockedId: 'alice' },
      ],
    });
  });

  test('nouvelle discussion avec une personne bloquée : refusée', async () => {
    mockPrisma.listing.findUnique.mockResolvedValue({
      id: 'l1',
      userId: 'bob',
      status: 'ACTIVE',
      isSold: false,
      user: { status: 'ACTIVE' },
    });
    mockPrisma.conversation.findUnique.mockResolvedValue(null);
    mockPrisma.userBlock.findFirst.mockResolvedValue({ id: 'b1' });

    const res = await request(buildApp())
      .post('/api/messages/conversations')
      .set(as('alice'))
      .send({ listingId: 'l1' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RECIPIENT_UNAVAILABLE');
  });

  test('en-tête : « bloquée par moi », plus de réponse possible', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(conversation());
    mockPrisma.userBlock.findMany.mockResolvedValue([{ blockerId: 'alice', blockedId: 'bob' }]);

    const res = await request(buildApp()).get('/api/messages/conversations/c1').set(as('alice'));

    expect(res.status).toBe(200);
    expect(res.body.blockedByMe).toBe(true);
    expect(res.body.otherUser.canReceiveMessages).toBe(false);
  });

  test('bloquée par l’autre : ne peut plus écrire, sans savoir pourquoi', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(conversation());
    mockPrisma.userBlock.findMany.mockResolvedValue([{ blockerId: 'bob', blockedId: 'alice' }]);

    const res = await request(buildApp()).get('/api/messages/conversations/c1').set(as('alice'));

    expect(res.body.blockedByMe).toBe(false);
    expect(res.body.otherUser.canReceiveMessages).toBe(false);
  });

  test('liste : état de blocage par discussion, en une requête', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([
      conversation(),
      conversation({ id: 'c2', sellerId: 'carl', seller: { ...person('carl'), email: 'c@test.local' } }),
    ]);
    mockPrisma.message.groupBy.mockResolvedValue([]);
    mockPrisma.userBlock.findMany.mockResolvedValue([{ blockerId: 'alice', blockedId: 'bob' }]);

    const res = await request(buildApp()).get('/api/messages/conversations').set(as('alice'));

    expect(res.status).toBe(200);
    expect(res.body.conversations.map((c) => [c.id, c.blockedByMe, c.otherUser.canReceiveMessages])).toEqual([
      ['c1', true, false],
      ['c2', false, true],
    ]);
    expect(mockPrisma.userBlock.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('Annonces des personnes bloquées', () => {
  test('fil, connectée : annonces des personnes bloquées (deux sens) masquées', async () => {
    mockPrisma.userBlock.findMany.mockResolvedValue([
      { blockerId: 'alice', blockedId: 'bob' },
      { blockerId: 'carl', blockedId: 'alice' },
    ]);
    mockPrisma.listing.findMany.mockResolvedValue([]);
    mockPrisma.listing.count.mockResolvedValue(0);

    const res = await request(buildApp()).get('/api/listings').set(as('alice'));

    expect(res.status).toBe(200);
    expect(mockPrisma.listing.findMany.mock.calls[0][0].where.userId).toEqual({ notIn: ['bob', 'carl'] });
  });

  test('fil, visiteur : aucun filtre, aucune lecture des blocages', async () => {
    mockPrisma.listing.findMany.mockResolvedValue([]);
    mockPrisma.listing.count.mockResolvedValue(0);

    await request(buildApp()).get('/api/listings');

    expect(mockPrisma.listing.findMany.mock.calls[0][0].where).not.toHaveProperty('userId');
    expect(mockPrisma.userBlock.findMany).not.toHaveBeenCalled();
  });

  test('détail d’une annonce d’une personne bloquée : 404', async () => {
    mockPrisma.listing.findUnique.mockResolvedValue({
      id: 'l1',
      userId: 'bob',
      status: 'ACTIVE',
      user: { id: 'bob', settings: null },
    });
    mockPrisma.userBlock.findFirst.mockResolvedValue({ id: 'b1' });

    const res = await request(buildApp()).get('/api/listings/l1').set(as('alice'));

    expect(res.status).toBe(404);
  });

  test('annonces similaires : sans celles des personnes bloquées', async () => {
    mockPrisma.listing.findUnique.mockResolvedValue({ id: 'l1', categoryId: 'c1', city: 'casablanca', district: null });
    mockPrisma.userBlock.findMany.mockResolvedValue([{ blockerId: 'alice', blockedId: 'bob' }]);
    mockPrisma.listing.findMany.mockResolvedValue([]);

    const res = await request(buildApp()).get('/api/listings/l1/similar').set(as('alice'));

    expect(res.status).toBe(200);
    expect(mockPrisma.listing.findMany.mock.calls[0][0].where.userId).toEqual({ notIn: ['bob'] });
  });
});
