const express = require('express');
const request = require('supertest');

const { loginLimiter, registerLimiter } = require('../middleware/rateLimitMiddleware');

const appWith = (limiter, status) => {
  const app = express();
  app.post('/try', limiter, (req, res) => res.status(status).json({}));
  return app;
};

describe('Limiteurs de l’authentification', () => {
  // Les limiteurs sont partagés (même compteur par adresse IP) : le test des
  // réussites passe en premier, sans quoi le compteur serait déjà plein.
  test('connexion : les réussites ne sont pas comptées', async () => {
    const app = appWith(loginLimiter, 200);
    for (let i = 0; i < 8; i += 1) {
      await request(app).post('/try').expect(200);
    }
  });

  test('connexion : 5 échecs, puis 429', async () => {
    const app = appWith(loginLimiter, 401);
    for (let i = 0; i < 5; i += 1) {
      await request(app).post('/try').expect(401);
    }

    await request(app).post('/try').expect(429);
  });

  test('inscription : 5 par heure, puis 429', async () => {
    const app = appWith(registerLimiter, 201);
    for (let i = 0; i < 5; i += 1) {
      await request(app).post('/try').expect(201);
    }

    await request(app).post('/try').expect(429);
  });
});
