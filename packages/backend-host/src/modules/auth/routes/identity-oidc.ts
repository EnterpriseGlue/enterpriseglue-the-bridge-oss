import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { authLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { AppError, asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js';
import { resolveTenantContext } from '@enterpriseglue/shared/middleware/tenant.js';
import { identityProviderService } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js';
import { loginMethodService } from '@enterpriseglue/shared/services/platform-admin/LoginMethodService.js';
import { genericOidcService } from '@enterpriseglue/shared/services/platform-admin/GenericOidcService.js';
import { genericSamlService } from '@enterpriseglue/shared/services/platform-admin/GenericSamlService.js';
import { samlAssertionReplayService } from '@enterpriseglue/shared/services/platform-admin/SamlAssertionReplayService.js';
import { identityProviderProvisioningService } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderProvisioningService.js';
import { authSessionService } from '@enterpriseglue/shared/services/AuthSessionService.js';
import { directLdapIdentityService } from '@enterpriseglue/shared/services/platform-admin/DirectLdapIdentityService.js';
import type { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { auditFromRequest, logAudit, AuditActions } from '@enterpriseglue/shared/services/audit.js';
import { config, shouldUseSecureCookies } from '@enterpriseglue/shared/config/index.js';
import { createAuthenticatedSessionContext } from '@enterpriseglue/shared/utils/session-identity.js';
import { getActivePlatformAdministratorUserIds } from '@enterpriseglue/shared/services/platform-admin/PlatformAdministratorMembershipService.js';
import { AuthenticatedSessionLoginResponseSchema } from '@enterpriseglue/shared/schemas/auth/session.js';
import { PublicLoginMethodsResponseSchema } from '@enterpriseglue/shared/schemas/platform-admin/authz.js';
import { recordLoginExperienceMetric, type LoginExperienceMethod } from '@enterpriseglue/shared/auth/login-experience-metrics.js';
import { buildSignedSamlState, buildSsoState, getSsoRedirectUrl, parseSignedSamlState, parseSsoState } from './sso-state.js';

const router = Router();
const stateCookie = 'identity_oidc_state';
const verifierCookie = 'identity_oidc_verifier';
const ldapLoginSchema = z.object({ username: z.string().min(1).max(320), password: z.string().min(1).max(4096) });

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

function requireDirectSaml(provider: { protocol: string; isEnabled: boolean; authenticationMode: string }) {
  if (!provider.isEnabled) throw Errors.notFound('Identity provider not found');
  if (provider.protocol !== 'saml') throw Errors.validation('This identity provider does not use SAML');
  if (provider.authenticationMode !== 'direct') throw Errors.forbidden('This identity provider accepts upstream claims and cannot initiate login');
}

function stateDuration(timestamp?: number): number | undefined {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return undefined;
  return Math.max(0, Date.now() - timestamp);
}

async function startOidcLogin(req: Request, res: Response, provider: IdentityProvider): Promise<void> {
  requireDirectOidc(provider);
  const state = buildSsoState(req, provider.id, { key: provider.key, tenantId: provider.tenantId });
  const parsed = parseSsoState(state);
  if (!parsed) throw Errors.internal('Unable to initialize identity provider state');
  const request = await genericOidcService.createAuthorizationRequest(configuration(provider), state, parsed.nonce);
  const cookieOptions = { httpOnly: true, secure: shouldUseSecureCookies(), sameSite: 'lax' as const, maxAge: 10 * 60 * 1000, path: '/' };
  res.cookie(stateCookie, state, cookieOptions);
  res.cookie(verifierCookie, request.codeVerifier, cookieOptions);
  res.redirect(request.url);
}

async function startSamlLogin(req: Request, res: Response, provider: IdentityProvider): Promise<void> {
  requireDirectSaml(provider);
  const relayState = buildSignedSamlState(req, provider.id, { key: provider.key, tenantId: provider.tenantId });
  const request = await genericSamlService.createAuthorizationRequest(configuration(provider), relayState);
  const authorizationUrl = new URL(request.url);
  const entryPoint = new URL(request.entryPoint);
  if (authorizationUrl.protocol !== 'https:' || entryPoint.protocol !== 'https:' || authorizationUrl.hostname !== entryPoint.hostname) {
    throw Errors.internal('Invalid SAML authorization URL');
  }
  res.redirect(authorizationUrl.toString());
}

async function setProviderSession(req: Request, res: Response, user: { id: string; email: string; authSessionVersion?: number }, provider: IdentityProvider): Promise<void> {
  const session = await authSessionService.issue(user, {
    identityProviderId: provider.id,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    ipAddress: req.ip,
  });
  const cookieOptions = { httpOnly: true, secure: shouldUseSecureCookies(), sameSite: 'lax' as const, maxAge: session.expiresIn * 1000, path: '/' };
  res.cookie('accessToken', session.accessToken, cookieOptions);
  res.cookie('refreshToken', session.refreshToken, { ...cookieOptions, maxAge: config.jwtRefreshTokenExpires * 1000 });
}

async function authenticateDirectLdap(req: Request, res: Response, provider: IdentityProvider): Promise<void> {
  if (provider.protocol !== 'ldap' || !provider.isEnabled || provider.authenticationMode !== 'direct') throw Errors.unauthorized('Invalid directory credentials');
  try {
    const identity = await directLdapIdentityService.authenticate(provider, req.body.username, req.body.password);
    const user = await identityProviderProvisioningService.reconcileLdapLogin(provider, { subjectId: identity.subjectId, email: identity.email, displayName: identity.displayName, firstName: identity.firstName, lastName: identity.lastName, claims: { sub: identity.subjectId, email: identity.email, groups: identity.groups } });
    if (!user.isActive) throw Errors.forbidden('Your account has been deactivated');
    await logAudit(auditFromRequest(req, { action: AuditActions.LOGIN_SUCCESS, resourceType: 'identity_provider', resourceId: provider.id, details: { providerKey: provider.key, protocol: 'ldap' } }));
    await setProviderSession(req, res, user, provider);
    const platformAdministratorUserIds = await getActivePlatformAdministratorUserIds([user.id]);
    res.json(AuthenticatedSessionLoginResponseSchema.parse({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        platformRole: platformAdministratorUserIds.has(user.id) ? 'admin' : 'user',
        session: createAuthenticatedSessionContext(user.id, req.tenant?.tenantId),
      },
      expiresIn: config.jwtAccessTokenExpires,
    }));
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 403) throw error;
    await logAudit(auditFromRequest(req, { action: AuditActions.LOGIN_FAILED, resourceType: 'identity_provider', resourceId: provider.id, details: { providerKey: provider.key, protocol: 'ldap', reason: 'invalid_directory_credentials' } }));
    throw Errors.unauthorized('Invalid directory credentials');
  }
}

async function startMeasuredProviderLogin(req: Request, res: Response, provider: IdentityProvider): Promise<void> {
  const method: LoginExperienceMethod = provider.protocol === 'saml' ? 'saml' : 'oidc';
  const startedAt = Date.now();
  recordLoginExperienceMetric({ method, event: 'selected' });
  try {
    if (provider.protocol === 'saml') await startSamlLogin(req, res, provider);
    else await startOidcLogin(req, res, provider);
  } catch (error) {
    recordLoginExperienceMetric({ method, event: 'redirect_failed', durationMs: Date.now() - startedAt });
    throw error;
  }
}

async function authenticateMeasuredDirectLdap(req: Request, res: Response, provider: IdentityProvider): Promise<void> {
  const startedAt = Date.now();
  recordLoginExperienceMetric({ method: 'ldap', event: 'selected' });
  try {
    await authenticateDirectLdap(req, res, provider);
    recordLoginExperienceMetric({
      method: 'ldap',
      event: res.statusCode >= 400 ? 'failed' : 'succeeded',
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    recordLoginExperienceMetric({ method: 'ldap', event: 'failed', durationMs: Date.now() - startedAt });
    throw error;
  }
}

router.get('/api/auth/providers/enabled', apiLimiter, asyncHandler(async (req: Request, res: Response) => {
  const providers = req.tenant?.tenantId
    ? await identityProviderService.listEnabledDirectLoginProviders(req.tenant.tenantId)
    : await identityProviderService.listEnabledDirectLoginProvidersForUnauthenticatedLogin();
  res.json(providers.map((provider) => ({
    id: provider.id,
    key: provider.key,
    displayName: provider.displayName?.trim() || provider.key,
    organization: provider.organization?.trim() || null,
    protocol: provider.protocol,
    loginMethod: provider.protocol === 'ldap' ? 'password' : 'redirect',
  })));
}));

async function listLoginMethods(req: Request, res: Response): Promise<void> {
  const methods = await loginMethodService.get(req.tenant?.tenantId || null);
  res.json(PublicLoginMethodsResponseSchema.parse(methods));
}

async function startProviderById(req: Request, res: Response): Promise<void> {
  const provider = await identityProviderService.getDirectLoginProviderById(String(req.params.providerId || ''), req.tenant?.tenantId || null);
  if (!provider) throw Errors.notFound('Identity provider not found');
  await startMeasuredProviderLogin(req, res, provider);
}

async function loginProviderById(req: Request, res: Response): Promise<void> {
  const provider = await identityProviderService.getDirectLoginProviderById(String(req.params.providerId || ''), req.tenant?.tenantId || null);
  if (!provider) throw Errors.unauthorized('Invalid directory credentials');
  await authenticateMeasuredDirectLdap(req, res, provider);
}

// Tenant-scoped pre-authentication routes are the canonical browser and
// headless interfaces. Global routes remain as compatibility aliases for the
// OSS default tenant and older clients.
router.get('/api/t/:tenantSlug/auth/login-methods', apiLimiter, resolveTenantContext({ required: true }), asyncHandler(listLoginMethods));
router.get('/api/t/:tenantSlug/auth/providers/:providerId/start', apiLimiter, resolveTenantContext({ required: true }), asyncHandler(startProviderById));
router.post('/api/t/:tenantSlug/auth/providers/:providerId/login', apiLimiter, authLimiter, resolveTenantContext({ required: true }), validateBody(ldapLoginSchema), asyncHandler(loginProviderById));

router.get('/api/auth/login-methods', apiLimiter, asyncHandler(listLoginMethods));
router.get('/api/auth/providers/:providerId/start', apiLimiter, asyncHandler(startProviderById));

router.get('/api/auth/identity/:key/start', apiLimiter, asyncHandler(async (req: Request, res: Response) => {
  const providerKey = typeof req.params.key === 'string' ? req.params.key : '';
  if (!providerKey) throw Errors.validation('Identity provider key is required');
  const provider = await identityProviderService.getDirectLoginProviderByKey(providerKey, req.tenant?.tenantId || null);
  if (!provider) throw Errors.notFound('Identity provider not found');
  await startMeasuredProviderLogin(req, res, provider);
}));

router.get('/api/auth/identity/callback', apiLimiter, asyncHandler(async (req: Request, res: Response) => {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const parsed = parseSsoState(state);
  const redirectRejected = typeof req.query.error === 'string';
  try {
    if (redirectRejected) throw Errors.unauthorized('Identity provider authentication was rejected');
    if (typeof req.query.code !== 'string') throw Errors.validation('Missing authorization code');
    if (!state || req.cookies?.[stateCookie] !== state) throw Errors.unauthorized('Invalid identity provider state');
    const verifier = typeof req.cookies?.[verifierCookie] === 'string' ? req.cookies[verifierCookie] : '';
    res.clearCookie(stateCookie, { path: '/' });
    res.clearCookie(verifierCookie, { path: '/' });
    if (!parsed?.identityProviderKey || !verifier) throw Errors.unauthorized('Identity provider login has expired');
    const provider = await identityProviderService.getByKey(parsed.identityProviderKey, parsed.identityProviderTenantId || null);
    if (!provider) throw Errors.notFound('Identity provider not found');
    requireDirectOidc(provider);
    if (parsed.providerId && parsed.providerId !== provider.id) throw Errors.unauthorized('Identity provider state does not match the selected provider');
    const claims = await genericOidcService.exchangeCode(configuration(provider), { code: req.query.code, codeVerifier: verifier, nonce: parsed.nonce });
    const user = await identityProviderProvisioningService.reconcileOidcLogin(provider, claims);
    if (!user.isActive) throw Errors.forbidden('Your account has been deactivated');
    await logAudit(auditFromRequest(req, { action: AuditActions.LOGIN_SUCCESS, resourceType: 'identity_provider', resourceId: provider.id, details: { providerKey: provider.key, protocol: 'oidc' } }));
    await setProviderSession(req, res, user, provider);
    recordLoginExperienceMetric({ method: 'oidc', event: 'succeeded', durationMs: stateDuration(parsed.timestamp) });
    res.redirect(getSsoRedirectUrl(parsed));
  } catch (error) {
    recordLoginExperienceMetric({
      method: 'oidc',
      event: redirectRejected ? 'redirect_failed' : 'failed',
      durationMs: stateDuration(parsed?.timestamp),
    });
    throw error;
  }
}));

router.post('/api/auth/providers/saml/callback', apiLimiter, asyncHandler(async (req: Request, res: Response) => {
  const samlResponse = typeof req.body?.SAMLResponse === 'string' ? req.body.SAMLResponse : '';
  const relayState = typeof req.body?.RelayState === 'string' ? req.body.RelayState : '';
  const parsed = parseSignedSamlState(relayState);
  try {
    if (!samlResponse) throw Errors.validation('Missing SAMLResponse');
    if (!parsed?.identityProviderKey) throw Errors.unauthorized('Identity provider login has expired');
    const provider = await identityProviderService.getByKey(parsed.identityProviderKey, parsed.identityProviderTenantId || null);
    if (!provider) throw Errors.notFound('Identity provider not found');
    requireDirectSaml(provider);
    if (parsed.providerId && parsed.providerId !== provider.id) throw Errors.unauthorized('Identity provider state does not match the selected provider');
    const rawConfiguration = configuration(provider);
    const profile = await genericSamlService.validatePostResponse(rawConfiguration, samlResponse);
    await samlAssertionReplayService.consume({ providerId: provider.id, tenantId: provider.tenantId, samlResponse });
    const identity = genericSamlService.extractUserClaims(rawConfiguration, profile);
    const user = await identityProviderProvisioningService.reconcileSamlLogin(provider, {
      subjectId: identity.subjectId,
      email: identity.email,
      displayName: identity.displayName,
      firstName: identity.firstName,
      lastName: identity.lastName,
      directoryTenantId: identity.directoryTenantId || provider.directoryTenantId,
      claims: identity.claims,
    });
    if (!user.isActive) throw Errors.forbidden('Your account has been deactivated');
    await logAudit(auditFromRequest(req, { action: AuditActions.LOGIN_SUCCESS, resourceType: 'identity_provider', resourceId: provider.id, details: { providerKey: provider.key, protocol: 'saml' } }));
    await setProviderSession(req, res, user, provider);
    recordLoginExperienceMetric({ method: 'saml', event: 'succeeded', durationMs: stateDuration(parsed.timestamp) });
    res.redirect(getSsoRedirectUrl(parsed));
  } catch (error) {
    recordLoginExperienceMetric({ method: 'saml', event: 'failed', durationMs: stateDuration(parsed?.timestamp) });
    throw error;
  }
}));

router.post('/api/auth/identity/:key/ldap/login', apiLimiter, authLimiter, validateBody(ldapLoginSchema), asyncHandler(async (req: Request, res: Response) => {
  const providerKey = typeof req.params.key === 'string' ? req.params.key : '';
  if (!providerKey) throw Errors.validation('Identity provider key is required');
  const provider = await identityProviderService.getDirectLoginProviderByKey(providerKey, req.tenant?.tenantId || null);
  if (!provider) throw Errors.unauthorized('Invalid directory credentials');
  await authenticateMeasuredDirectLdap(req, res, provider);
}));

router.post('/api/auth/providers/:providerId/login', apiLimiter, authLimiter, validateBody(ldapLoginSchema), asyncHandler(loginProviderById));

export default router;
