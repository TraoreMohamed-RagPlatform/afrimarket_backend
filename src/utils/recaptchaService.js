// src/utils/recaptchaService.js
const axios = require('axios');

const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;
const RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

class RecaptchaService {
  static async verifyToken(token) {
    try {
      if (typeof token !== 'string' || token.length === 0 || token.length > 4096) {
        return { success: false, error: 'reCAPTCHA token is required' };
      }

      const response = await axios.post(RECAPTCHA_VERIFY_URL, null, {
        params: {
          secret: RECAPTCHA_SECRET_KEY,
          response: token,
        },
      });

      const { success, score, action, challenge_ts, hostname, error_codes } =
        response.data;

      if (!success) {
        return {
          success: false,
          error: `reCAPTCHA verification failed: ${error_codes?.join(', ')}`,
        };
      }

      // reCAPTCHA v3 : score 0.0 = bot, 1.0 = human
      // Seuil recommandé : 0.5
      if (typeof score !== 'number' || score < 0.5) {
        return {
          success: false,
          score,
          error: 'reCAPTCHA score too low (suspected bot)',
        };
      }

      return {
        success: true,
        score,
        action,
        challenge_ts,
        hostname,
      };
    } catch (error) {
      console.error('reCAPTCHA verification error:', error.message);
      return {
        success: false,
        error: 'Failed to verify reCAPTCHA',
      };
    }
  }
}

module.exports = RecaptchaService;