import { Router, type Request, type Response } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { identityProviderService } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js';
import { genericOidcService } from '@enterpriseglue/shared/services/platform-admin/GenericOidcService.js';
import { identityProviderProvisioningService } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderProvisioningService.js';
import { generateAccessToken, generateRefreshToken } from '@enterpriseglue/shared/utils/jwt.js';
import { auditFromRequest, logAudit, AuditActions } from '@enterpriseglue/shared/services/audit.js';
import { config, shouldUseSecureCookies } from '@enterpriseglue/shared/config/index.js';
import { buildSsoState, getSsoRedirectUrl, parseSsoState } from './sso-state.js';

const router = Router();
const stateCookie = 'identity_oidc_state';
const verifierCookie = 'identity_oidc_verifier';

function configuration(provider: { configurationJson: string }): Record<string, unknown> {
  try {
    const parsed = JSON.parse(provider.configurationJson);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
    return parsed;
  } catch {
    throw Errors.validation('Identity provider configuration is invalid');
  }
}

function requireDirectOidc(provider: { protocol: string; isEnabled: boolean; authenticationMode: string }) {
  if (!provider.isEnabled) throw Errors.notFound('Identity provider not found');
  if (provider.protocol !== 'oidc') throw Errors.validation('This identity provider does not use OIDC');
  if (provider.authenticationMode !== 'direct') throw Errors.forbidden('This identity provider accepts upstream claims and cannot initiate login');
}

router.get('/api/auth/identity/:key/start', apiLimiter, asyncHandler(async (req: Request, res: Response) => {
  const providerKey = typeof req.params.key === 'string' ? req.params.key : '';
  if (!providerKey) throw Errors.validation('Identity provider key is required');
  const provider = await identityProviderService.getByKey(providerKey, req.tenant?.tenantId || null);
  if (!provider) throw Errors.notFound('Identity provider not found');
  requireDirectOidc(provider);
  const state = buildSsoState(req, provider.id, { key: provider.key, tenantId: provider.tenantId });
  const parsed = parseSsoState(state);
  if (!parsed) throw Errors.internal('Unable to initialize identity provider state');
  const request = await genericOidcService.createAuthorizationRequest(configuration(provider), state, parsed.nonce);
  const cookieOptions = { httpOnly: true, secure: shouldUseSecureCookies(), sameSite: 'lax' as const, maxAge: 10 * 60 * 1000, path: '/' };
  res.cookie(stateCookie, state, cookieOptions);
  res.cookie(verifierCookie, request.codeVerifier, cookieOptions);
  res.redirect(request.url);
}));

router.get('/api/auth/identity/callback', apiLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (typeof req.query.error === 'string') throw Errors.unauthorized('Identity provider authentication was rejected');
  if (typeof req.query.code !== 'string') throw Errors.validation('Missing authorization code');
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  if (!state || req.cookies?.[stateCookie] !== state) throw Errors.unauthorized('Invalid identity provider state');
  const parsed = parseSsoState(state);
  const verifier = typeof req.cookies?.[verifierCookie] === 'string' ? req.cookies[verifierCookie] : '';
  res.clearCookie(stateCookie, { path: '/' });
  res.clearCookie(verifierCookie, { path: '/' });
  if (!parsed?.identityProviderKey || !verifier) throw Errors.unauthorized('Identity provider login has expired');
  const provider = await identityProviderService.getByKey(parsed.identityProviderKey, parsed.identityProviderTenantId || null);
  if (!provider) throw Errors.notFound('Identity provider not found');
  requireDirectOidc(provider);
  if (parsed.providerId && parsed.providerId !== provider.id) throw Errors.unauthorized('Identity provider state does not match the selected provider');
  const claims = await genericOidcService.exchangeCode(configuration(provider), { code: req.query.code, codeVerifier: verifier, nonce: parsed.nonce });
  const user = await identityProviderProvisioningService.provisionOidcUser(provider, claims);
  if (!user.isActive) throw Errors.forbidden('Your account has been deactivated');
  await logAudit(auditFromRequest(req, { action: AuditActions.LOGIN_SUCCESS, resourceType: 'identity_provider', resourceId: provider.id, details: { providerKey: provider.key, protocol: 'oidc' } }));
  const cookieOptions = { httpOnly: true, secure: shouldUseSecureCookies(), sameSite: 'lax' as const, maxAge: config.jwtAccessTokenExpires * 1000, path: '/' };
  res.cookie('accessToken', generateAccessToken(user as any), cookieOptions);
  res.cookie('refreshToken', generateRefreshToken(user as any), { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.redirect(getSsoRedirectUrl(parsed));
}));

export default router;
