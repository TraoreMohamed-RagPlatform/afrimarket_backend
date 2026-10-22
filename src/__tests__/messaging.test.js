const express = require('express');
const request = require('supertest');
const { useTestJwtSecret, bearerFor } = require('./helpers/auth');

// Messagerie : une discussion par annonce et par acheteur, texte seul.

const mockPrisma = {
  listing: { findUnique: jest.fn() },
  conversation: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  message: {
    count: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    groupBy: jest.fn(),
    delete: jest.fn(),
  },
};
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockPrisma) }));
jest.mock('../lib/prisma', () => mockPrisma);
jest.mock('../utils/emailTemplates', () => ({ sendMessageReceivedEmail: jest.fn() }));
jest.mock('../services/responseTime', () => ({ recordReply: jest.fn() }));
jest.mock('../services/realtime', () => ({
  EVENTS: { MESSAGE: 'message:new', NOTIFICATION: 'notification:new' },
  emitToUser: jest.fn(),
}));

const { sendMessageReceivedEmail } = require('../utils/emailTemplates');
const { emitToUser } = require('../services/realtime');
const messageRoutes = require('../routes/message');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/messages', messageRoutes);
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

/** Discussion telle que lue par le contrôleur (résumé). */
const summaryRow = (overrides = {}) => ({
  id: 'c1',
  buyerId: 'buyer',
  sellerId: 'seller',
  lastMessageAt: new Date('2026-10-21T10:00:00Z'),
  createdAt: new Date('2026-10-21T09:00:00Z'),
  listing: {
    id: 'l1',
    title: 'Vélo de ville',
    price: 900,
    status: 'ACTIVE',
    isSold: false,
    images: [{ url: 'https://cdn.test/velo.jpg' }],
  },
  buyer: person('buyer'),
  seller: person('seller'),
  messages: [],
  ...overrides,
});

const listingRow = (overrides = {}) => ({
  id: 'l1',
  userId: 'seller',
  status: 'ACTIVE',
  isSold: false,
  user: { status: 'ACTIVE' },
  ...overrides,
});

beforeAll(useTestJwtSecret);
beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.message.count.mockResolvedValue(0);
});

describe('POST /api/messages/conversations : ouvrir une discussion', () => {
  const start = (userId, body) =>
    request(buildApp()).post('/api/messages/conversations').set(as(userId)).send(body);

  test('sans connexion : 401', async () => {
    const res = await request(buildApp()).post('/api/messages/conversations').send({ listingId: 'l1' });

    expect(res.status).toBe(401);
  });

  test.each([
    ['absent', {}],
    ['objet', { listingId: { not: 'x' } }],
    ['caractères interdits', { listingId: '../l1' }],
  ])('annonce invalide (%s) : 400', async (_label, body) => {
    const res = await start('buyer', body);

    expect(res.status).toBe(400);
    expect(mockPrisma.listing.findUnique).not.toHaveBeenCalled();
  });

  test('annonce inconnue : 404', async () => {
    mockPrisma.listing.findUnique.mockResolvedValue(null);

    const res = await start('buyer', { listingId: 'l1' });

    expect(res.status).toBe(404);
  });

  test('annonce masquée d’un autre : 404 (comme son détail)', async () => {
    mockPrisma.listing.findUnique.mockResolvedValue(listingRow({ status: 'INACTIVE' }));

    const res = await start('buyer', { listingId: 'l1' });

    expect(res.status).toBe(404);
    expect(mockPrisma.conversation.create).not.toHaveBeenCalled();
  });

  test('sa propre annonce : 400, aucune discussion', async () => {
    mockPrisma.listing.findUnique.mockResolvedValue(listingRow());

    const res = await start('seller', { listingId: 'l1' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OWN_LISTING');
    expect(mockPrisma.conversation.create).not.toHaveBeenCalled();
  });

  test('discussion déjà ouverte : 200, la même, rien de créé', async () => {
    mockPrisma.listing.findUnique.mockResolvedValue(listingRow());
    mockPrisma.conversation.findUnique.mockResolvedValue(summaryRow());
    mockPrisma.message.count.mockResolvedValue(2);

    const res = await start('buyer', { listingId: 'l1' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'c1', role: 'buying', unreadCount: 2 });
    expect(mockPrisma.conversation.findUnique.mock.calls[0][0].where).toEqual({
      listingId_buyerId: { listingId: 'l1', buyerId: 'buyer' },
    });
    expect(mockPrisma.conversation.create).not.toHaveBeenCalled();
  });

  test('discussion déjà ouverte sur une annonce vendue : toujours accessible', async () => {
    mockPrisma.listing.findUnique.mockResolvedValue(listingRow({ status: 'SOLD', isSold: true }));
    mockPrisma.conversation.findUnique.mockResolvedValue(summaryRow());

    const res = await start('buyer', { listingId: 'l1' });

    expect(res.status).toBe(200);
  });

  test.each([
    ['vendue (statut)', { status: 'SOLD' }],
    ['vendue (isSold)', { isSold: true }],
  ])('nouvelle discussion sur une annonce %s : 409', async (_label, overrides) => {
    mockPrisma.listing.findUnique.mockResolvedValue(listingRow(overrides));
    mockPrisma.conversation.findUnique.mockResolvedValue(null);

    const res = await start('buyer', { listingId: 'l1' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LISTING_UNAVAILABLE');
    expect(mockPrisma.conversation.create).not.toHaveBeenCalled();
  });

  test.each(['SUSPENDED', 'DELETED'])('vendeur %s : 409', async (status) => {
    mockPrisma.listing.findUnique.mockResolvedValue(listingRow({ user: { status } }));
    mockPrisma.conversation.findUnique.mockResolvedValue(null);

    const res = await start('buyer', { listingId: 'l1' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RECIPIENT_UNAVAILABLE');
  });

  test('création : acheteur = moi, vendeur = auteur de l’annonce (jamais ceux envoyés)', async () => {
    mockPrisma.listing.findUnique.mockResolvedValue(listingRow({ status: 'RESERVED' }));
    mockPrisma.conversation.findUnique.mockResolvedValue(null);
    mockPrisma.conversation.create.mockResolvedValue(summaryRow({ lastMessageAt: null }));

    const res = await start('buyer', { listingId: 'l1', buyerId: 'pirate', sellerId: 'pirate' });

    expect(res.status).toBe(201);
    expect(mockPrisma.conversation.create.mock.calls[0][0].data).toEqual({
      listingId: 'l1',
      buyerId: 'buyer',
      sellerId: 'seller',
    });
    expect(res.body).toMatchObject({
      role: 'buying',
      listing: { id: 'l1', title: 'Vélo de ville', price: 900, status: 'ACTIVE', photo: 'https://cdn.test/velo.jpg' },
      otherUser: { id: 'seller', name: 'Nom seller', canReceiveMessages: true },
      lastMessage: null,
      unreadCount: 0,
    });
  });

  test('deux demandes en même temps : la discussion créée par l’autre est renvoyée', async () => {
    mockPrisma.listing.findUnique.mockResolvedValue(listingRow());
    mockPrisma.conversation.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(summaryRow());
    mockPrisma.conversation.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

    const res = await start('buyer', { listingId: 'l1' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('c1');
  });
});

describe('POST /api/messages : envoyer un message', () => {
  const conversationRow = (overrides = {}) => ({
    id: 'c1',
    buyerId: 'buyer',
    sellerId: 'seller',
    listing: { title: 'Vélo de ville' },
    buyer: { id: 'buyer', status: 'ACTIVE', email: 'buyer@test.local', username: 'buyer' },
    seller: { id: 'seller', status: 'ACTIVE', email: 'seller@test.local', username: 'seller' },
    messages: [{ senderId: 'seller', createdAt: new Date('2026-10-21T09:00:00Z') }],
    ...overrides,
  });
  const created = (content) => ({
    id: 'm1',
    content,
    senderId: 'buyer',
    conversationId: 'c1',
    createdAt: new Date('2026-10-21T10:00:00Z'),
    readAt: null,
  });
  const send = (userId, body) => request(buildApp()).post('/api/messages').set(as(userId)).send(body);

  test.each([
    ['vide', ''],
    ['espaces seulement', '   \n '],
    ['trop long', 'a'.repeat(1001)],
    ['pas un texte', { $gt: '' }],
    ['nombre', 42],
  ])('message %s : 400, rien d’envoyé', async (_label, content) => {
    const res = await send('buyer', { conversationId: 'c1', content });

    expect(res.status).toBe(400);
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
  });

  test('pas dans la discussion : 404, rien d’envoyé', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(conversationRow({ buyerId: 'x', sellerId: 'y' }));

    const res = await send('buyer', { conversationId: 'c1', content: 'Bonjour' });

    expect(res.status).toBe(404);
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
  });

  test('discussion inconnue : 404', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(null);

    const res = await send('buyer', { conversationId: 'c1', content: 'Bonjour' });

    expect(res.status).toBe(404);
  });

  test('destinataire suspendu : 409, rien d’envoyé', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(
      conversationRow({ seller: { id: 'seller', status: 'SUSPENDED', email: 's@test.local', username: 's' } }),
    );

    const res = await send('buyer', { conversationId: 'c1', content: 'Bonjour' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RECIPIENT_UNAVAILABLE');
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
  });

  test('envoyé : texte nettoyé, discussion remontée, temps réel et e-mail au seul destinataire', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(conversationRow());
    mockPrisma.message.create.mockImplementation(({ data }) => Promise.resolve(created(data.content)));
    mockPrisma.conversation.update.mockResolvedValue({});

    const res = await send('buyer', { conversationId: 'c1', content: '  Toujours disponible ?  ' });

    expect(res.status).toBe(201);
    expect(mockPrisma.message.create.mock.calls[0][0].data).toEqual({
      content: 'Toujours disponible ?',
      senderId: 'buyer',
      conversationId: 'c1',
    });
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { lastMessageAt: new Date('2026-10-21T10:00:00Z') },
    });
    expect(emitToUser).toHaveBeenCalledTimes(1);
    expect(emitToUser).toHaveBeenCalledWith('seller', 'message:new', expect.objectContaining({
      conversationId: 'c1',
      messageId: 'm1',
      senderId: 'buyer',
    }));
    expect(sendMessageReceivedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'seller' }),
      expect.objectContaining({ id: 'buyer' }),
      { content: 'Toujours disponible ?', conversationId: 'c1' },
      'Vélo de ville',
    );
    expect(res.body).toEqual({
      id: 'm1',
      content: 'Toujours disponible ?',
      senderId: 'buyer',
      isMine: true,
      createdAt: '2026-10-21T10:00:00.000Z',
      readAt: null,
    });
  });

  test('1000 caractères : accepté', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(conversationRow());
    mockPrisma.message.create.mockImplementation(({ data }) => Promise.resolve(created(data.content)));
    mockPrisma.conversation.update.mockResolvedValue({});

    const res = await send('buyer', { conversationId: 'c1', content: 'é'.repeat(1000) });

    expect(res.status).toBe(201);
  });

  test('e-mail en échec : le message est quand même envoyé', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(conversationRow());
    mockPrisma.message.create.mockImplementation(({ data }) => Promise.resolve(created(data.content)));
    mockPrisma.conversation.update.mockResolvedValue({});
    sendMessageReceivedEmail.mockRejectedValueOnce(new Error('SMTP indisponible'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await send('buyer', { conversationId: 'c1', content: 'Bonjour' });

    expect(res.status).toBe(201);
    warn.mockRestore();
  });
});

describe('GET /api/messages/conversations : mes discussions', () => {
  const list = (userId, query = '') =>
    request(buildApp()).get(`/api/messages/conversations${query}`).set(as(userId));

  beforeEach(() => {
    mockPrisma.message.groupBy.mockResolvedValue([]);
  });

  test.each([
    ['?role=buying', { buyerId: 'buyer' }],
    ['?role=selling', { sellerId: 'buyer' }],
    ['', { OR: [{ buyerId: 'buyer' }, { sellerId: 'buyer' }] }],
  ])('%s : seulement les miennes, avec au moins un message', async (query, mine) => {
    mockPrisma.conversation.findMany.mockResolvedValue([]);

    const res = await list('buyer', query);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(mockPrisma.conversation.findMany.mock.calls[0][0].where).toEqual({
      ...mine,
      lastMessageAt: { not: null },
    });
    expect(res.body).toEqual({ conversations: [], nextCursor: null });
  });

  test.each(['?role=admin', '?limit=0', '?limit=51', '?cursor=../x'])('paramètre invalide %s : 400', async (query) => {
    const res = await list('buyer', query);

    expect(res.status).toBe(400);
    expect(mockPrisma.conversation.findMany).not.toHaveBeenCalled();
  });

  test('pagination : une de plus est lue pour savoir s’il reste une page', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([
      summaryRow({ id: 'c1' }),
      summaryRow({ id: 'c2' }),
      summaryRow({ id: 'c3' }),
    ]);

    const res = await list('buyer', '?limit=2');

    expect(mockPrisma.conversation.findMany.mock.calls[0][0].take).toBe(3);
    expect(res.body.conversations.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(res.body.nextCursor).toBe('c2');
  });

  test('page suivante : curseur dans ma liste, sinon 400', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValueOnce({ id: 'c2' }).mockResolvedValueOnce(null);
    mockPrisma.conversation.findMany.mockResolvedValue([]);

    const ok = await list('buyer', '?role=buying&cursor=c2');
    const ko = await list('buyer', '?role=buying&cursor=c-autrui');

    expect(ok.status).toBe(200);
    expect(mockPrisma.conversation.findMany.mock.calls[0][0]).toMatchObject({ cursor: { id: 'c2' }, skip: 1 });
    expect(ko.status).toBe(400);
  });

  test('résumé : vu par le vendeur, compte supprimé masqué, annonce vendue, aperçu court', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([
      summaryRow({
        buyer: person('buyer', { status: 'DELETED', isIdentityVerified: true }),
        listing: { id: 'l1', title: 'Vélo', price: 900, status: 'ACTIVE', isSold: true, images: [] },
        messages: [{ id: 'm9', content: 'x'.repeat(200), senderId: 'seller', createdAt: new Date() }],
      }),
    ]);
    mockPrisma.message.groupBy.mockResolvedValue([{ conversationId: 'c1', _count: { _all: 3 } }]);

    const res = await list('seller', '?role=selling');
    const [summary] = res.body.conversations;

    expect(summary.role).toBe('selling');
    expect(summary.otherUser).toEqual({
      id: 'buyer',
      name: null,
      avatar: null,
      isIdentityVerified: false,
      canReceiveMessages: false,
    });
    expect(summary.listing).toEqual({ id: 'l1', title: 'Vélo', price: 900, status: 'SOLD', photo: null });
    expect(summary.lastMessage.isMine).toBe(true);
    expect(summary.lastMessage.preview).toBe(`${'x'.repeat(120)}…`);
    expect(summary.unreadCount).toBe(3);
    expect(JSON.stringify(res.body)).not.toMatch(/email|phone|password/i);
  });

  test('annonce supprimée : la discussion reste, sans annonce', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([summaryRow({ listing: null })]);

    const res = await list('buyer');

    expect(res.body.conversations[0].listing).toBeNull();
  });
});

describe('GET /api/messages/conversations/:id : en-tête', () => {
  test('participant : 200 ; autre personne : 404', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(summaryRow());

    const mine = await request(buildApp()).get('/api/messages/conversations/c1').set(as('seller'));
    const other = await request(buildApp()).get('/api/messages/conversations/c1').set(as('intrus'));

    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ id: 'c1', role: 'selling', otherUser: { id: 'buyer' } });
    expect(other.status).toBe(404);
  });
});

describe('GET /api/messages/:id : messages d’une discussion', () => {
  const message = (id, senderId) => ({
    id,
    content: `texte ${id}`,
    senderId,
    createdAt: new Date('2026-10-21T10:00:00Z'),
    readAt: null,
  });

  beforeEach(() => {
    mockPrisma.conversation.findUnique.mockResolvedValue({ id: 'c1', buyerId: 'buyer', sellerId: 'seller' });
  });

  test('première page : plus récents d’abord, lus, page suivante indiquée', async () => {
    mockPrisma.message.findMany.mockResolvedValue([
      message('m3', 'seller'),
      message('m2', 'buyer'),
      message('m1', 'seller'),
    ]);

    const res = await request(buildApp()).get('/api/messages/c1?limit=2').set(as('buyer'));

    expect(res.status).toBe(200);
    expect(mockPrisma.message.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.message.findMany.mock.calls[0][0]).toMatchObject({
      where: { conversationId: 'c1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
    });
    expect(res.body.messages.map((m) => [m.id, m.isMine])).toEqual([
      ['m3', false],
      ['m2', true],
    ]);
    expect(res.body.nextCursor).toBe('m2');
  });

  test('messages précédents : curseur de cette discussion, rien de remarqué lu', async () => {
    mockPrisma.message.findFirst.mockResolvedValue({ id: 'm2' });
    mockPrisma.message.findMany.mockResolvedValue([message('m1', 'seller')]);

    const res = await request(buildApp()).get('/api/messages/c1?before=m2').set(as('buyer'));

    expect(res.status).toBe(200);
    expect(mockPrisma.message.findFirst.mock.calls[0][0].where).toEqual({ id: 'm2', conversationId: 'c1' });
    expect(mockPrisma.message.findMany.mock.calls[0][0]).toMatchObject({ cursor: { id: 'm2' }, skip: 1 });
    expect(mockPrisma.message.updateMany).not.toHaveBeenCalled();
    expect(res.body.nextCursor).toBeNull();
  });

  test('curseur d’une autre discussion : 400', async () => {
    mockPrisma.message.findFirst.mockResolvedValue(null);

    const res = await request(buildApp()).get('/api/messages/c1?before=m-autre').set(as('buyer'));

    expect(res.status).toBe(400);
    expect(mockPrisma.message.findMany).not.toHaveBeenCalled();
  });

  test('limite trop grande : 400', async () => {
    const res = await request(buildApp()).get('/api/messages/c1?limit=101').set(as('buyer'));

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/messages/:id', () => {
  test('message d’autrui : 404, rien de supprimé', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({ id: 'm1', senderId: 'seller' });

    const res = await request(buildApp()).delete('/api/messages/m1').set(as('buyer'));

    expect(res.status).toBe(404);
    expect(mockPrisma.message.delete).not.toHaveBeenCalled();
  });

  test('mon message : supprimé', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({ id: 'm1', senderId: 'buyer' });
    mockPrisma.message.delete.mockResolvedValue({});

    const res = await request(buildApp()).delete('/api/messages/m1').set(as('buyer'));

    expect(res.status).toBe(200);
    expect(mockPrisma.message.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
  });
});
