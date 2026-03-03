import { Router, type Request, type Response } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { isGoogleAuthEnabled, getGoogleAuthorizationUrl } from '@enterpriseglue/shared/services/google.js';
import { config } from '@enterpriseglue/shared/config/index.js';

const router = Router();

/**
 * Initiate Google OAuth flow (no HTTP param inputs)
 * GET /api/auth/google/start
 */
router.get('/api/auth/google/start', apiLimiter, async (_req: Request, res: Response) => {
  try {
    const enabled = await isGoogleAuthEnabled();
    if (!enabled) {
      return res.status(503).json({
        error: 'Google authentication is not configured',
        message: 'Please configure Google OAuth in Platform Settings or environment variables',
      });
    }

    const state = Buffer.from(
      JSON.stringify({
        timestamp: Date.now(),
        nonce: Math.random().toString(36).substring(7),
      })
    ).toString('base64');

    res.cookie('oauth_state', state, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000,
    });

    const authUrl = await getGoogleAuthorizationUrl(state);

    let safeUrl: string | null = null;
    try {
      const u = new URL(authUrl);
      if (u.protocol === 'https:' && u.hostname === 'accounts.google.com') {
        safeUrl = u.toString();
      }
    } catch {
      safeUrl = null;
    }

    if (!safeUrl) throw Errors.internal('Invalid authorization URL');
    return res.redirect(safeUrl);
  } catch (error: any) {
    logger.error('[Google Auth] Failed to initiate OAuth:', error);
    throw Errors.internal('Failed to initiate Google authentication');
  }
});

export default router;
