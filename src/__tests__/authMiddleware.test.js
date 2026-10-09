const jwt = require('jsonwebtoken');
const authMiddleware = require('../middleware/authMiddleware');
const { useTestJwtSecret, bearerFor, TEST_JWT_SECRET } = require('./helpers/auth');

const run = (authorization) => {
  const req = { headers: authorization ? { authorization } : {} };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  const next = jest.fn();
  authMiddleware(req, res, next);
  return { req, res, next };
};

describe('authMiddleware', () => {
  beforeAll(useTestJwtSecret);

  test('token valide : expose req.user.userId et continue', () => {
    const { req, res, next } = run(bearerFor('user-123'));

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(req.user).toEqual({ userId: 'user-123' });
  });

  test('sans en-tête : 401', () => {
    const { res, next } = run(undefined);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  test('schéma autre que Bearer : 401', () => {
    const { res, next } = run('Basic abc');

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  test('token signé avec un autre secret : 401', () => {
    const forged = jwt.sign({ userId: 'attacker' }, 'not-the-secret');
    const { res, next } = run(`Bearer ${forged}`);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  test('algorithme "none" refusé : 401', () => {
    const unsigned = jwt.sign({ userId: 'attacker' }, null, { algorithm: 'none' });
    const { res, next } = run(`Bearer ${unsigned}`);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  test('token valide mais sans userId : 401', () => {
    const noUser = jwt.sign({ sub: 'x' }, TEST_JWT_SECRET, { algorithm: 'HS256' });
    const { res, next } = run(`Bearer ${noUser}`);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
