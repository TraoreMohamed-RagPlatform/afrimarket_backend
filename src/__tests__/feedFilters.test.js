const express = require('express');
const request = require('supertest');
const { useTestJwtSecret, bearerFor } = require('./helpers/auth');

const mockPrisma = {
  listing: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  user: { findUnique: jest.fn() },
};
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockPrisma) }));
jest.mock('../utils/emailService', () => ({ sendEmail: jest.fn() }));

const listingRoutes = require('../routes/listing');
const { seedCategories } = require('../../prisma/seed');
const { CATEGORIES } = require('../config/listingOptions');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/listings', listingRoutes);
  return app;
};

const feed = (query = '') => request(buildApp()).get(`/api/listings${query}`);
const lastQuery = () => mockPrisma.listing.findMany.mock.calls.at(-1)[0];

describe('Fil : filtres et tri (B2)', () => {
  beforeAll(useTestJwtSecret);

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.listing.findMany.mockResolvedValue([]);
    mockPrisma.listing.count.mockResolvedValue(45);
  });

  test('par défaut : actives et réservées, les plus récentes, 20 par page', async () => {
    const res = await feed();

    expect(res.status).toBe(200);
    const args = lastQuery();
    expect(args.where).toEqual({ status: { in: ['ACTIVE', 'RESERVED'] } });
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(args.take).toBe(20);
    expect(args.skip).toBe(0);
    expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 45, pages: 3 });
  });

  test('quartier, catégorie, prix et tri', async () => {
    await feed('?categoryId=c1&city=casablanca&district=maarif&minPrice=100&maxPrice=2000&sort=price_asc&page=2');

    const args = lastQuery();
    expect(args.where).toMatchObject({
      categoryId: 'c1',
      city: 'casablanca',
      district: 'maarif',
      price: { gte: 100, lte: 2000 },
    });
    expect(args.orderBy[0]).toEqual({ price: 'asc' });
    expect(args.skip).toBe(20);
  });

  test('prix décroissant ; prix minimum seul', async () => {
    await feed('?sort=price_desc&minPrice=0');

    const args = lastQuery();
    expect(args.orderBy[0]).toEqual({ price: 'desc' });
    expect(args.where.price).toEqual({ gte: 0 });
  });

  test('taille de page plafonnée à 50', async () => {
    await feed('?limit=100');

    expect(lastQuery().take).toBe(50);
  });

  test.each([
    ['quartier inconnu', '?district=quartier-imaginaire'],
    ['ville inconnue', '?city=paris'],
    ['tri inconnu', '?sort=random'],
    ['prix négatif', '?minPrice=-5'],
    ['prix max < prix min', '?minPrice=500&maxPrice=100'],
    ['page invalide', '?page=0'],
    ['taille excessive', '?limit=1000'],
    ['paramètre répété', '?city=casablanca&city=rabat'],
    ['recherche trop longue', `?search=${'a'.repeat(101)}`],
  ])('%s : 400, aucune requête en base', async (_name, query) => {
    const res = await feed(query);

    expect(res.status).toBe(400);
    expect(mockPrisma.listing.findMany).not.toHaveBeenCalled();
  });
});

describe('Statut « Réservé » (B3)', () => {
  beforeAll(useTestJwtSecret);

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.listing.findUnique.mockResolvedValue({ id: 'l1', userId: 'seller-1', price: 100 });
    mockPrisma.listing.update.mockImplementation(({ data }) => Promise.resolve({ id: 'l1', ...data }));
  });

  const update = (body) =>
    request(buildApp()).put('/api/listings/l1').set('Authorization', bearerFor('seller-1')).send(body);

  test.each([['RESERVED'], ['ACTIVE'], ['INACTIVE']])('le vendeur peut passer en %s', async (status) => {
    const res = await update({ status });

    expect(res.status).toBe(200);
    expect(mockPrisma.listing.update.mock.calls[0][0].data.status).toBe(status);
  });

  test('« Vendu » passe toujours par /mark-sold', async () => {
    const res = await update({ status: 'SOLD' });

    expect(res.status).toBe(400);
  });
});

describe('Catégories de référence (B1)', () => {
  const fakePrisma = (existing = []) => {
    const rows = [...existing];
    return {
      rows,
      category: {
        findUnique: jest.fn(({ where }) => Promise.resolve(rows.find((row) => row.name === where.name) ?? null)),
        update: jest.fn(({ where, data }) =>
          Promise.resolve(Object.assign(rows.find((row) => row.id === where.id), data)),
        ),
        upsert: jest.fn(({ where, create, update }) => {
          const row = rows.find((r) => r.slug === where.slug);
          if (row) return Promise.resolve(Object.assign(row, update));
          const created = { id: `id-${rows.length}`, ...create };
          rows.push(created);
          return Promise.resolve(created);
        }),
      },
    };
  };

  test('les 7 catégories, dans l’ordre du menu', async () => {
    const prisma = fakePrisma();

    await seedCategories(prisma);

    expect(prisma.rows.map((row) => [row.position, row.name])).toEqual([
      [0, 'Logement'],
      [1, 'Articles'],
      [2, 'Services'],
      [3, 'Emploi'],
      [4, 'Transport'],
      [5, 'Recherche'],
      [6, 'Autres'],
    ]);
    expect(prisma.rows.every((row) => row.slug && row.icon)).toBe(true);
  });

  test('relancer ne crée pas de doublon', async () => {
    const prisma = fakePrisma();

    await seedCategories(prisma);
    await seedCategories(prisma);

    expect(prisma.rows).toHaveLength(CATEGORIES.length);
  });

  test('catégorie existante du même nom : rattachée, pas recréée', async () => {
    const prisma = fakePrisma([{ id: 'old', name: 'Logement', slug: 'logements-old', position: 9 }]);

    await seedCategories(prisma);

    const logement = prisma.rows.find((row) => row.id === 'old');
    expect(logement).toMatchObject({ slug: 'logement', position: 0, icon: 'house' });
    expect(prisma.rows.filter((row) => row.name === 'Logement')).toHaveLength(1);
  });
});
