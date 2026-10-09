const {
  decideKycOutcome,
  isAutoDecisionEnabled,
  KYC_OUTCOME,
} = require('../services/kycDecision');

describe('Décision KYC', () => {
  describe('décision automatique désactivée (défaut)', () => {
    test.each([0, 59, 60, 89, 90, 100])('score %p → revue manuelle', (score) => {
      expect(decideKycOutcome(score, { autoDecisionEnabled: false })).toBe(
        KYC_OUTCOME.MANUAL_REVIEW,
      );
    });

    test('variable absente → désactivée', () => {
      expect(isAutoDecisionEnabled({})).toBe(false);
    });

    test('seule la valeur exacte "true" l’active', () => {
      expect(isAutoDecisionEnabled({ KYC_AUTO_DECISION_ENABLED: 'TRUE' })).toBe(false);
      expect(isAutoDecisionEnabled({ KYC_AUTO_DECISION_ENABLED: '1' })).toBe(false);
      expect(isAutoDecisionEnabled({ KYC_AUTO_DECISION_ENABLED: 'true' })).toBe(true);
    });
  });

  describe('décision automatique activée', () => {
    const decide = (score) => decideKycOutcome(score, { autoDecisionEnabled: true });

    test('score ≥ 90 → approuvé', () => {
      expect(decide(90)).toBe(KYC_OUTCOME.VERIFIED);
      expect(decide(100)).toBe(KYC_OUTCOME.VERIFIED);
    });

    test('60 ≤ score < 90 → revue manuelle', () => {
      expect(decide(60)).toBe(KYC_OUTCOME.MANUAL_REVIEW);
      expect(decide(89)).toBe(KYC_OUTCOME.MANUAL_REVIEW);
    });

    test('score < 60 → rejeté', () => {
      expect(decide(59)).toBe(KYC_OUTCOME.REJECTED);
      expect(decide(0)).toBe(KYC_OUTCOME.REJECTED);
    });

    test('score invalide → revue manuelle (jamais d’approbation par erreur)', () => {
      expect(decide(NaN)).toBe(KYC_OUTCOME.MANUAL_REVIEW);
      expect(decide(undefined)).toBe(KYC_OUTCOME.MANUAL_REVIEW);
      expect(decide(Infinity)).toBe(KYC_OUTCOME.MANUAL_REVIEW);
    });
  });
});
