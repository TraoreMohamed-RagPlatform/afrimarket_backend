const bcrypt = require('bcryptjs');

/**
 * Règles communes pour tous les mots de passe (inscription, réinitialisation,
 * changement) : un seul endroit à modifier.
 */
const PASSWORD_MIN_LENGTH = 8;
// bcrypt ignore tout ce qui dépasse 72 octets : on refuse plutôt que tronquer
// en silence.
const PASSWORD_MAX_BYTES = 72;
const BCRYPT_ROUNDS = 12;

// Empreinte d'un mot de passe aléatoire inconnu, utilisée quand l'e-mail
// n'existe pas : la réponse prend le même temps, ce qui empêche de deviner
// quels e-mails ont un compte (énumération par mesure du temps).
const DUMMY_PASSWORD_HASH = '$2b$12$OT1q2cldyqNgpHGdK./iuewzdwtbWxIeBx4gY/sqEsus2nmnCobRS';

const isPasswordAcceptable = (password) =>
  typeof password === 'string' &&
  password.length >= PASSWORD_MIN_LENGTH &&
  Buffer.byteLength(password, 'utf8') <= PASSWORD_MAX_BYTES;

const PASSWORD_RULE_MESSAGE = `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères (${PASSWORD_MAX_BYTES} octets au plus).`;

const hashPassword = (password) => bcrypt.hash(password, BCRYPT_ROUNDS);

/**
 * Compare le mot de passe à l'empreinte, en temps comparable que
 * l'utilisateur existe ou non.
 */
const verifyPassword = (password, hash) =>
  bcrypt.compare(typeof password === 'string' ? password : '', hash || DUMMY_PASSWORD_HASH);

module.exports = {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_BYTES,
  BCRYPT_ROUNDS,
  PASSWORD_RULE_MESSAGE,
  isPasswordAcceptable,
  hashPassword,
  verifyPassword,
};
