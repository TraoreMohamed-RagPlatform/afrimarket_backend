const { validateEnv, MIN_JWT_SECRET_LENGTH } = require('../config/env');

const STRONG_SECRET = 'k'.repeat(MIN_JWT_SECRET_LENGTH);
const base = { JWT_SECRET: STRONG_SECRET, DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

describe('validateEnv', () => {
  test('configuration valide', () => {
    const result = validateEnv({ ...base, PORT: '4000', CORS_ORIGINS: 'https://admin.afrimarket.ma' });

    expect(result.ok).toBe(true);
    expect(result.config.port).toBe(4000);
    expect(result.config.corsOrigins).toEqual(['https://admin.afrimarket.ma']);
  });

  test('secret JWT trop court : refus de démarrer', () => {
    const result = validateEnv({ ...base, JWT_SECRET: 'court' });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/JWT_SECRET/);
  });

  test('secret JWT d’exemple : refus de démarrer', () => {
    const result = validateEnv({
      ...base,
      JWT_SECRET: 'your_super_secret_jwt_key_change_this_in_production',
    });

    expect(result.ok).toBe(false);
  });

  test('DATABASE_URL manquante : refus de démarrer', () => {
    const result = validateEnv({ JWT_SECRET: STRONG_SECRET });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/DATABASE_URL/);
  });

  test('port invalide : refus de démarrer', () => {
    expect(validateEnv({ ...base, PORT: '99999' }).ok).toBe(false);
  });

  test('origine CORS mal formée : refus de démarrer', () => {
    expect(validateEnv({ ...base, CORS_ORIGINS: 'admin.afrimarket.ma' }).ok).toBe(false);
    expect(validateEnv({ ...base, CORS_ORIGINS: '*' }).ok).toBe(false);
  });

  test('sans CORS_ORIGINS : reprend CLIENT_URL et ADMIN_DASHBOARD_URL', () => {
    const result = validateEnv({
      ...base,
      CLIENT_URL: 'http://localhost:3000',
      ADMIN_DASHBOARD_URL: 'http://localhost:5173',
    });

    expect(result.config.corsOrigins).toEqual(['http://localhost:3000', 'http://localhost:5173']);
  });

  test('repli : seule l’origine des URL est gardée, sans doublon', () => {
    const result = validateEnv({
      ...base,
      CLIENT_URL: 'http://localhost:3000/app',
      ADMIN_DASHBOARD_URL: 'http://localhost:3000/admin/dashboard',
    });

    expect(result.ok).toBe(true);
    expect(result.config.corsOrigins).toEqual(['http://localhost:3000']);
  });
});
