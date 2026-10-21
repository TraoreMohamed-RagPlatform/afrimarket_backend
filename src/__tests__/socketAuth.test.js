const http = require('http');
const jwt = require('jsonwebtoken');
const { io: connectClient } = require('socket.io-client');
const { useTestJwtSecret, TEST_JWT_SECRET } = require('./helpers/auth');
const { generateAccessToken, TOKEN_ISSUER, TOKEN_AUDIENCE } = require('../utils/tokenUtils');

jest.mock('../lib/prisma', () => ({ user: { findUnique: jest.fn() } }));

const { initializeSocket, MAX_SOCKETS_PER_USER } = require('../socket');
const realtime = require('../services/realtime');

/** Comptes de test : statut par identifiant. */
const users = { alice: 'ACTIVE', bob: 'ACTIVE', ghost: 'DELETED', banned: 'SUSPENDED' };
const findUser = (id) => Promise.resolve(users[id] ? { status: users[id] } : null);

let server;
let url;
const clients = [];

/** Client connecté (ou refusé) ; toujours fermé après le test. */
const connect = (auth) => {
  const client = connectClient(url, {
    auth,
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  clients.push(client);
  return client;
};

const connected = (client) =>
  new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', (error) => reject(error));
  });

const refused = (client) =>
  new Promise((resolve, reject) => {
    client.once('connect', () => reject(new Error('connexion acceptée')));
    client.once('connect_error', (error) => resolve(error.message));
  });

const tokenFor = (userId) => generateAccessToken(userId);

/** Attend un événement, ou rien pendant [ms]. */
const nextEvent = (client, event, ms = 300) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    client.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

beforeAll(async () => {
  useTestJwtSecret();
  server = http.createServer();
  initializeSocket(server, { findUser });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => {
  while (clients.length) clients.pop().close();
});

afterAll(async () => {
  realtime.setRealtimeServer(null);
  await new Promise((resolve) => server.close(resolve));
});

describe('Connexion temps réel (Socket.io)', () => {
  test('sans jeton : refusée', async () => {
    expect(await refused(connect({}))).toBe('unauthorized');
  });

  test('jeton invalide : refusée', async () => {
    expect(await refused(connect({ token: 'pas.un.jeton' }))).toBe('unauthorized');
  });

  test('jeton signé avec un autre secret : refusé', async () => {
    const forged = jwt.sign({ userId: 'alice', typ: 'access' }, 'autre-secret', {
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    });
    expect(await refused(connect({ token: forged }))).toBe('unauthorized');
  });

  test('compte supprimé ou suspendu : refusé', async () => {
    expect(await refused(connect({ token: tokenFor('ghost') }))).toBe('unauthorized');
    expect(await refused(connect({ token: tokenFor('banned') }))).toBe('unauthorized');
  });

  test('compte inconnu : refusé', async () => {
    expect(await refused(connect({ token: tokenFor('personne') }))).toBe('unauthorized');
  });

  test('jeton valide : acceptée', async () => {
    await expect(connected(connect({ token: tokenFor('alice') }))).resolves.toBeUndefined();
  });

  test(`au-delà de ${MAX_SOCKETS_PER_USER} connexions pour un compte : refusée`, async () => {
    for (let i = 0; i < MAX_SOCKETS_PER_USER; i += 1) {
      await connected(connect({ token: tokenFor('alice') }));
    }
    expect(await refused(connect({ token: tokenFor('alice') }))).toBe('too_many_connections');
  });
});

describe('Événements : seulement au destinataire', () => {
  test('un message n’est reçu que par son destinataire', async () => {
    const alice = connect({ token: tokenFor('alice') });
    const bob = connect({ token: tokenFor('bob') });
    await Promise.all([connected(alice), connected(bob)]);

    const forAlice = nextEvent(alice, realtime.EVENTS.MESSAGE);
    const forBob = nextEvent(bob, realtime.EVENTS.MESSAGE);
    realtime.emitToUser('alice', realtime.EVENTS.MESSAGE, { conversationId: 'c1', content: 'Salut' });

    expect(await forAlice).toEqual({ conversationId: 'c1', content: 'Salut' });
    expect(await forBob).toBeNull();
  });

  test('plusieurs appareils du même compte reçoivent tous l’événement', async () => {
    const phone = connect({ token: tokenFor('alice') });
    const tablet = connect({ token: tokenFor('alice') });
    await Promise.all([connected(phone), connected(tablet)]);

    const both = Promise.all([
      nextEvent(phone, realtime.EVENTS.NOTIFICATION),
      nextEvent(tablet, realtime.EVENTS.NOTIFICATION),
    ]);
    realtime.emitToUser('alice', realtime.EVENTS.NOTIFICATION, { id: 'n1' });

    expect(await both).toEqual([{ id: 'n1' }, { id: 'n1' }]);
  });

  test('un client ne peut rien diffuser aux autres (ancien « message_received »)', async () => {
    const mallory = connect({ token: tokenFor('alice') });
    const bob = connect({ token: tokenFor('bob') });
    await Promise.all([connected(mallory), connected(bob)]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const received = Promise.all([
      nextEvent(bob, 'new_message'),
      nextEvent(bob, realtime.EVENTS.MESSAGE),
      nextEvent(bob, 'user_online'),
    ]);
    mallory.emit('message_received', { conversationId: 'c1', senderId: 'bob', content: 'Faux' });
    mallory.emit('user_login', 'bob');

    expect(await received).toEqual([null, null, null]);
    warn.mockRestore();
  });

  test('événement inconnu côté serveur : refusé (liste fermée)', () => {
    expect(() => realtime.emitToUser('alice', 'broadcast_all', {})).toThrow();
  });

  test('déconnexion de tous les appareils : connexions fermées', async () => {
    const alice = connect({ token: tokenFor('alice') });
    await connected(alice);
    const closed = new Promise((resolve) => alice.once('disconnect', resolve));

    realtime.disconnectUser('alice');

    expect(await closed).toBe('io server disconnect');
  });

  test('jeton expiré pendant la connexion : connexion fermée', async () => {
    const shortLived = jwt.sign(
      { userId: 'bob', typ: 'access', exp: Math.floor(Date.now() / 1000) + 1 },
      TEST_JWT_SECRET,
      { algorithm: 'HS256', issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE },
    );
    const bob = connect({ token: shortLived });
    await connected(bob);
    const closed = new Promise((resolve) => bob.once('disconnect', resolve));

    expect(await closed).toBe('io server disconnect');
  }, 5000);
});
