jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => ({})) }));

const { toReportQueryOptions, buildOrderBy } = require('../utils/adminReportService');

describe('Rapports admin : tri et pagination sur liste blanche', () => {
  test('valeurs autorisées conservées', () => {
    expect(toReportQueryOptions({ page: '2', limit: '20', sortBy: 'title', sortOrder: 'asc' })).toEqual({
      page: 2,
      limit: 20,
      sortBy: 'title',
      sortOrder: 'asc',
    });
  });

  test.each(['__proto__', 'constructor', 'data', 'user', ['createdAt']])(
    'clé de tri refusée (%p) : tri par date',
    (sortBy) => {
      expect(toReportQueryOptions({ sortBy }).sortBy).toBe('createdAt');
    },
  );

  test('ordre, page et taille invalides : valeurs par défaut et plafond', () => {
    expect(toReportQueryOptions({ sortOrder: 'DROP', page: '-3', limit: '100000' })).toEqual({
      page: 1,
      limit: 100,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
  });

  test('objet de tri construit sans clé dynamique', () => {
    expect(buildOrderBy('type', 'asc')).toEqual({ type: 'asc' });
    expect(buildOrderBy('anything', 'desc')).toEqual({ createdAt: 'desc' });
  });
});
