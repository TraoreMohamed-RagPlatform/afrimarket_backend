/**
 * Règle de décision d'une demande de vérification d'identité (KYC).
 *
 * La décision automatique (approbation ou rejet sans humain) n'est autorisée
 * que si elle est explicitement activée par `KYC_AUTO_DECISION_ENABLED=true`.
 * Par défaut, toute demande part en revue manuelle : tant qu'aucune détection
 * du vivant (anti-usurpation) réelle n'est branchée, un score automatique
 * peut être trompé par une simple photo d'une photo.
 */

const KYC_OUTCOME = Object.freeze({
  VERIFIED: 'VERIFIED',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
  REJECTED: 'REJECTED',
});

const AUTO_APPROVE_MIN_SCORE = 90;
const MANUAL_REVIEW_MIN_SCORE = 60;

const isAutoDecisionEnabled = (env = process.env) =>
  env.KYC_AUTO_DECISION_ENABLED === 'true';

/**
 * @param {number} score Score global de 0 à 100.
 * @param {{ autoDecisionEnabled?: boolean }} [options]
 * @returns {string} Une valeur de KYC_OUTCOME.
 */
const decideKycOutcome = (score, { autoDecisionEnabled = isAutoDecisionEnabled() } = {}) => {
  if (!autoDecisionEnabled || !Number.isFinite(score)) {
    return KYC_OUTCOME.MANUAL_REVIEW;
  }
  if (score >= AUTO_APPROVE_MIN_SCORE) return KYC_OUTCOME.VERIFIED;
  if (score >= MANUAL_REVIEW_MIN_SCORE) return KYC_OUTCOME.MANUAL_REVIEW;
  return KYC_OUTCOME.REJECTED;
};

module.exports = {
  KYC_OUTCOME,
  AUTO_APPROVE_MIN_SCORE,
  MANUAL_REVIEW_MIN_SCORE,
  isAutoDecisionEnabled,
  decideKycOutcome,
};
