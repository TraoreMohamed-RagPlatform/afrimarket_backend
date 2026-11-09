const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const sharp = require('sharp');
const { useTestJwtSecret, bearerFor } = require('./helpers/auth');

// Photos dans les discussions : une par message, réencodées sans
// métadonnées et PRIVÉES (seulement les deux personnes de la discussion).

const mockPrisma = {
  userBlock: {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn().mockResolvedValue(null),
  },
  conversation: { findUnique: jest.fn(), update: jest.fn() },
  message: { create: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
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
const { TEMP_DIR } = require('../middleware/uploadMiddleware');
const { MESSAGE_PHOTOS_DIR, messagePhotoPath } = require('../services/messagePhotos');
const { toConversationSummary } = require('../services/conversationView');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/messages', messageRoutes);
  return app;
};

const as = (userId) => ({ Authorization: bearerFor(userId) });

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

/** Photo JPEG 3000×2000 avec métadonnées (dont un faux GPS dans l'EXIF). */
const jpegWithMetadata = () =>
  sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#993c1d' } })
    .withExif({ IFD0: { Copyright: 'secret-owner' }, IFD3: { GPSLatitudeRef: 'N' } })
    .jpeg()
    .toBuffer();

const smallJpeg = () =>
  sharp({ create: { width: 8, height: 6, channels: 3, background: '#000' } }).jpeg().toBuffer();

const savedNames = [];

/** Fichiers temporaires supprimés pendant la requête (uploads/temp). */
const spyTempRemovals = () => {
  const unlink = jest.spyOn(fs.promises, 'unlink');
  return () => unlink.mock.calls.map(([file]) => String(file)).filter((file) => file.startsWith(TEMP_DIR + path.sep));
};

/** Photos de messages présentes sur le disque. */
const storedPhotos = () => fs.readdirSync(MESSAGE_PHOTOS_DIR).filter((name) => name.endsWith('.jpg'));

beforeAll(useTestJwtSecret);
beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.userBlock.findFirst.mockResolvedValue(null);
  mockPrisma.conversation.update.mockResolvedValue({});
  mockPrisma.message.create.mockImplementation(({ data }) =>
    Promise.resolve({
      id: 'm1',
      readAt: null,
      createdAt: new Date('2026-10-21T10:00:00Z'),
      ...data,
    }),
  );
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  await Promise.all(savedNames.map((name) => fs.promises.rm(messagePhotoPath(name), { force: true })));
});

describe('POST /api/messages/photos : envoyer une photo', () => {
  const send = (userId, options = {}) => {
    const { file, filename = 'photo.jpg', contentType = 'image/jpeg' } = options;
    const conversationId = 'conversationId' in options ? options.conversationId : 'c1';
    let req = request(buildApp()).post('/api/messages/photos').set(as(userId));
    if (conversationId !== undefined) req = req.field('conversationId', conversationId);
    if (file) req = req.attach('photo', file, { filename, contentType });
    return req;
  };

  test('sans connexion : 401', async () => {
    const res = await request(buildApp()).post('/api/messages/photos');

    expect(res.status).toBe(401);
  });

  test('photo réencodée (≤ 1600 px, sans EXIF ni GPS), privée, temps réel et e-mail « Photo »', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(conversationRow());
    const tempRemovals = spyTempRemovals();

    const res = await send('buyer', { file: await jpegWithMetadata() });

    expect(res.status).toBe(201);
    const { data } = mockPrisma.message.create.mock.calls[0][0];
    savedNames.push(data.photoName);
    expect(data).toEqual({
      content: '',
      photoName: expect.stringMatching(/^[0-9a-f-]{36}\.jpg$/),
      photoWidth: 1600,
      photoHeight: 1067,
      senderId: 'buyer',
      conversationId: 'c1',
    });

    const file = messagePhotoPath(data.photoName);
    expect(file.startsWith(MESSAGE_PHOTOS_DIR + path.sep)).toBe(true);
    const metadata = await sharp(file).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.exif).toBeUndefined();
    expect(fs.readFileSync(file).includes('secret-owner')).toBe(false);

    // Le nom du fichier n'est jamais envoyé à l'app.
    expect(res.body).toEqual({
      id: 'm1',
      content: '',
      photo: { url: '/api/messages/photos/m1', width: 1600, height: 1067 },
      senderId: 'buyer',
      isMine: true,
      createdAt: '2026-10-21T10:00:00.000Z',
      readAt: null,
    });
    expect(JSON.stringify(res.body)).not.toContain(data.photoName);

    expect(emitToUser).toHaveBeenCalledWith('seller', 'message:new', expect.objectContaining({
      messageId: 'm1',
      content: '',
      hasPhoto: true,
    }));
    expect(sendMessageReceivedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'seller' }),
      expect.objectContaining({ id: 'buyer' }),
      { content: '📷 Photo', conversationId: 'c1' },
      'Vélo de ville',
    );
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { lastMessageAt: new Date('2026-10-21T10:00:00Z') },
    });

    const removed = tempRemovals();
    expect(removed).toHaveLength(1);
    expect(fs.existsSync(removed[0])).toBe(false);
  });

  test.each([
    ['absente', undefined],
    ['caractères interdits', '../c1'],
  ])('discussion %s : 400, rien d’enregistré', async (_label, conversationId) => {
    const before = storedPhotos().length;
    const tempRemovals = spyTempRemovals();

    const res = await send('buyer', { conversationId, file: await smallJpeg() });

    expect(res.status).toBe(400);
    expect(mockPrisma.conversation.findUnique).not.toHaveBeenCalled();
    expect(storedPhotos()).toHaveLength(before);
    expect(tempRemovals()).toHaveLength(1);
  });

  test('sans photo : 400', async () => {
    const res = await send('buyer', {});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No image provided');
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
  });

  test('pas dans la discussion : 404, la photo n’est pas gardée', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(conversationRow({ buyerId: 'x', sellerId: 'y' }));
    const before = storedPhotos().length;
    const tempRemovals = spyTempRemovals();

    const res = await send('buyer', { file: await smallJpeg() });

    expect(res.status).toBe(404);
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
    expect(storedPhotos()).toHaveLength(before);
    expect(tempRemovals()).toHaveLength(1);
  });

  test('blocage (dans un sens ou dans l’autre) : 409 comme un compte indisponible', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(conversationRow());
    mockPrisma.userBlock.findFirst.mockResolvedValue({ id: 'b1' });

    const res = await send('buyer', { file: await smallJpeg() });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RECIPIENT_UNAVAILABLE');
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
  });

  test('destinataire suspendu : 409', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(
      conversationRow({ seller: { id: 'seller', status: 'SUSPENDED', email: 's@test.local', username: 's' } }),
    );

    const res = await send('buyer', { file: await smallJpeg() });

    expect(res.status).toBe(409);
  });

  test('faux JPEG (contenu illisible) : 400, rien d’enregistré', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(conversationRow());
    const before = storedPhotos().length;

    const res = await send('buyer', { file: Buffer.from('<html>pas une image</html>') });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid image');
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
    expect(storedPhotos()).toHaveLength(before);
  });

  test('type refusé (GIF) : 400 sans détail', async () => {
    const res = await send('buyer', { file: Buffer.from('GIF89a'), filename: 'a.gif', contentType: 'image/gif' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid upload', code: 'INVALID_UPLOAD' });
    expect(mockPrisma.conversation.findUnique).not.toHaveBeenCalled();
  });

  test('plus de 5 Mo : 413', async () => {
    const res = await send('buyer', { file: Buffer.alloc(5 * 1024 * 1024 + 1, 0xff) });

    expect(res.status).toBe(413);
    expect(res.body.code).toBe('PHOTO_TOO_LARGE');
    expect(mockPrisma.conversation.findUnique).not.toHaveBeenCalled();
  });

  test('deux photos dans un envoi : 400', async () => {
    const res = await request(buildApp())
      .post('/api/messages/photos')
      .set(as('buyer'))
      .field('conversationId', 'c1')
      .attach('photo', await smallJpeg(), { filename: 'a.jpg', contentType: 'image/jpeg' })
      .attach('photo', await smallJpeg(), { filename: 'b.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(400);
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
  });

  test('échec de l’enregistrement : 500 sans détail, photo supprimée', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(conversationRow());
    mockPrisma.message.create.mockRejectedValue(new Error('db down: secret'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const before = storedPhotos().length;

    const res = await send('buyer', { file: await smallJpeg() });

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(storedPhotos()).toHaveLength(before);
  });
});

describe('GET /api/messages/photos/:messageId : voir une photo', () => {
  const name = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg';
  const photoRow = (overrides = {}) => ({
    photoName: name,
    conversation: { buyerId: 'buyer', sellerId: 'seller' },
    ...overrides,
  });
  const get = (userId, id = 'm1') => request(buildApp()).get(`/api/messages/photos/${id}`).set(as(userId));

  beforeAll(async () => {
    savedNames.push(name);
    await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
      .jpeg()
      .toFile(messagePhotoPath(name));
  });

  test('sans connexion : 401', async () => {
    const res = await request(buildApp()).get('/api/messages/photos/m1');

    expect(res.status).toBe(401);
  });

  test.each(['buyer', 'seller'])('%s de la discussion : photo privée, jamais dans un cache partagé', async (userId) => {
    mockPrisma.message.findUnique.mockResolvedValue(photoRow());

    const res = await get(userId);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('private, max-age=86400, immutable');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('quelqu’un d’autre : 404 (la photo n’existe pas pour lui)', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(photoRow());

    const res = await get('stranger');

    expect(res.status).toBe(404);
  });

  test.each([
    ['message inconnu', null],
    ['message sans photo', photoRow({ photoName: null })],
    ['nom de fichier invalide', photoRow({ photoName: '../../.env' })],
    ['fichier absent du disque', photoRow({ photoName: '00000000-0000-4000-8000-000000000000.jpg' })],
  ])('%s : 404', async (_label, row) => {
    mockPrisma.message.findUnique.mockResolvedValue(row);

    const res = await get('buyer');

    expect(res.status).toBe(404);
  });

  test('identifiant invalide : 400', async () => {
    const res = await get('buyer', 'm1%2F..');

    expect(res.status).toBe(400);
    expect(mockPrisma.message.findUnique).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/messages/:id : une photo supprimée disparaît du disque', () => {
  test('mon message photo : fichier supprimé', async () => {
    const name = '12345678-1234-4234-8234-123456789012.jpg';
    await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } })
      .jpeg()
      .toFile(messagePhotoPath(name));
    mockPrisma.message.findUnique.mockResolvedValue({ id: 'm1', senderId: 'buyer', photoName: name });
    mockPrisma.message.delete.mockResolvedValue({});

    const res = await request(buildApp()).delete('/api/messages/m1').set(as('buyer'));

    expect(res.status).toBe(200);
    expect(fs.existsSync(messagePhotoPath(name))).toBe(false);
  });
});

describe('Liste des discussions : dernier message photo', () => {
  test('aperçu vide et « hasPhoto » (l’app affiche « Photo »)', () => {
    const summary = toConversationSummary(
      {
        id: 'c1',
        buyerId: 'buyer',
        sellerId: 'seller',
        lastMessageAt: new Date(),
        listing: null,
        buyer: { id: 'buyer', fullName: 'A', status: 'ACTIVE' },
        seller: { id: 'seller', fullName: 'B', status: 'ACTIVE' },
        messages: [{ id: 'm1', content: '', photoName: 'x.jpg', senderId: 'seller', createdAt: new Date() }],
      },
      'buyer',
    );

    expect(summary.lastMessage).toEqual(expect.objectContaining({ preview: '', hasPhoto: true, isMine: false }));
  });
});
