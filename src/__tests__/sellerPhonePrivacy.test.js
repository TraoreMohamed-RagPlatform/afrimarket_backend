const express = require('express');
const request = require('supertest');
const { useTestJwtSecret, bearerFor } = require('./helpers/auth');

// Base de données simulée : les contrôleurs créent leur propre PrismaClient.
const mockPrisma = {
  listing: { findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
};
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockPrisma) }));

const listingRoutes = require('../routes/listing');
const userRoutes = require('../routes/user');

const PHONE = '+212612345678';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/listings', listingRoutes);
  app.use('/api/users', userRoutes);
  return app;
};

/** Annonce complète renvoyée par Prisma pour GET /api/listings/:id. */
const listingWithSeller = (seller = {}) => ({
  id: 'listing-1',
  title: 'Canapé',
  status: 'ACTIVE',
  isSold: false,
  user: {
    id: 'seller-1',
    username: 'aminata',
    fullName: 'Aminata K.',
    avatar: null,
    avgRating: 4.8,
    phone: PHONE,
    verifiedPhone: true,
    settings: { showPhone: true, whatsappEnabled: false },
    ...seller,
  },
  category: { id: 'c1', name: 'Mobilier' },
  images: [],
  ratings: [],
});

/** Annonce réduite renvoyée par Prisma pour la route /contact. */
const contactRow = ({ listing = {}, seller = {} } = {}) => ({
  id: 'listing-1',
  status: 'ACTIVE',
  isSold: false,
  ...listing,
  user: {
    phone: PHONE,
    verifiedPhone: true,
    status: 'ACTIVE',
    settings: { showPhone: true, whatsappEnabled: false },
    ...seller,
  },
});

describe('Numéro du vendeur : jamais exposé publiquement', () => {
  beforeAll(useTestJwtSecret);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /api/listings/:id (public)', () => {
    test('aucun numéro dans la réponse, seulement canCall', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(listingWithSeller());

      const res = await request(buildApp()).get('/api/listings/listing-1');

      expect(res.status).toBe(200);
      expect(res.body.listing.user).not.toHaveProperty('phone');
      expect(res.body.listing.user).not.toHaveProperty('verifiedPhone');
      expect(res.body.listing.user).not.toHaveProperty('settings');
      expect(res.body.listing.user.canCall).toBe(true);
      expect(res.body.listing.user.canWhatsapp).toBe(false);
      expect(JSON.stringify(res.body)).not.toContain(PHONE);
    });

    test('numéro non vérifié : canCall à false', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(
        listingWithSeller({ verifiedPhone: false }),
      );

      const res = await request(buildApp()).get('/api/listings/listing-1');

      expect(res.body.listing.user.canCall).toBe(false);
      expect(JSON.stringify(res.body)).not.toContain(PHONE);
    });

    test('sans consentement du vendeur : canCall à false', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(
        listingWithSeller({ settings: null }),
      );

      const res = await request(buildApp()).get('/api/listings/listing-1');

      expect(res.body.listing.user.canCall).toBe(false);
      expect(res.body.listing.user.canWhatsapp).toBe(false);
    });

    test('WhatsApp activé : canWhatsapp à true', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(
        listingWithSeller({ settings: { showPhone: true, whatsappEnabled: true } }),
      );

      const res = await request(buildApp()).get('/api/listings/listing-1');

      expect(res.body.listing.user.canWhatsapp).toBe(true);
    });

    test('WhatsApp activé mais numéro non partagé : canWhatsapp à false', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(
        listingWithSeller({ settings: { showPhone: false, whatsappEnabled: true } }),
      );

      const res = await request(buildApp()).get('/api/listings/listing-1');

      expect(res.body.listing.user.canWhatsapp).toBe(false);
    });

    test('sans numéro : canCall à false', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(
        listingWithSeller({ phone: null }),
      );

      const res = await request(buildApp()).get('/api/listings/listing-1');

      expect(res.body.listing.user.canCall).toBe(false);
    });
  });

  describe('GET /api/users/:id (profil public)', () => {
    test('le téléphone n’est même pas lu en base', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'seller-1', username: 'aminata' });

      const res = await request(buildApp()).get('/api/users/seller-1');

      expect(res.status).toBe(200);
      const { select } = mockPrisma.user.findUnique.mock.calls[0][0];
      expect(select).not.toHaveProperty('phone');
      expect(res.body.user).not.toHaveProperty('phone');
    });
  });

  describe('GET /api/listings/:id/contact (connexion requise)', () => {
    test('sans token : 401 et aucune requête en base', async () => {
      const res = await request(buildApp()).get('/api/listings/listing-1/contact');

      expect(res.status).toBe(401);
      expect(mockPrisma.listing.findUnique).not.toHaveBeenCalled();
    });

    test('connecté, numéro vérifié : le numéro, jamais mis en cache', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(contactRow());

      const res = await request(buildApp())
        .get('/api/listings/listing-1/contact')
        .set('Authorization', bearerFor('buyer-1'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ phone: PHONE, whatsapp: false });
      expect(res.headers['cache-control']).toBe('no-store');
    });

    test('WhatsApp autorisé par le vendeur : whatsapp à true', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(
        contactRow({ seller: { settings: { showPhone: true, whatsappEnabled: true } } }),
      );

      const res = await request(buildApp())
        .get('/api/listings/listing-1/contact')
        .set('Authorization', bearerFor('buyer-1'));

      expect(res.body).toEqual({ phone: PHONE, whatsapp: true });
    });

    test('la consultation est journalisée, sans le numéro', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(contactRow());

      await request(buildApp())
        .get('/api/listings/listing-1/contact')
        .set('Authorization', bearerFor('buyer-1'));

      const logged = console.info.mock.calls.flat().join(' ');
      expect(logged).toContain('listing-1');
      expect(logged).toContain('buyer-1');
      expect(logged).not.toContain(PHONE);
    });

    test.each([
      ['annonce introuvable', null],
      ['numéro non vérifié', contactRow({ seller: { verifiedPhone: false } })],
      ['pas de numéro', contactRow({ seller: { phone: null } })],
      ['vendeur sans consentement', contactRow({ seller: { settings: null } })],
      [
        'consentement retiré',
        contactRow({ seller: { settings: { showPhone: false, whatsappEnabled: true } } }),
      ],
      ['annonce vendue', contactRow({ listing: { isSold: true } })],
      ['annonce inactive', contactRow({ listing: { status: 'DELETED' } })],
      ['vendeur supprimé', contactRow({ seller: { status: 'DELETED' } })],
    ])('%s : 404 sans détail', async (_name, row) => {
      mockPrisma.listing.findUnique.mockResolvedValue(row);

      const res = await request(buildApp())
        .get('/api/listings/listing-1/contact')
        .set('Authorization', bearerFor('buyer-1'));

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Contact not available' });
      expect(JSON.stringify(res.body)).not.toContain(PHONE);
    });

    test('débit limité par utilisateur (20 par heure)', async () => {
      mockPrisma.listing.findUnique.mockResolvedValue(contactRow());
      const app = buildApp();
      const ask = (userId) =>
        request(app)
          .get('/api/listings/listing-1/contact')
          .set('Authorization', bearerFor(userId));

      for (let i = 0; i < 20; i += 1) {
        expect((await ask('scraper')).status).toBe(200);
      }

      expect((await ask('scraper')).status).toBe(429);
      // Un autre utilisateur n'est pas pénalisé.
      expect((await ask('buyer-2')).status).toBe(200);
    });
  });
});
