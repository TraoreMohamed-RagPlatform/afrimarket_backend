const express = require('express');
const request = require('supertest');
const { useTestJwtSecret, bearerFor } = require('./helpers/auth');

const mockPrisma = {
  listing: { findUnique: jest.fn() },
};
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockPrisma) }));
jest.mock('../utils/emailService', () => ({ sendEmail: jest.fn() }));

const listingRoutes = require('../routes/listing');
const { retireLegacyCategories, LEGACY_CATEGORY_TARGETS } = require('../../prisma/seed');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/listings', listingRoutes);
  return app;
};

const stored = (extra = {}) => ({
  id: 'l1',
  userId: 'seller',
  status: 'ACTIVE',
  title: 'Vélo',
  user: { id: 'seller', username: 'aminata', phone: null, settings: null },
  images: [],
  ratings: [],
  ...extra,
});

const detail = (headers = {}) => request(buildApp()).get('/api/listings/l1').set(headers);

describe('Page de détail : vendeur et annonce masquée', () => {
  beforeAll(useTestJwtSecret);
  beforeEach(() => jest.clearAllMocks());

  test('visiteur : isOwner faux', async () => {
    mockPrisma.listing.findUnique.mockResolvedValue(stored());

    const res = await detail();

    expect(res.status).toBe(200);
    expect(res.body.isOwner).toBe(false);
  });

  test('le vendeur connecté : isOwner vrai', async () => {
    mockPrisma.listing.findUnique.mockResolvedValue(stored());

    const res = await detail({ Authorization: bearerFor('seller') });

    expect(res.body.isOwner).toBe(true);
  });

  test('autre personne connectée : isOwner faux', async () => {
    mockPrisma.listing.findUnique.mockResolvedValue(stored());

    const res = await detail({ Authorization: bearerFor('buyer') });

    expect(res.body.isOwner).toBe(false);
  });

  test('jeton invalide : la page reste publique (pas de 401)', async () => {
    mockPrisma.listing.findUnique.mockResolvedValue(stored());

    const res = await detail({ Authorization: 'Bearer faux.jeton.ici' });

    expect(res.status).toBe(200);
    expect(res.body.isOwner).toBe(false);
  });

  test('annonce masquée : introuvable pour les autres', async () => {
    mockPrisma.listing.findUnique.mockResolvedValue(stored({ status: 'INACTIVE' }));

    expect((await detail()).status).toBe(404);
    expect((await detail({ Authorization: bearerFor('buyer') })).status).toBe(404);
  });

  test('annonce masquée : visible par son vendeur', async () => {
    mockPrisma.listing.findUnique.mockResolvedValue(stored({ status: 'INACTIVE' }));

    const res = await detail({ Authorization: bearerFor('seller') });

    expect(res.status).toBe(200);
    expect(res.body.isOwner).toBe(true);
  });
});

describe('Anciennes catégories', () => {
  /** Base simulée : catégories et annonces. */
  const fakeDb = (categories, listings) => {
    const db = {
      categories: [...categories],
      listings: [...listings],
      category: {
        findMany: jest.fn(({ where }) =>
          Promise.resolve(db.categories.filter((c) => !where.slug.notIn.includes(c.slug)))),
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(db.categories.find((c) => c.slug === where.slug) ?? null)),
        // Opérations différées, exécutées par $transaction.
        delete: jest.fn(({ where }) => () => {
          db.categories = db.categories.filter((c) => c.id !== where.id);
        }),
      },
      listing: {
        updateMany: jest.fn(({ where, data }) => () => {
          for (const l of db.listings) if (l.categoryId === where.categoryId) l.categoryId = data.categoryId;
        }),
      },
      $transaction: jest.fn((operations) => {
        for (const run of operations) run();
        return Promise.resolve();
      }),
    };
    return db;
  };

  const current = [
    { id: 'c-art', slug: 'articles' },
    { id: 'c-aut', slug: 'autres' },
    { id: 'c-log', slug: 'logement' },
  ];

  test('« Téléphones » : annonces vers Articles, catégorie retirée', async () => {
    const db = fakeDb(
      [...current, { id: 'c-tel', slug: '', name: 'Téléphones' }],
      [{ id: 'iphone', categoryId: 'c-tel' }, { id: 'lit', categoryId: 'c-log' }],
    );

    const retired = await retireLegacyCategories(db);

    expect(retired).toBe(1);
    expect(db.listings).toEqual([
      { id: 'iphone', categoryId: 'c-art' },
      { id: 'lit', categoryId: 'c-log' },
    ]);
    expect(db.categories.map((c) => c.id)).toEqual(['c-art', 'c-aut', 'c-log']);
  });

  test('ancienne catégorie inconnue : annonces vers Autres', async () => {
    const db = fakeDb(
      [...current, { id: 'c-x', slug: 'divers', name: 'Divers' }],
      [{ id: 'objet', categoryId: 'c-x' }],
    );

    await retireLegacyCategories(db);

    expect(db.listings[0].categoryId).toBe('c-aut');
  });

  test('rien à retirer : aucune modification', async () => {
    const db = fakeDb(current, []);

    expect(await retireLegacyCategories(db)).toBe(0);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  test('chaque cible existe dans la liste des catégories', () => {
    const { CATEGORIES } = require('../config/listingOptions');
    const slugs = CATEGORIES.map((c) => c.slug);
    for (const target of Object.values(LEGACY_CATEGORY_TARGETS)) {
      expect(slugs).toContain(target);
    }
  });
});
