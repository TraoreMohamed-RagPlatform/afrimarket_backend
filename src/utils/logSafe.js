// Longueur maximale d'une valeur fournie par le client dans un journal.
const MAX_LOG_VALUE_LENGTH = 200;

/**
 * Prépare une valeur venant du client (URL, en-tête...) pour un journal.
 *
 * Les retours à la ligne sont retirés pour empêcher l'injection de fausses
 * lignes de journal (CWE-117), ainsi que les autres caractères de contrôle.
 * La valeur est aussi tronquée.
 *
 * @param {unknown} value
 * @returns {string}
 */
const sanitizeForLog = (value) =>
  String(value)
    .replace(/\n|\r/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, '')
    .slice(0, MAX_LOG_VALUE_LENGTH);

module.exports = { sanitizeForLog, MAX_LOG_VALUE_LENGTH };
