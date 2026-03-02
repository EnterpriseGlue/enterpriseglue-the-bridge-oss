import { Router, type Request, type Response } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { isSamlAuthEnabled, getSamlAuthorizationUrl } from '@enterpriseglue/shared/services/saml.js';
import { config } from '@enterpriseglue/shared/config/index.js';

const router = Router();

/**
 * Initiate SAML flow (no HTTP param inputs)
 * GET /api/auth/saml/start
 */
router.get('/api/auth/saml/start', apiLimiter, async (_req: Request, res: Response) => {
  try {
    const enabled = await isSamlAuthEnabled();
    if (!enabled) {
      return res.status(503).json({
        error: 'SAML authentication is not configured',
        message: 'Please configure a SAML provider in Platform Settings',
      });
    }

    const relayState = Buffer.from(
      JSON.stringify({
        timestamp: Date.now(),
        nonce: Math.random().toString(36).substring(7),
      })
    ).toString('base64');

    res.cookie('oauth_state', relayState, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000,
    });

    const { url, entryPoint } = await getSamlAuthorizationUrl(relayState);

    let safeUrl: string | null = null;
    try {
      const authUrl = new URL(url);
      const idpUrl = new URL(entryPoint);

      if (
        authUrl.protocol === 'https:' &&
        idpUrl.protocol === 'https:' &&
        authUrl.hostname === idpUrl.hostname
      ) {
        safeUrl = authUrl.toString();
      }
    } catch {
      safeUrl = null;
    }

    if (!safeUrl) throw Errors.internal('Invalid SAML authorization URL');
    return res.redirect(safeUrl);
  } catch (error: any) {
    logger.error('[SAML Auth] Failed to initiate login:', error);
    throw Errors.internal('Failed to initiate SAML authentication');
  }
});

export default router;
