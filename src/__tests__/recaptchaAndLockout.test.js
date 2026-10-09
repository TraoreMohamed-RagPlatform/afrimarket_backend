jest.mock('axios', () => ({ post: jest.fn() }));

const axios = require('axios');
const RecaptchaService = require('../utils/recaptchaService');
const {
  checkLoginLockout,
  recordFailedLogin,
  resetLoginAttempts,
} = require('../middleware/loginLockoutMiddleware');

describe('reCAPTCHA : refus sans appel réseau si le jeton est absent', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each([undefined, '', 42, { a: 1 }, 'x'.repeat(5000)])('jeton invalide (%p) : refusé', async (token) => {
    await expect(RecaptchaService.verifyToken(token)).resolves.toMatchObject({ success: false });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('score absent dans la réponse : refusé (fermé par défaut)', async () => {
    axios.post.mockResolvedValue({ data: { success: true } });

    await expect(RecaptchaService.verifyToken('token')).resolves.toMatchObject({ success: false });
  });
});

describe('Verrouillage après échecs de connexion', () => {
  const EMAIL = 'lockout-test@example.com';

  const runCheck = () => {
    const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
    const next = jest.fn();
    checkLoginLockout({ body: { email: EMAIL } }, res, next);
    return { res, next };
  };

  beforeAll(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
  afterAll(() => console.warn.mockRestore());
  afterEach(() => resetLoginAttempts(EMAIL));

  test('les échecs s’accumulent et le compte est verrouillé au 5e (429)', () => {
    for (let i = 0; i < 5; i += 1) {
      expect(runCheck().next).toHaveBeenCalled();
      recordFailedLogin(EMAIL);
    }

    const { res, next } = runCheck();

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });

  test('l’e-mail n’apparaît pas dans les journaux', () => {
    for (let i = 0; i < 5; i += 1) recordFailedLogin(EMAIL);

    expect(JSON.stringify(console.warn.mock.calls)).not.toContain(EMAIL);
  });
});
