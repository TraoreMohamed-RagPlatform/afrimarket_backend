const express = require('express');
const request = require('supertest');
const { createApiLimiter, apiLimiter, API_MAX_REQUESTS } = require('../middleware/apiLimiter');

describe('Limiteur de débit commun', () => {
  test('au-delà de la limite : 429 avec un message JSON', async () => {
    const app = express();
    app.use(createApiLimiter({ limit: 2 }));
    app.get('/ping', (req, res) => res.json({ ok: true }));

    await request(app).get('/ping').expect(200);
    await request(app).get('/ping').expect(200);
    const res = await request(app).get('/ping');

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'Too many requests, please try again later.' });
    expect(res.headers.ratelimit).toBeDefined();
  });

  test('une requête n’est comptée qu’une fois (instance partagée)', async () => {
    const app = express();
    const router = express.Router();
    router.use(apiLimiter);
    router.get('/ping', (req, res) => res.json({ ok: true }));
    app.use('/api/a', router);

    const res = await request(app).get('/api/a/ping');

    expect(res.status).toBe(200);
    // En-tête standard (draft-8) : « "300-in-15min"; r=<restant>; t=<secondes> »
    expect(res.headers.ratelimit).toMatch(new RegExp(`; r=${API_MAX_REQUESTS - 1};`));
  });

  test('chaque routeur de l’API applique le limiteur commun', () => {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '../routes');
    const missing = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.js'))
      .filter((f) => !fs.readFileSync(path.join(dir, f), 'utf8').includes('apiLimiter'));

    expect(missing).toEqual([]);
  });
});
