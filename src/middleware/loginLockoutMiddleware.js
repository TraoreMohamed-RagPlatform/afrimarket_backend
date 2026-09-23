// Stockage en mémoire des tentatives échouées (en production, utiliser Redis)
const failedLoginAttempts = new Map();

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes

/**
 * Middleware pour vérifier si l'utilisateur est verrouillé
 */
const checkLoginLockout = (req, res, next) => {
  const email = req.body.email;

  if (!email) {
    return res.status(400).json({ error: 'Email requis' });
  }

  const lockoutData = failedLoginAttempts.get(email);

  if (lockoutData) {
    const timePassed = Date.now() - lockoutData.lockedAt;

    if (timePassed < LOCKOUT_TIME) {
      const timeRemaining = Math.ceil((LOCKOUT_TIME - timePassed) / 1000 / 60);
      return res.status(429).json({
        error: `Compte temporairement verrouillé. Réessayez dans ${timeRemaining} minutes.`,
      });
    } else {
      // Le délai de verrouillage a expiré
      failedLoginAttempts.delete(email);
    }
  }

  next();
};

/**
 * Enregistrer une tentative de connexion échouée
 */
const recordFailedLogin = (email) => {
  if (!failedLoginAttempts.has(email)) {
    failedLoginAttempts.set(email, {
      attempts: 0,
      lockedAt: null,
    });
  }

  const data = failedLoginAttempts.get(email);
  data.attempts += 1;

  if (data.attempts >= MAX_LOGIN_ATTEMPTS) {
    data.lockedAt = Date.now();
    console.log(`🔒 Compte ${email} verrouillé après ${MAX_LOGIN_ATTEMPTS} tentatives`);
  }
};

/**
 * Réinitialiser les tentatives échouées (après une connexion réussie)
 */
const resetLoginAttempts = (email) => {
  if (failedLoginAttempts.has(email)) {
    failedLoginAttempts.delete(email);
    console.log(`✅ Tentatives de connexion réinitialisées pour ${email}`);
  }
};

module.exports = {
  checkLoginLockout,
  recordFailedLogin,
  resetLoginAttempts,
};