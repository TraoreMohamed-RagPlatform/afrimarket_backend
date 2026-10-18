const {
  MAX_DELAY_MINUTES,
  MIN_SAMPLES,
  nextResponseTime,
  recordReply,
  publicResponseTime,
} = require('../services/responseTime');

describe('Temps de réponse du vendeur', () => {
  describe('nextResponseTime', () => {
    test('première réponse : le délai lui-même', () => {
      expect(nextResponseTime(null, 0, 30)).toBe(30);
    });

    test('moyenne glissante : les réponses récentes comptent plus', () => {
      // 60 × 0,8 + 10 × 0,2 = 50
      expect(nextResponseTime(60, 5, 10)).toBe(50);
    });

    test('délai plafonné à 7 jours, jamais négatif', () => {
      expect(nextResponseTime(null, 0, MAX_DELAY_MINUTES * 10)).toBe(MAX_DELAY_MINUTES);
      expect(nextResponseTime(null, 0, -5)).toBe(0);
    });
  });

  describe('publicResponseTime', () => {
    test(`affiché à partir de ${MIN_SAMPLES} réponses`, () => {
      expect(publicResponseTime({ responseTimeMinutes: 20, responseSampleCount: MIN_SAMPLES })).toBe(20);
      expect(publicResponseTime({ responseTimeMinutes: 20, responseSampleCount: MIN_SAMPLES - 1 })).toBeNull();
      expect(publicResponseTime({ responseTimeMinutes: null, responseSampleCount: 10 })).toBeNull();
      expect(publicResponseTime()).toBeNull();
    });
  });

  describe('recordReply', () => {
    const fakePrisma = (user = { responseTimeMinutes: 60, responseSampleCount: 4 }) => ({
      user: { findUnique: jest.fn().mockResolvedValue(user), update: jest.fn().mockResolvedValue({}) },
    });
    const now = new Date('2026-10-18T12:00:00Z');

    test('réponse à l’autre personne : moyenne mise à jour', async () => {
      const prisma = fakePrisma();

      const counted = await recordReply({
        prisma,
        responderId: 'seller',
        previousMessage: { senderId: 'buyer', createdAt: '2026-10-18T11:50:00Z' },
        now,
      });

      expect(counted).toBe(true);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'seller' },
        data: { responseTimeMinutes: 50, responseSampleCount: { increment: 1 } },
      });
    });

    test.each([
      ['premier message de la conversation', undefined],
      ['suite de son propre message', { senderId: 'seller', createdAt: '2026-10-18T11:00:00Z' }],
      ['date illisible', { senderId: 'buyer', createdAt: 'hier' }],
    ])('%s : non compté', async (_name, previousMessage) => {
      const prisma = fakePrisma();

      const counted = await recordReply({ prisma, responderId: 'seller', previousMessage, now });

      expect(counted).toBe(false);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
