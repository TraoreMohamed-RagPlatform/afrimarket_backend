const express = require('express');
const request = require('supertest');
const { useTestJwtSecret, bearerFor } = require('./helpers/auth');

const mockPrisma = { user: { findUnique: jest.fn() } };
jest.mock('../lib/prisma', () => mockPrisma);

const authMiddleware = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');

const buildApp = () => {
  const app = express();
  app.get('/admin', authMiddleware, requireRole('ADMIN'), (req, res) =>
    res.json({ ok: true, role: req.user.role }),
  );
  // Gestionnaire d'erreurs minimal : ne divulgue rien.
  app.use((err, req, res, _next) => res.status(500).json({ error: 'Internal server error' }));
  return app;
};

describe('requireRole', () => {
  beforeAll(useTestJwtSecret);
  beforeEach(() => jest.clearAllMocks());

  test('administrateur actif : accès autorisé', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: 'ADMIN', status: 'ACTIVE' });

    const res = await request(buildApp()).get('/admin').set('Authorization', bearerFor('admin-1'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, role: 'ADMIN' });
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'admin-1' },
      select: { role: true, status: true },
    });
  });

  test('utilisateur normal : 403', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: 'USER', status: 'ACTIVE' });

    const res = await request(buildApp()).get('/admin').set('Authorization', bearerFor('u-1'));

    expect(res.status).toBe(403);
  });

  test('rôle en minuscules : 403 (comparaison exacte)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: 'admin', status: 'ACTIVE' });

    const res = await request(buildApp()).get('/admin').set('Authorization', bearerFor('u-2'));

    expect(res.status).toBe(403);
  });

  test('administrateur suspendu : 403', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: 'ADMIN', status: 'SUSPENDED' });

    const res = await request(buildApp()).get('/admin').set('Authorization', bearerFor('admin-2'));

    expect(res.status).toBe(403);
  });

  test('utilisateur inexistant : 403', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const res = await request(buildApp()).get('/admin').set('Authorization', bearerFor('ghost'));

    expect(res.status).toBe(403);
  });

  test('erreur base de données : 500 sans détail technique', async () => {
    mockPrisma.user.findUnique.mockRejectedValue(new Error('connection refused at 10.0.0.1'));

    const res = await request(buildApp()).get('/admin').set('Authorization', bearerFor('admin-1'));

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.1');
  });

  test('sans token : 401 avant toute requête en base', async () => {
    const res = await request(buildApp()).get('/admin');

    expect(res.status).toBe(401);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  test('configuration invalide détectée au démarrage', () => {
    expect(() => requireRole()).toThrow();
  });
});
