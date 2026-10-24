const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const sharp = require('sharp');
const { useTestJwtSecret, bearerFor } = require('./helpers/auth');

const mockPrisma = {
  listing: { findUnique: jest.fn() },
  image: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  $transaction: jest.fn((operations) => Promise.all(operations)),
};
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockPrisma) }));
jest.mock('../lib/prisma', () => ({}));

const listingRoutes = require('../routes/listing');
const errorHandler = require('../middleware/errorHandler');
const { TEMP_DIR } = require('../middleware/uploadMiddleware');
const { LISTING_PHOTOS_DIR, storedPhotoPath } = require('../services/listingPhotos');
const { createApp } = require('../app');

const OWNER = 'seller-1';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/listings', listingRoutes);
  app.use(errorHandler);
  return app;
};

/** Annonce du vendeur avec [count] photos existantes. */
const listingWith = (count = 0, userId = OWNER, extra = {}) => ({
  id: 'listing-1',
  userId,
  status: 'ACTIVE',
  isSold: false,
  ...extra,
  images: Array.from({ length: count }, (_, i) => ({
    id: `img-${i}`,
    publicId: null,
    position: i,
  })),
});

/** Photo JPEG 3000×2000 avec métadonnées (dont un faux GPS dans l'EXIF). */
const jpegWithMetadata = () =>
  sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#c0392b' } })
    .withExif({ IFD0: { Copyright: 'secret-owner' }, IFD3: { GPSLatitudeRef: 'N' } })
    .jpeg()
    .toBuffer();

const savedNames = [];

/**
 * Fichiers temporaires supprimés pendant la requête. On ne compare pas le
 * contenu de uploads/temp : les autres suites (KYC) l'utilisent en parallèle.
 */
const spyTempRemovals = () => {
  const unlink = jest.spyOn(fs.promises, 'unlink');
  return () => unlink.mock.calls.map(([file]) => String(file)).filter((file) => file.startsWith(TEMP_DIR + path.sep));
};

/** Exactement [count] fichiers temporaires supprimés, et plus sur le disque. */
const expectTempFilesRemoved = (removed, count) => {
  expect(removed).toHaveLength(count);
  for (const file of removed) {
    expect(fs.existsSync(file)).toBe(false);
  }
};

describe('Photos des annonces', () => {
  beforeAll(useTestJwtSecret);

  afterEach(() => jest.restoreAllMocks());

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.image.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: `new-${data.position}`, url: data.url, position: data.position }),
    );
    mockPrisma.image.update.mockImplementation(({ where, data }) =>
      Promise.resolve({ id: where.id, url: `/uploads/listings/${where.id}.jpg`, position: data.position }),
    );
    mockPrisma.image.delete.mockResolvedValue({});
  });

  afterAll(async () => {
    await Promise.all(
      savedNames.map((name) => fs.promises.rm(storedPhotoPath(name), { force: true })),
    );
  });

  describe('POST /api/listings/:id/images', () => {
    const upload = (app, files, userId = OWNER) => {
      let req = request(app)
        .post('/api/listings/listing-1/images')
        .set('Authorization', bearerFor(userId));
      for (const [buffer, filename, contentType] of files) {
        req = req.attach('images', buffer, { filename, contentType });
      }
      return req;
    };

    test('photo réencodée : JPEG ≤ 1600 px, sans métadonnées (GPS), à la suite des autres', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(listingWith(2));
      const tempRemovals = spyTempRemovals();

      const res = await upload(buildApp(), [[await jpegWithMetadata(), 'photo.jpg', 'image/jpeg']]);

      expect(res.status).toBe(201);
      const [image] = res.body.images;
      expect(image.position).toBe(2);
      expect(image.url).toMatch(/^\/uploads\/listings\/[0-9a-f-]{36}\.jpg$/);

      const { data } = mockPrisma.image.create.mock.calls[0][0];
      savedNames.push(data.publicId);
      const file = storedPhotoPath(data.publicId);
      const metadata = await sharp(file).metadata();
      expect(metadata.format).toBe('jpeg');
      expect(Math.max(metadata.width, metadata.height)).toBe(1600);
      expect(metadata.exif).toBeUndefined();
      expect(fs.readFileSync(file).includes('secret-owner')).toBe(false);

      // Fichier temporaire supprimé.
      expectTempFilesRemoved(tempRemovals(), 1);
    });

    test('PNG accepté, converti en JPEG', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(listingWith(0));
      const png = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#00000000' } })
        .png()
        .toBuffer();

      const res = await upload(buildApp(), [[png, 'a.png', 'image/png']]);

      expect(res.status).toBe(201);
      const { data } = mockPrisma.image.create.mock.calls[0][0];
      savedNames.push(data.publicId);
      expect(data.position).toBe(0);
      expect(data.publicId).toMatch(/\.jpg$/);
    });

    test('faux JPEG (texte) : 400, rien d’enregistré, temporaire supprimé', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(listingWith(0));
      const tempRemovals = spyTempRemovals();
      const photosBefore = fs.readdirSync(LISTING_PHOTOS_DIR);

      const res = await upload(buildApp(), [
        [Buffer.from('<script>alert(1)</script>'), 'photo.jpg', 'image/jpeg'],
      ]);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid image' });
      expect(mockPrisma.image.create).not.toHaveBeenCalled();
      expectTempFilesRemoved(tempRemovals(), 1);
      expect(fs.readdirSync(LISTING_PHOTOS_DIR)).toEqual(photosBefore);
    });

    test('type refusé (HTML) : 400 par multer', async () => {
      const res = await upload(buildApp(), [[Buffer.from('<html>'), 'x.html', 'text/html']]);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid upload');
    });

    test('plus de 10 photos au total : 400', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(listingWith(9));
      const photo = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } })
        .jpeg()
        .toBuffer();

      const res = await upload(buildApp(), [
        [photo, 'a.jpg', 'image/jpeg'],
        [photo, 'b.jpg', 'image/jpeg'],
      ]);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'Too many photos', max: 10, remaining: 1 });
      expect(mockPrisma.image.create).not.toHaveBeenCalled();
    });

    test('annonce d’un autre vendeur : 403, temporaire supprimé', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(listingWith(0, 'someone-else'));
      const tempRemovals = spyTempRemovals();

      const res = await upload(buildApp(), [[await jpegWithMetadata(), 'a.jpg', 'image/jpeg']]);

      expect(res.status).toBe(403);
      expectTempFilesRemoved(tempRemovals(), 1);
    });

    test('sans photo : 400 ; sans token : 401', async () => {
      const app = buildApp();

      expect((await upload(app, [])).status).toBe(400);
      expect((await request(app).post('/api/listings/listing-1/images')).status).toBe(401);
    });
  });

  describe('DELETE /api/listings/:id/images/:imageId', () => {
    test('photo supprimée, les autres renumérotées', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(listingWith(3));

      const res = await request(buildApp())
        .delete('/api/listings/listing-1/images/img-0')
        .set('Authorization', bearerFor(OWNER));

      expect(res.status).toBe(200);
      expect(mockPrisma.image.delete).toHaveBeenCalledWith({ where: { id: 'img-0' } });
      expect(res.body.images.map((image) => [image.id, image.position])).toEqual([
        ['img-1', 0],
        ['img-2', 1],
      ]);
    });

    test('photo d’une autre annonce : 404', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(listingWith(1));

      const res = await request(buildApp())
        .delete('/api/listings/listing-1/images/img-of-another-listing')
        .set('Authorization', bearerFor(OWNER));

      expect(res.status).toBe(404);
      expect(mockPrisma.image.delete).not.toHaveBeenCalled();
    });

    test('pas le vendeur : 403', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(listingWith(1, 'someone-else'));

      const res = await request(buildApp())
        .delete('/api/listings/listing-1/images/img-0')
        .set('Authorization', bearerFor(OWNER));

      expect(res.status).toBe(403);
    });

    test('dernière photo d’une annonce publiée : 409, gardée', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(listingWith(1));

      const res = await request(buildApp())
        .delete('/api/listings/listing-1/images/img-0')
        .set('Authorization', bearerFor(OWNER));

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('LAST_PHOTO');
      expect(mockPrisma.image.delete).not.toHaveBeenCalled();
    });

    test('dernière photo d’une annonce masquée (publication en cours) : supprimée', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(listingWith(1, OWNER, { status: 'INACTIVE' }));

      const res = await request(buildApp())
        .delete('/api/listings/listing-1/images/img-0')
        .set('Authorization', bearerFor(OWNER));

      expect(res.status).toBe(200);
      expect(mockPrisma.image.delete).toHaveBeenCalledWith({ where: { id: 'img-0' } });
    });

    test('annonce vendue : 409 (photos, ordre et suppression)', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(listingWith(3, OWNER, { isSold: true }));
      const app = buildApp();

      const removed = await request(app)
        .delete('/api/listings/listing-1/images/img-0')
        .set('Authorization', bearerFor(OWNER));
      const reordered = await request(app)
        .put('/api/listings/listing-1/images/order')
        .set('Authorization', bearerFor(OWNER))
        .send({ imageIds: ['img-2', 'img-1', 'img-0'] });

      expect([removed.status, reordered.status]).toEqual([409, 409]);
      expect(removed.body.code).toBe('LISTING_SOLD');
      expect(mockPrisma.image.delete).not.toHaveBeenCalled();
      expect(mockPrisma.image.update).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/listings/:id/images/order', () => {
    const reorder = (imageIds) =>
      request(buildApp())
        .put('/api/listings/listing-1/images/order')
        .set('Authorization', bearerFor(OWNER))
        .send({ imageIds });

    test('nouvel ordre enregistré : la première devient la principale', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(listingWith(3));

      const res = await reorder(['img-2', 'img-0', 'img-1']);

      expect(res.status).toBe(200);
      expect(res.body.images.map((image) => [image.id, image.position])).toEqual([
        ['img-2', 0],
        ['img-0', 1],
        ['img-1', 2],
      ]);
    });

    test.each([
      ['photo manquante', ['img-0', 'img-1']],
      ['doublon', ['img-0', 'img-0', 'img-1']],
      ['photo étrangère', ['img-0', 'img-1', 'other']],
    ])('%s : 400', async (_name, imageIds) => {
      mockPrisma.listing.findUnique.mockResolvedValue(listingWith(3));

      const res = await reorder(imageIds);

      expect(res.status).toBe(400);
      expect(mockPrisma.image.update).not.toHaveBeenCalled();
    });

    test('liste invalide : 400', async () => {
      expect((await reorder('img-0')).status).toBe(400);
      expect((await reorder([])).status).toBe(400);
      expect((await reorder([1, 2])).status).toBe(400);
    });
  });

  describe('Service des fichiers (app.js)', () => {
    const app = createApp();

    test('photo d’annonce servie, affichable depuis le web', async () => {
      const name = '11111111-2222-4333-8444-555555555555.jpg';
      savedNames.push(name);
      await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
        .jpeg()
        .toFile(path.join(LISTING_PHOTOS_DIR, name));

      const res = await request(app).get(`/uploads/listings/${name}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    test.each([
      ['/uploads/identity/user/documents/x.png'],
      ['/uploads/temp/x.jpg'],
      ['/uploads/listings/..%2Fidentity%2Fx.png'],
      ['/uploads/listings/../identity/x.png'],
      ['/uploads/listings/'],
      ['/uploads/listings/.env'],
    ])('%s : jamais servi', async (url) => {
      const res = await request(app).get(url);

      expect(res.status).not.toBe(200);
    });
  });
});
