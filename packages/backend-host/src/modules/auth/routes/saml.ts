import { Router, Request, Response } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { asyncHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import {
  getSamlStatus,
  isSamlAuthEnabled,
  validateSamlPostResponse,
  extractSamlUserInfo,
  provisionSamlUser,
  generateSamlServiceProviderMetadata,
} from '@enterpriseglue/shared/services/saml.js';
import { logAudit, AuditActions } from '@enterpriseglue/shared/services/audit.js';
import { config, shouldUseSecureCookies } from '@enterpriseglue/shared/config/index.js';
import { authSessionService } from '@enterpriseglue/shared/services/AuthSessionService.js';
import { samlAssertionReplayService } from '@enterpriseglue/shared/services/platform-admin/SamlAssertionReplayService.js';
import { SamlAuthenticationStatusSchema } from '@enterpriseglue/shared/schemas/platform-admin/authz.js';
import {
  appendSsoStartQuery,
  getSsoRedirectUrl,
  getSsoReturnPath,
  notifySsoUserProvisioned,
  parseSsoState,
} from './sso-state.js';

const router = Router();

function samlCallbackFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return message === 'SAML assertion has already been used'
    ? message
    : 'SAML authentication failed';
}

/**
 * Check if SAML auth is enabled
 * GET /api/auth/saml/status
 */
router.get('/api/auth/saml/status', apiLimiter, asyncHandler(async (_req: Request, res: Response) => {
  const status = await getSamlStatus();
  res.json(SamlAuthenticationStatusSchema.parse(status));
}));

/**
 * Initiate SAML flow
 * GET /api/auth/saml
 */
router.get('/api/auth/saml', apiLimiter, asyncHandler(async (req: Request, res: Response) => {
  const enabled = await isSamlAuthEnabled();
  if (!enabled) {
    return res.status(503).json({
      error: 'SAML authentication is not configured',
      message: 'Please configure a SAML provider in Platform Settings',
    });
  }

  return res.redirect(appendSsoStartQuery(req, '/api/auth/saml/start'));
}));

/**
 * SAML Service Provider metadata endpoint
 * GET /api/auth/saml/metadata
 */
router.get('/api/auth/saml/metadata', apiLimiter, asyncHandler(async (req: Request, res: Response) => {
  const providerId = typeof req.query.providerId === 'string' ? req.query.providerId : undefined;
  const metadata = providerId
    ? await generateSamlServiceProviderMetadata(providerId)
    : await generateSamlServiceProviderMetadata();
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
    const ssoState = parseSsoState(relayState);

    res.clearCookie('oauth_state');

    const { profile, providerId } = ssoState?.providerId
      ? await validateSamlPostResponse(samlResponse, ssoState.providerId)
      : await validateSamlPostResponse(samlResponse);
    await samlAssertionReplayService.consume({ providerId, samlResponse });
    const userInfo = extractSamlUserInfo(profile);

    logger.info('[SAML Auth] User info extracted', { subjectPresent: Boolean(userInfo.oid) });

    const user = await provisionSamlUser(userInfo, providerId);
    if (!user) {
      throw new Error('Failed to provision user');
    }

    if (!user.isActive) {
      logger.warn('[SAML Auth] User account is deactivated', { userId: user.id });

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

    await notifySsoUserProvisioned(req, {
      provider: 'saml',
      providerId,
      tenantSlug: ssoState?.tenantSlug ?? null,
      returnTo: getSsoReturnPath(ssoState),
      user,
      userInfo,
    });

    const session = await authSessionService.issue(user, {
      identityProviderId: providerId || null,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      ipAddress: req.ip,
    });

    await logAudit({
      action: AuditActions.LOGIN_SUCCESS,
      userId: user.id,
      details: { provider: 'saml' },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.cookie('accessToken', session.accessToken, {
      httpOnly: true,
      secure: shouldUseSecureCookies(),
      sameSite: 'lax',
      maxAge: session.expiresIn * 1000,
      path: '/',
    });

    res.cookie('refreshToken', session.refreshToken, {
      httpOnly: true,
      secure: shouldUseSecureCookies(),
      sameSite: 'lax',
      maxAge: config.jwtRefreshTokenExpires * 1000,
      path: '/',
    });

    res.redirect(getSsoRedirectUrl(ssoState));
  } catch (error: any) {
    const safeMessage = samlCallbackFailureMessage(error);
    logger.warn('[SAML Auth] Callback failed', { reason: safeMessage === 'SAML assertion has already been used' ? 'assertion_replayed' : 'authentication_failed' });
    const errorUrl = `${config.frontendUrl}/login?error=saml_auth_failed&message=${encodeURIComponent(safeMessage)}`;
    return res.redirect(errorUrl);
  }
}));

export default router;
