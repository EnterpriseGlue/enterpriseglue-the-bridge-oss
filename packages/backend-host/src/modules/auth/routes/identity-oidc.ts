import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { authLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { identityFlowLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
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
import { tenantService } from '@enterpriseglue/shared/services/platform-admin/TenantService.js';
import { directLdapIdentityService } from '@enterpriseglue/shared/services/platform-admin/DirectLdapIdentityService.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { auditFromRequest, logAudit, AuditActions } from '@enterpriseglue/shared/services/audit.js';
import { config, shouldUseSecureCookies } from '@enterpriseglue/shared/config/index.js';
import { createAuthenticatedSessionContext } from '@enterpriseglue/shared/utils/session-identity.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { IsNull, type FindOptionsWhere } from 'typeorm';
import { verifyFederatedLogoutState } from '@enterpriseglue/shared/utils/samlRelayState.js';
import { getActivePlatformAdministratorUserIds } from '@enterpriseglue/shared/services/platform-admin/PlatformAdministratorMembershipService.js';
import { AuthenticatedSessionLoginResponseSchema } from '@enterpriseglue/shared/schemas/auth/session.js';
import { PublicLoginMethodsResponseSchema } from '@enterpriseglue/shared/schemas/platform-admin/authz.js';
import { recordLoginExperienceMetric, type LoginExperienceMethod } from '@enterpriseglue/shared/auth/login-experience-metrics.js';
import { runWithTenantDatabaseContext } from '@enterpriseglue/shared/services/tenant-database-context.js';
import { buildSignedOidcState, buildSignedSamlState, createSamlRequestId, getSsoRedirectUrl, parseSignedOidcState, parseSignedSamlState, type SsoState } from './sso-state.js';

const router = Router();
const stateCookie = 'identity_oidc_state';
const verifierCookie = 'identity_oidc_verifier';
const samlRequestCookie = 'identity_saml_request';
const ldapLoginSchema = z.object({ username: z.string().min(1).max(320), password: z.string().min(1).max(4096) });
const oidcBackChannelLogoutSchema = z.object({ logout_token: z.string().min(1).max(64 * 1024) }).strict();
const samlLogoutPostSchema = z.object({
  SAMLRequest: z.string().min(1).max(512 * 1024).optional(),
  SAMLResponse: z.string().min(1).max(512 * 1024).optional(),
  RelayState: z.string().max(4096).optional(),
}).strict().refine((body) => Boolean(body.SAMLRequest) !== Boolean(body.SAMLResponse), 'Provide exactly one SAMLRequest or SAMLResponse');

function parseFederatedLogoutState(value: unknown): { providerId: string; requestId?: string } | null {
  const verified = verifyFederatedLogoutState(value);
  if (!verified) return null;
  try {
    const parsed = JSON.parse(verified) as Record<string, unknown>;
    if (typeof parsed.providerId !== 'string' || !/^[A-Za-z0-9._-]{1,160}$/.test(parsed.providerId)) return null;
    if (typeof parsed.issuedAt !== 'number' || Date.now() - parsed.issuedAt > 10 * 60 * 1000 || parsed.issuedAt > Date.now() + 60 * 1000) return null;
    const requestId = typeof parsed.requestId === 'string' && /^_[A-Za-z0-9_-]{32,160}$/.test(parsed.requestId) ? parsed.requestId : undefined;
    return { providerId: parsed.providerId, ...(requestId ? { requestId } : {}) };
  } catch { return null; }
}

async function directProviderById(providerId: string): Promise<IdentityProvider> {
  const provider = await (await getDataSource()).getRepository(IdentityProvider).findOne({ where: { id: providerId } });
  if (!provider) throw Errors.notFound('Identity provider not found');
  return provider;
}

async function revokeFederatedSessions(providerId: string, input: { subjectId?: string; sessionId?: string }): Promise<number> {
  if (!input.subjectId && !input.sessionId) throw Errors.validation('Federated logout did not identify a subject or session');
  const where: FindOptionsWhere<RefreshToken> = {
    identityProviderId: providerId,
    revokedAt: IsNull(),
    ...(input.subjectId ? { providerSubjectId: input.subjectId } : {}),
    ...(input.sessionId ? { providerSessionId: input.sessionId } : {}),
  };
  const result = await (await getDataSource()).getRepository(RefreshToken).update(where, { revokedAt: Date.now() });
  return result.affected || 0;
}

function providerLogoutConfiguration(provider: IdentityProvider): Record<string, unknown> {
  const rawConfiguration = configuration(provider);
  if (provider.protocol === 'saml') {
    const callback = typeof rawConfiguration.logoutCallbackUrl === 'string' ? new URL(rawConfiguration.logoutCallbackUrl) : null;
    if (!callback || callback.pathname !== `/api/auth/identity/${encodeURIComponent(provider.key)}/saml/logout`) {
      throw Errors.validation('SAML logout callback does not match the provider route');
    }
  }
  return rawConfiguration;
}

async function directSamlProvidersByKey(providerKey: string): Promise<IdentityProvider[]> {
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(providerKey)) throw Errors.notFound('Identity provider not found');
  return (await getDataSource()).getRepository(IdentityProvider).find({
    where: { key: providerKey, protocol: 'saml', isEnabled: true, authenticationMode: 'direct' },
    order: { tenantId: 'ASC', id: 'ASC' },
    take: 50,
  });
}

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

async function runInSsoCallbackTenantContext<T>(
  req: Request,
  state: SsoState,
  callback: () => Promise<T>,
): Promise<T> {
  if (!state.identityProviderTenantId) {
    if (config.tenancyMode === 'pooled') throw Errors.unauthorized('Identity provider login is not tenant-scoped');
    return callback();
  }
  if (!state.tenantSlug) throw Errors.unauthorized('Identity provider tenant state is incomplete');
  const tenant = await tenantService.getById(state.identityProviderTenantId);
  if (!tenant || tenant.status !== 'active' || tenant.slug !== state.tenantSlug) {
    throw Errors.unauthorized('Identity provider tenant state is invalid');
  }
  const requestTenant = {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    placementKey: tenant.placementKey,
    placementEpoch: Number(tenant.placementEpoch),
  };
  req.tenant = requestTenant;
  return runWithTenantDatabaseContext({ tenantId: tenant.id, tenantSlug: tenant.slug }, callback);
}

async function startOidcLogin(req: Request, res: Response, provider: IdentityProvider): Promise<void> {
  requireDirectOidc(provider);
  const state = buildSignedOidcState(req, provider.id, { key: provider.key, tenantId: provider.tenantId });
  const parsed = parseSignedOidcState(state);
  if (!parsed) throw Errors.internal('Unable to initialize identity provider state');
  const request = await genericOidcService.createAuthorizationRequest(configuration(provider), state, parsed.nonce);
  const cookieOptions = { httpOnly: true, secure: shouldUseSecureCookies(), sameSite: 'lax' as const, maxAge: 10 * 60 * 1000, path: '/' };
  res.cookie(stateCookie, state, cookieOptions);
  res.cookie(verifierCookie, request.codeVerifier, cookieOptions);
  res.redirect(request.url);
}

async function startSamlLogin(req: Request, res: Response, provider: IdentityProvider): Promise<void> {
  requireDirectSaml(provider);
  const requestId = createSamlRequestId();
  const relayState = buildSignedSamlState(req, provider.id, { key: provider.key, tenantId: provider.tenantId }, requestId);
  const request = await genericSamlService.createAuthorizationRequest(configuration(provider), relayState, requestId);
  const authorizationUrl = new URL(request.url);
  const entryPoint = new URL(request.entryPoint);
  if (authorizationUrl.protocol !== 'https:' || entryPoint.protocol !== 'https:' || authorizationUrl.hostname !== entryPoint.hostname) {
    throw Errors.internal('Invalid SAML authorization URL');
  }
  const secure = shouldUseSecureCookies();
  res.cookie(samlRequestCookie, requestId, {
    httpOnly: true,
    secure,
    sameSite: secure ? 'none' : 'lax',
    maxAge: 10 * 60 * 1000,
    path: '/',
  });
  res.redirect(authorizationUrl.toString());
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function setProviderSession(
  req: Request,
  res: Response,
  user: { id: string; email: string; authSessionVersion?: number },
  provider: IdentityProvider,
  evidence: {
    mfaVerified: boolean;
    subjectId: string;
    sessionId?: string | null;
    nameIdFormat?: string | null;
  },
): Promise<void> {
  const tenant = provider.tenantId ? await tenantService.getById(provider.tenantId) : null;
  if (config.tenancyMode === 'pooled' && (!tenant || tenant.status !== 'active')) {
    throw Errors.forbidden('Tenant is not active');
  }
  if (provider.tenantId) {
    await tenantService.ensureSsoMember(provider.tenantId, user.id, provider.id);
  }
  const session = await authSessionService.issue(user, {
    tenantId: provider.tenantId || req.tenant?.tenantId,
    tenantSlug: tenant?.slug || req.tenant?.tenantSlug,
    identityProviderId: provider.id,
    identityProviderUpdatedAt: Number(provider.updatedAt),
    identityProviderProtocol: provider.protocol,
    identityProviderAuthenticationMode: provider.authenticationMode,
    identityProviderDirectoryTenantId: provider.directoryTenantId,
    identityProviderConfigurationJson: provider.configurationJson,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    ipAddress: req.ip,
    authenticationMethod: provider.protocol,
    mfaVerified: evidence.mfaVerified,
    federationSession: {
      subjectId: evidence.subjectId,
      sessionId: evidence.sessionId,
      nameIdFormat: evidence.nameIdFormat,
    },
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
    await setProviderSession(req, res, user, provider, {
      mfaVerified: false,
      subjectId: identity.subjectId,
    });
    await logAudit(auditFromRequest(req, { action: AuditActions.LOGIN_SUCCESS, resourceType: 'identity_provider', resourceId: provider.id, details: { providerKey: provider.key, protocol: 'ldap' } }));
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

const resolveRootLoginTenant = config.tenancyMode === 'pooled'
  ? resolveTenantContext({ required: true })
  : (_req: Request, _res: Response, next: (error?: unknown) => void) => next();

router.get('/api/auth/providers/enabled', apiLimiter, identityFlowLimiter, resolveRootLoginTenant, asyncHandler(async (req: Request, res: Response) => {
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
router.get('/api/t/:tenantSlug/auth/login-methods', resolveTenantContext({ required: true }), apiLimiter, identityFlowLimiter, asyncHandler(listLoginMethods));
router.get('/api/t/:tenantSlug/auth/providers/:providerId/start', resolveTenantContext({ required: true }), apiLimiter, identityFlowLimiter, asyncHandler(startProviderById));
router.post('/api/t/:tenantSlug/auth/providers/:providerId/login', resolveTenantContext({ required: true }), apiLimiter, identityFlowLimiter, authLimiter, validateBody(ldapLoginSchema), asyncHandler(loginProviderById));

router.get('/api/auth/login-methods', apiLimiter, identityFlowLimiter, resolveRootLoginTenant, asyncHandler(listLoginMethods));
router.get('/api/auth/providers/:providerId/start', apiLimiter, identityFlowLimiter, resolveRootLoginTenant, asyncHandler(startProviderById));
router.post('/api/auth/providers/:providerId/login', apiLimiter, identityFlowLimiter, resolveRootLoginTenant, authLimiter, validateBody(ldapLoginSchema), asyncHandler(loginProviderById));

router.get('/api/auth/identity/:key/start', apiLimiter, identityFlowLimiter, resolveRootLoginTenant, asyncHandler(async (req: Request, res: Response) => {
  const providerKey = typeof req.params.key === 'string' ? req.params.key : '';
  if (!providerKey) throw Errors.validation('Identity provider key is required');
  const provider = await identityProviderService.getDirectLoginProviderByKey(providerKey, req.tenant?.tenantId || null);
  if (!provider) throw Errors.notFound('Identity provider not found');
  await startMeasuredProviderLogin(req, res, provider);
}));

router.get('/api/auth/identity/callback', apiLimiter, identityFlowLimiter, asyncHandler(async (req: Request, res: Response) => {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const parsed = parseSignedOidcState(state);
  const redirectRejected = typeof req.query.error === 'string';
  const selectedProvider = { current: null as IdentityProvider | null };
  try {
    if (redirectRejected) throw Errors.unauthorized('Identity provider authentication was rejected');
    if (typeof req.query.code !== 'string') throw Errors.validation('Missing authorization code');
    if (!state || req.cookies?.[stateCookie] !== state) throw Errors.unauthorized('Invalid identity provider state');
    const verifier = typeof req.cookies?.[verifierCookie] === 'string' ? req.cookies[verifierCookie] : '';
    res.clearCookie(stateCookie, { path: '/' });
    res.clearCookie(verifierCookie, { path: '/' });
    if (!parsed?.identityProviderKey || !verifier) throw Errors.unauthorized('Identity provider login has expired');
    await runInSsoCallbackTenantContext(req, parsed, async () => {
      const provider = await identityProviderService.getByKey(parsed.identityProviderKey!, parsed.identityProviderTenantId || null);
      if (!provider) throw Errors.notFound('Identity provider not found');
      requireDirectOidc(provider);
      selectedProvider.current = provider;
      if (parsed.providerId && parsed.providerId !== provider.id) throw Errors.unauthorized('Identity provider state does not match the selected provider');
      const rawConfiguration = configuration(provider);
      const claims = await genericOidcService.exchangeCode(rawConfiguration, { code: req.query.code as string, codeVerifier: verifier, nonce: parsed.nonce });
      const user = await identityProviderProvisioningService.reconcileOidcLogin(provider, claims);
      if (!user.isActive) throw Errors.forbidden('Your account has been deactivated');
      const assurance = genericOidcService.authenticationAssurance(rawConfiguration, claims);
      await setProviderSession(req, res, user, provider, {
        mfaVerified: assurance.mfaVerified,
        subjectId: claims.sub,
        sessionId: typeof claims.sid === 'string' ? claims.sid : null,
      });
      await logAudit(auditFromRequest(req, { action: AuditActions.LOGIN_SUCCESS, resourceType: 'identity_provider', resourceId: provider.id, details: { providerKey: provider.key, protocol: 'oidc' } }));
      recordLoginExperienceMetric({ method: 'oidc', event: 'succeeded', durationMs: stateDuration(parsed.timestamp) });
      res.redirect(getSsoRedirectUrl(parsed));
    });
  } catch (error) {
    if (selectedProvider.current) {
      await logAudit(auditFromRequest(req, { action: AuditActions.LOGIN_FAILED, resourceType: 'identity_provider', resourceId: selectedProvider.current.id, details: { providerKey: selectedProvider.current.key, protocol: 'oidc', reason: 'session_not_issued' } }));
    }
    recordLoginExperienceMetric({
      method: 'oidc',
      event: redirectRejected ? 'redirect_failed' : 'failed',
      durationMs: stateDuration(parsed?.timestamp),
    });
    throw error;
  }
}));

router.post('/api/auth/providers/saml/callback', apiLimiter, identityFlowLimiter, asyncHandler(async (req: Request, res: Response) => {
  const samlResponse = typeof req.body?.SAMLResponse === 'string' ? req.body.SAMLResponse : '';
  const relayState = typeof req.body?.RelayState === 'string' ? req.body.RelayState : '';
  const parsed = parseSignedSamlState(relayState);
  const browserRequestId = typeof req.cookies?.[samlRequestCookie] === 'string' ? req.cookies[samlRequestCookie] : '';
  const secure = shouldUseSecureCookies();
  const selectedProvider = { current: null as IdentityProvider | null };
  res.clearCookie(samlRequestCookie, { httpOnly: true, secure, sameSite: secure ? 'none' : 'lax', path: '/' });
  try {
    if (!samlResponse) throw Errors.validation('Missing SAMLResponse');
    if (!parsed?.identityProviderKey || !parsed.samlRequestId) throw Errors.unauthorized('Identity provider login has expired');
    if (!browserRequestId || !constantTimeEqual(browserRequestId, parsed.samlRequestId)) throw Errors.unauthorized('Identity provider login does not match this browser');
    await runInSsoCallbackTenantContext(req, parsed, async () => {
      const provider = await identityProviderService.getByKey(parsed.identityProviderKey!, parsed.identityProviderTenantId || null);
      if (!provider) throw Errors.notFound('Identity provider not found');
      requireDirectSaml(provider);
      selectedProvider.current = provider;
      if (parsed.providerId && parsed.providerId !== provider.id) throw Errors.unauthorized('Identity provider state does not match the selected provider');
      const rawConfiguration = configuration(provider);
      const profile = await genericSamlService.validatePostResponse(rawConfiguration, samlResponse, parsed.samlRequestId!);
      await samlAssertionReplayService.consume({ providerId: provider.id, tenantId: provider.tenantId, requestId: parsed.samlRequestId! });
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
      const assurance = genericSamlService.authenticationAssurance(rawConfiguration, profile);
      await setProviderSession(req, res, user, provider, {
        mfaVerified: assurance.mfaVerified,
        subjectId: identity.subjectId,
        sessionId: typeof profile.sessionIndex === 'string' ? profile.sessionIndex : null,
        nameIdFormat: typeof profile.nameIDFormat === 'string' ? profile.nameIDFormat : null,
      });
      await logAudit(auditFromRequest(req, { action: AuditActions.LOGIN_SUCCESS, resourceType: 'identity_provider', resourceId: provider.id, details: { providerKey: provider.key, protocol: 'saml' } }));
      recordLoginExperienceMetric({ method: 'saml', event: 'succeeded', durationMs: stateDuration(parsed.timestamp) });
      res.redirect(getSsoRedirectUrl(parsed));
    });
  } catch (error) {
    if (selectedProvider.current) {
      await logAudit(auditFromRequest(req, { action: AuditActions.LOGIN_FAILED, resourceType: 'identity_provider', resourceId: selectedProvider.current.id, details: { providerKey: selectedProvider.current.key, protocol: 'saml', reason: 'session_not_issued' } }));
    }
    recordLoginExperienceMetric({ method: 'saml', event: 'failed', durationMs: stateDuration(parsed?.timestamp) });
    throw error;
  }
}));

router.post('/api/auth/identity/:key/ldap/login', apiLimiter, identityFlowLimiter, authLimiter, resolveRootLoginTenant, validateBody(ldapLoginSchema), asyncHandler(async (req: Request, res: Response) => {
  const providerKey = typeof req.params.key === 'string' ? req.params.key : '';
  if (!providerKey) throw Errors.validation('Identity provider key is required');
  const provider = await identityProviderService.getDirectLoginProviderByKey(providerKey, req.tenant?.tenantId || null);
  if (!provider) throw Errors.unauthorized('Invalid directory credentials');
  await authenticateMeasuredDirectLdap(req, res, provider);
}));

/** OpenID Connect Back-Channel Logout 1.0: token-authenticated, browser-independent revocation. */
router.post('/api/auth/providers/:providerId/oidc/backchannel-logout', apiLimiter, identityFlowLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.is('application/x-www-form-urlencoded')) throw Errors.validation('OIDC back-channel logout requires form-urlencoded content');
  const parsed = oidcBackChannelLogoutSchema.safeParse(req.body);
  if (!parsed.success) throw Errors.validation('OIDC logout_token is invalid');
  const provider = await directProviderById(String(req.params.providerId || ''));
  requireDirectOidc(provider);
  const claims = await genericOidcService.verifyBackChannelLogoutToken(providerLogoutConfiguration(provider), parsed.data.logout_token);
  const revoked = await revokeFederatedSessions(provider.id, {
    ...(claims.sub ? { subjectId: claims.sub } : {}),
    ...(claims.sid ? { sessionId: claims.sid } : {}),
  });
  await logAudit(auditFromRequest(req, {
    action: AuditActions.LOGOUT,
    resourceType: 'identity_provider',
    resourceId: provider.id,
    details: { protocol: 'oidc', mode: 'back_channel', sessionsRevoked: revoked },
  }));
  res.status(200).send();
}));

async function completeSamlLogoutResponse(req: Request, res: Response, provider: IdentityProvider, samlResponse: string, relayState: string, binding: 'redirect' | 'post'): Promise<void> {
  const state = parseFederatedLogoutState(relayState);
  if (!state?.requestId || state.providerId !== provider.id) throw Errors.unauthorized('SAML logout correlation is invalid or expired');
  const rawConfiguration = providerLogoutConfiguration(provider);
  if (binding === 'redirect') {
    const queryStart = req.originalUrl.indexOf('?');
    const originalQuery = queryStart >= 0 ? req.originalUrl.slice(queryStart + 1) : '';
    await genericSamlService.validateRedirectLogoutResponse(rawConfiguration, req.query as Record<string, unknown>, originalQuery, state.requestId);
  } else {
    await genericSamlService.validatePostLogoutResponse(rawConfiguration, samlResponse, state.requestId);
  }
  res.redirect(`${config.frontendUrl.replace(/\/$/, '')}/login`);
}

/** Signed SAML HTTP-POST LogoutRequest/Response endpoint. */
router.post('/api/auth/identity/:providerKey/saml/logout', apiLimiter, identityFlowLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.is('application/x-www-form-urlencoded')) throw Errors.validation('SAML logout requires form-urlencoded content');
  const parsed = samlLogoutPostSchema.safeParse(req.body);
  if (!parsed.success) throw Errors.validation('SAML logout message is invalid');
  const candidates = await directSamlProvidersByKey(String(req.params.providerKey || ''));
  if (candidates.length === 0) throw Errors.notFound('Identity provider not found');
  if (parsed.data.SAMLResponse) {
    const state = parseFederatedLogoutState(parsed.data.RelayState || '');
    const provider = state ? candidates.find((candidate) => candidate.id === state.providerId) : null;
    if (!provider) throw Errors.unauthorized('SAML logout correlation is invalid or expired');
    await completeSamlLogoutResponse(req, res, provider, parsed.data.SAMLResponse, parsed.data.RelayState || '', 'post');
    return;
  }
  let verified: {
    provider: IdentityProvider;
    configuration: Record<string, unknown>;
    request: Awaited<ReturnType<typeof genericSamlService.validatePostLogoutRequest>>;
  } | null = null;
  for (const candidate of candidates) {
    try {
      const candidateConfiguration = providerLogoutConfiguration(candidate);
      const request = await genericSamlService.validatePostLogoutRequest(candidateConfiguration, parsed.data.SAMLRequest!);
      verified = { provider: candidate, configuration: candidateConfiguration, request };
      break;
    } catch { /* A same-key provider is selected only by successful signature and issuer validation. */ }
  }
  if (!verified) throw Errors.unauthorized('SAML LogoutRequest signature is invalid');
  const { provider, configuration: rawConfiguration, request } = verified;
  const subjectId = typeof request.nameID === 'string' ? request.nameID : '';
  const sessionId = typeof request.sessionIndex === 'string' ? request.sessionIndex : undefined;
  const revoked = await revokeFederatedSessions(provider.id, { subjectId, ...(sessionId ? { sessionId } : {}) });
  await logAudit(auditFromRequest(req, {
    action: AuditActions.LOGOUT,
    resourceType: 'identity_provider',
    resourceId: provider.id,
    details: { protocol: 'saml', mode: 'idp_initiated', sessionsRevoked: revoked },
  }));
  res.redirect(await genericSamlService.createLogoutResponse(rawConfiguration, request, parsed.data.RelayState || ''));
}));

/** Signed SAML HTTP-Redirect LogoutResponse endpoint for RP-initiated logout. */
router.get('/api/auth/identity/:providerKey/saml/logout', apiLimiter, identityFlowLimiter, asyncHandler(async (req: Request, res: Response) => {
  const samlResponse = typeof req.query.SAMLResponse === 'string' ? req.query.SAMLResponse : '';
  const relayState = typeof req.query.RelayState === 'string' ? req.query.RelayState : '';
  if (!samlResponse || !relayState) throw Errors.validation('SAML LogoutResponse and RelayState are required');
  const state = parseFederatedLogoutState(relayState);
  const candidates = await directSamlProvidersByKey(String(req.params.providerKey || ''));
  const provider = state ? candidates.find((candidate) => candidate.id === state.providerId) : null;
  if (!provider) throw Errors.unauthorized('SAML logout correlation is invalid or expired');
  await completeSamlLogoutResponse(req, res, provider, samlResponse, relayState, 'redirect');
}));

export default router;
