const request = require('supertest');

// Aucune vraie base de données pendant les tests.
const mockPrisma = { $queryRaw: jest.fn() };
jest.mock('../lib/prisma', () => mockPrisma);
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => ({})) }));

const { createApp } = require('../app');

const ALLOWED = 'https://admin.afrimarket.ma';
const app = createApp({ corsOrigins: [ALLOWED] });

describe('Application', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('/api/health', () => {
    test('base disponible : 200', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ 1: 1 }]);

      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    test('base indisponible : 503 sans aucun détail technique', async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error('password authentication failed for user "postgres"'));
      jest.spyOn(console, 'error').mockImplementation(() => {});

      const res = await request(app).get('/api/health');

      expect(res.status).toBe(503);
      expect(JSON.stringify(res.body)).not.toMatch(/postgres|password/);
    });
  });

  test('route inconnue : 404', async () => {
    const res = await request(app).get('/api/nexiste-pas');

    expect(res.status).toBe(404);
  });

  test('JSON mal formé : 400 et pas de pile d’erreur', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid JSON body' });
  });

  test('corps JSON trop volumineux : 413', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a'.repeat(200 * 1024) }));

    expect(res.status).toBe(413);
  });

  describe('CORS', () => {
    test('origine autorisée : en-tête renvoyé', async () => {
      const res = await request(app).get('/api/nexiste-pas').set('Origin', ALLOWED);

      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    });

    test('origine inconnue : aucun en-tête CORS', async () => {
      const res = await request(app).get('/api/nexiste-pas').set('Origin', 'https://pirate.example');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    test('application mobile (sans Origin) : acceptée', async () => {
      const res = await request(app).get('/api/nexiste-pas');

      expect(res.status).toBe(404);
    });
  });

  test('en-têtes de sécurité (helmet) présents, X-Powered-By absent', async () => {
    const res = await request(app).get('/api/nexiste-pas');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
