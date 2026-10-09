const express = require('express');
const request = require('supertest');

const { sanitizeForLog, MAX_LOG_VALUE_LENGTH } = require('../utils/logSafe');
const errorHandler = require('../middleware/errorHandler');

describe('Journaux : aucune donnée client ne peut forger une ligne', () => {
  test('retours à la ligne et caractères de contrôle retirés', () => {
    expect(sanitizeForLog('/api/x\r\n[ADMIN] login ok\u0007\u2028')).toBe('/api/x[ADMIN] login ok');
  });

  test('valeur tronquée', () => {
    expect(sanitizeForLog('a'.repeat(1000))).toHaveLength(MAX_LOG_VALUE_LENGTH);
  });

  test('gestionnaire d’erreurs : format fixe, URL nettoyée, réponse générique', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const app = express();
    app.get('/boom', () => {
      throw new Error('secret interne');
    });
    app.use(errorHandler);

    const res = await request(app).get('/boom?q=%25s%0A%5BFAKE%5D');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    const [format, method, url] = spy.mock.calls[0];
    expect(format).toBe('Unhandled error on %s %s');
    expect(method).toBe('GET');
    expect(url).not.toMatch(/[\r\n]/);
    spy.mockRestore();
  });
});
