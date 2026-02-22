import { Router, Request, Response } from 'express';
import { apiLimiter } from '@shared/middleware/rateLimiter.js';
import { asyncHandler } from '@shared/middleware/errorHandler.js';
import { logger } from '@shared/utils/logger.js';
import {
  getSamlStatus,
  isSamlAuthEnabled,
  validateSamlPostResponse,
  extractSamlUserInfo,
  provisionSamlUser,
  generateSamlServiceProviderMetadata,
} from '@shared/services/saml.js';
import { generateAccessToken, generateRefreshToken } from '@shared/utils/jwt.js';
import { logAudit, AuditActions } from '@shared/services/audit.js';
import { config } from '@shared/config/index.js';

const router = Router();

/**
 * Check if SAML auth is enabled
 * GET /api/auth/saml/status
 */
router.get('/api/auth/saml/status', apiLimiter, asyncHandler(async (_req: Request, res: Response) => {
  const status = await getSamlStatus();
  res.json(status);
}));

/**
 * Initiate SAML flow
 * GET /api/auth/saml
 */
router.get('/api/auth/saml', apiLimiter, asyncHandler(async (_req: Request, res: Response) => {
  const enabled = await isSamlAuthEnabled();
  if (!enabled) {
    return res.status(503).json({
      error: 'SAML authentication is not configured',
      message: 'Please configure a SAML provider in Platform Settings',
    });
  }

  return res.redirect('/api/auth/saml/start');
}));

/**
 * SAML Service Provider metadata endpoint
 * GET /api/auth/saml/metadata
 */
router.get('/api/auth/saml/metadata', apiLimiter, asyncHandler(async (_req: Request, res: Response) => {
  const metadata = await generateSamlServiceProviderMetadata();
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.send(metadata);
}));

/**
 * Handle SAML callback (Assertion Consumer Service endpoint)
 * POST /api/auth/saml/callback
 */
router.post('/api/auth/saml/callback', apiLimiter, asyncHandler(async (req: Request, res: Response) => {
  try {
    const samlResponse = typeof req.body?.SAMLResponse === 'string' ? req.body.SAMLResponse : '';
    const relayState = typeof req.body?.RelayState === 'string' ? req.body.RelayState : '';

    if (!samlResponse) {
      throw new Error('Missing SAMLResponse');
    }

    const storedState = req.cookies.oauth_state;
    if (!storedState || storedState !== relayState) {
      logger.error('[SAML Auth] RelayState mismatch - possible CSRF attack');
      return res.status(400).json({ error: 'Invalid relay state' });
    }

    res.clearCookie('oauth_state');

    const { profile, providerId } = await validateSamlPostResponse(samlResponse);
    const userInfo = extractSamlUserInfo(profile);

    logger.info('[SAML Auth] User info extracted:', {
      oid: userInfo.oid,
      email: userInfo.email,
      name: userInfo.name,
    });

    const user = await provisionSamlUser(userInfo, providerId);
    if (!user) {
      throw new Error('Failed to provision user');
    }

    if (!user.isActive) {
      logger.warn('[SAML Auth] User account is deactivated:', user.email);

      await logAudit({
        action: AuditActions.LOGIN_FAILED,
        userId: user.id,
        details: { reason: 'Account deactivated', provider: 'saml' },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      const errorUrl = `${config.frontendUrl}/login?error=account_deactivated&message=Your account has been deactivated`;
      return res.redirect(errorUrl);
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await logAudit({
      action: AuditActions.LOGIN_SUCCESS,
      userId: user.id,
      details: { provider: 'saml', entraId: userInfo.oid },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'strict',
      maxAge: config.jwtAccessTokenExpires * 1000,
    });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'strict',
      maxAge: config.jwtRefreshTokenExpires * 1000,
    });

    res.redirect(`${config.frontendUrl}/`);
  } catch (error: any) {
    logger.error('[SAML Auth] Callback failed:', error);

    const rawMessage = String(error?.message || 'Authentication failed');
    const safeMessage = rawMessage.replace(/[<>]/g, '').slice(0, 200);
    const errorUrl = `${config.frontendUrl}/login?error=saml_auth_failed&message=${encodeURIComponent(safeMessage)}`;
    return res.redirect(errorUrl);
  }
}));

export default router;
