import { Router, type Request, type Response } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { isMicrosoftAuthEnabled, getAuthorizationUrl } from '@enterpriseglue/shared/services/microsoft.js';
import { config } from '@enterpriseglue/shared/config/index.js';

const router = Router();

/**
 * Initiate Microsoft OAuth flow (no HTTP param inputs)
 * GET /api/auth/microsoft/start
 */
router.get('/api/auth/microsoft/start', apiLimiter, async (_req: Request, res: Response) => {
  try {
    if (!isMicrosoftAuthEnabled()) {
      return res.status(503).json({
        error: 'Microsoft Entra ID authentication is not configured',
        message:
          'Please configure MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, and MICROSOFT_TENANT_ID in your environment',
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

    const authUrl = await getAuthorizationUrl(state);

    let safeUrl: string | null = null;
    try {
      const u = new URL(authUrl);
      if (u.protocol === 'https:' && u.hostname === 'login.microsoftonline.com') {
        safeUrl = u.toString();
      }
    } catch {
      safeUrl = null;
    }

    if (!safeUrl) throw Errors.internal('Invalid authorization URL');
    return res.redirect(safeUrl);
  } catch (error: any) {
    logger.error('[Microsoft Auth] Failed to initiate OAuth:', error);
    throw Errors.internal('Failed to initiate Microsoft authentication');
  }
});

export default router;
