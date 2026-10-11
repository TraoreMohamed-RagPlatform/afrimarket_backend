const express = require('express');
const request = require('supertest');

const { APP_CHECK_HEADER, allowedAppIds, createVerifyClient } = require('../middleware/verifyClient');

const APP_ID = '1:123:android:abc';

const build = ({ appCheck, recaptcha, appIds = [] } = {}) => {
  const verifyAppCheck = jest.fn(appCheck || (() => Promise.reject(new Error('invalid'))));
  const verifyRecaptcha = jest.fn(recaptcha || (() => Promise.resolve({ success: false })));
  const app = express();
  app.use(express.json());
  app.post(
    '/login',
    createVerifyClient({ verifyAppCheck, verifyRecaptcha, getAppIds: () => appIds }),
    (req, res) => res.json({ ok: true }),
  );
  app.use((err, req, res, _next) => res.status(500).json({ error: 'Internal server error' }));
  return { app, verifyAppCheck, verifyRecaptcha };
};

describe('verifyClient : App Check (mobile) ou reCAPTCHA (web)', () => {
  test('sans aucune preuve : 403', async () => {
    const { app } = build();

    await request(app).post('/login').send({}).expect(403);
  });

  test('App Check valide : accepté, jeton consommé (usage unique)', async () => {
    const { app, verifyAppCheck, verifyRecaptcha } = build({
      appCheck: () => Promise.resolve({ appId: APP_ID, alreadyConsumed: false }),
    });

    await request(app).post('/login').set(APP_CHECK_HEADER, 'token').send({}).expect(200);
    expect(verifyAppCheck).toHaveBeenCalledWith('token');
    expect(verifyRecaptcha).not.toHaveBeenCalled();
  });

  test('App Check rejoué (déjà consommé) : 403', async () => {
    const { app } = build({ appCheck: () => Promise.resolve({ appId: APP_ID, alreadyConsumed: true }) });

    await request(app).post('/login').set(APP_CHECK_HEADER, 'token').send({}).expect(403);
  });

  test('App Check invalide : 403, même avec un reCAPTCHA valide dans le corps', async () => {
    const { app, verifyRecaptcha } = build({ recaptcha: () => Promise.resolve({ success: true }) });

    await request(app).post('/login').set(APP_CHECK_HEADER, 'faux').send({ recaptchaToken: 'ok' }).expect(403);
    expect(verifyRecaptcha).not.toHaveBeenCalled();
  });

  test('App Check d’une application non autorisée : 403', async () => {
    const { app } = build({
      appCheck: () => Promise.resolve({ appId: 'autre-app', alreadyConsumed: false }),
      appIds: [APP_ID],
    });

    await request(app).post('/login').set(APP_CHECK_HEADER, 'token').send({}).expect(403);
  });

  test('App Check d’une application autorisée : 200', async () => {
    const { app } = build({
      appCheck: () => Promise.resolve({ appId: APP_ID, alreadyConsumed: false }),
      appIds: [APP_ID],
    });

    await request(app).post('/login').set(APP_CHECK_HEADER, 'token').send({}).expect(200);
  });

  test('en-tête App Check vide ou trop long : 403 sans appel à Firebase', async () => {
    const { app, verifyAppCheck } = build();

    await request(app).post('/login').set(APP_CHECK_HEADER, '').send({}).expect(403);
    await request(app).post('/login').set(APP_CHECK_HEADER, 'x'.repeat(5000)).send({}).expect(403);
    expect(verifyAppCheck).not.toHaveBeenCalled();
  });

  test('reCAPTCHA valide (web) : accepté', async () => {
    const { app, verifyRecaptcha } = build({ recaptcha: () => Promise.resolve({ success: true }) });

    await request(app).post('/login').send({ recaptchaToken: 'web-token' }).expect(200);
    expect(verifyRecaptcha).toHaveBeenCalledWith('web-token');
  });

  test('reCAPTCHA refusé : 403', async () => {
    const { app } = build();

    await request(app).post('/login').send({ recaptchaToken: 'bot' }).expect(403);
  });

  test('erreur interne pendant la vérification reCAPTCHA : 500 générique', async () => {
    const { app } = build({ recaptcha: () => Promise.reject(new Error('boom 10.0.0.1')) });

    const res = await request(app).post('/login').send({ recaptchaToken: 'x' });

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.1');
  });

  test('liste des applications autorisées lue depuis APP_CHECK_APP_IDS', () => {
    expect(allowedAppIds({ APP_CHECK_APP_IDS: ` ${APP_ID} , 1:123:ios:def,, ` })).toEqual([APP_ID, '1:123:ios:def']);
    expect(allowedAppIds({})).toEqual([]);
  });
});
