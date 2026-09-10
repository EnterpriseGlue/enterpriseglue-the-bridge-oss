import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { authLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { identityFlowLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { AppError, asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js';
import { enforceParsedPayloadLimit } from '@enterpriseglue/shared/middleware/requestSizeLimit.js';
import { resolveTenantContext } from '@enterpriseglue/shared/middleware/tenant.js';
import { requireOnboarding } from '@enterpriseglue/shared/middleware/auth.js';
import type { InvitationEnrollmentContext } from '@enterpriseglue/shared/services/invitations.js';
import { identityProviderService } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js';
import { runWithPlatformDatabaseCapability } from '@enterpriseglue/shared/services/platform-database-context.js';
import { loginMethodService } from '@enterpriseglue/shared/services/platform-admin/LoginMethodService.js';
import { genericOidcService } from '@enterpriseglue/shared/services/platform-admin/GenericOidcService.js';
import { genericSamlService } from '@enterpriseglue/shared/services/platform-admin/GenericSamlService.js';
import { samlAssertionReplayService } from '@enterpriseglue/shared/services/platform-admin/SamlAssertionReplayService.js';
import { identityProviderProvisioningService } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderProvisioningService.js';
import { authSessionService, type IssuedAuthSession, type IssueAuthSessionInput } from '@enterpriseglue/shared/services/AuthSessionService.js';
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
import { buildSignedOidcState, buildSignedSamlState, createSamlRequestId, getSsoRedirectUrl, parseSignedOidcState, parseSignedSamlState, parseInvitationEnrollmentContext, type SsoState } from './sso-state.js';

const router = Router();
const stateCookie = 'identity_oidc_state';
const verifierCookie = 'identity_oidc_verifier';
const samlRequestCookie = 'identity_saml_request';
const oidcCallbackFormPayloadLimit = enforceParsedPayloadLimit(16 * 1024);
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

async function revokeFederatedSessions(provider: IdentityProvider, input: { subjectId?: string; sessionId?: string }): Promise<number> {
  if (!input.subjectId && !input.sessionId) throw Errors.validation('Federated logout did not identify a subject or session');
  const where: FindOptionsWhere<RefreshToken> = {
    identityProviderId: provider.id,
    revokedAt: IsNull(),
    ...(input.subjectId ? { providerSubjectId: input.subjectId } : {}),
    ...(input.sessionId ? { providerSessionId: input.sessionId } : {}),
  };
  return (await getDataSource()).transaction(async (manager) => {
    // Match issuance's provider -> session lock order. A bulk token UPDATE
    // alone can miss a switched child inserted after its statement snapshot.
    const claim = await manager.getRepository(IdentityProvider).update({
      id: provider.id, isEnabled: true, authenticationMode: 'direct',
      updatedAt: Number(provider.updatedAt), protocol: provider.protocol,
      directoryTenantId: provider.directoryTenantId?.trim() || IsNull(),
      configurationJson: provider.configurationJson,
    }, { isEnabled: true });
    if (claim.affected !== 1) throw Errors.unauthorized('Identity provider changed while logout was in progress');
    const result = await manager.getRepository(RefreshToken).update(where, { revokedAt: Date.now() });
    return result.affected || 0;
  });
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

function providerSecretContext(req: Request, provider: IdentityProvider): { tenantId?: string | null; correlationId?: string } {
  const candidate = req.headers['x-correlation-id'] || req.headers['x-request-id'];
  const correlationId = (Array.isArray(candidate) ? candidate[0] : candidate)?.trim();
  return {
    tenantId: provider.tenantId,
    ...(correlationId ? { correlationId } : {}),
  };
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

async function readCallbackProvider(state: SsoState): Promise<IdentityProvider | null> {
  const read = () => identityProviderService.getByKey(state.identityProviderKey!, state.identityProviderTenantId || null);
  if (config.tenancyMode !== 'pooled' || state.identityProviderTenantId) return read();
  if (!state.providerId) throw Errors.unauthorized('Global provider callback requires exact provider identity');
  return runWithPlatformDatabaseCapability({kind:'provider-lookup',providerId:state.providerId}, read);
}

async function runInSsoCallbackTenantContext<T>(
  req: Request,
  state: SsoState,
  callback: () => Promise<T>,
): Promise<T> {
  const routeTenantSlug = typeof req.params?.tenantSlug === 'string' ? req.params.tenantSlug.trim() : '';
  if (routeTenantSlug && routeTenantSlug !== state.tenantSlug) {
    throw Errors.unauthorized('Identity provider callback tenant does not match the signed login state');
  }
  if (!state.identityProviderTenantId) {
    if (config.tenancyMode === 'pooled' && (!config.cloudAccountIdentityEnabled || state.tenantSlug)) {
      throw Errors.unauthorized('Identity provider login is not tenant-scoped');
    }
    return callback();
  }
  // Migration 0125 assigns legacy single-mode providers to the default tenant,
  // while their supported root login route intentionally carries no tenant
  // slug. The signed provider tenant ID still scopes the lookup and session;
  // pooled mode must always retain the explicit slug binding below.
  if (config.tenancyMode !== 'pooled' && !state.tenantSlug) return callback();
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

async function startOidcLogin(req: Request, res: Response, provider: IdentityProvider, enrollment?: InvitationEnrollmentContext): Promise<void> {
  requireDirectOidc(provider);
  const state = buildSignedOidcState(req, provider.id, { key: provider.key, tenantId: provider.tenantId }, enrollment);
  const parsed = parseSignedOidcState(state);
  if (!parsed) throw Errors.internal('Unable to initialize identity provider state');
  const request = await genericOidcService.createAuthorizationRequest(configuration(provider), state, parsed.nonce);
  const secure = shouldUseSecureCookies();
  const cookieOptions = {
    httpOnly: true,
    secure,
    sameSite: request.responseMode === 'form_post' && secure ? 'none' as const : 'lax' as const,
    maxAge: 10 * 60 * 1000,
    path: '/',
  };
  res.cookie(stateCookie, state, cookieOptions);
  res.cookie(verifierCookie, request.codeVerifier, cookieOptions);
  res.redirect(request.url);
}

async function startSamlLogin(req: Request, res: Response, provider: IdentityProvider, enrollment?: InvitationEnrollmentContext): Promise<void> {
  requireDirectSaml(provider);
  const requestId = createSamlRequestId();
  const relayState = buildSignedSamlState(req, provider.id, { key: provider.key, tenantId: provider.tenantId }, requestId, enrollment);
  const request = await genericSamlService.createAuthorizationRequest(configuration(provider), relayState, requestId, providerSecretContext(req, provider));
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
): Promise<Awaited<ReturnType<typeof authSessionService.issue>>> {
  const tenant = provider.tenantId ? await tenantService.getById(provider.tenantId) : null;
  if (config.tenancyMode === 'pooled') {
    if (provider.tenantId && (!tenant || tenant.status !== 'active')) throw Errors.forbidden('Tenant is not active');
    if (!provider.tenantId && !config.cloudAccountIdentityEnabled) throw Errors.forbidden('Cloud account identity is disabled');
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
    ...(config.tenancyMode === 'pooled' && !provider.tenantId
      ? { sessionClass: 'cloud_account' as const }
      : {}),
    mfaVerified: evidence.mfaVerified,
    federationSession: {
      subjectId: evidence.subjectId,
      sessionId: evidence.sessionId,
      nameIdFormat: evidence.nameIdFormat,
    },
  });
  setSessionCookies(res, session);
  return session;
}

function setSessionCookies(res: Response, session: IssuedAuthSession, enrolled = false): void {
  const cookieOptions = { httpOnly: true, secure: shouldUseSecureCookies(), sameSite: 'lax' as const, maxAge: session.expiresIn * 1000, path: '/' };
  res.cookie('accessToken', session.accessToken, cookieOptions);
  res.cookie('refreshToken', session.refreshToken, { ...cookieOptions, maxAge: config.jwtRefreshTokenExpires * 1000 });
  if (enrolled) res.clearCookie('onboardingToken', { path: '/' });
}

function enrollmentEvidence(req: Request, federationSession: NonNullable<IssueAuthSessionInput['federationSession']>, mfaVerified: boolean) {
  return { federationSession, mfaVerified,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    ipAddress: req.ip };
}

async function authenticateDirectLdap(req: Request, res: Response, provider: IdentityProvider, enrollment?: InvitationEnrollmentContext): Promise<void> {
  if (provider.protocol !== 'ldap' || !provider.isEnabled || provider.authenticationMode !== 'direct') throw Errors.unauthorized('Invalid directory credentials');
  try {
    const identity = await directLdapIdentityService.authenticate(provider, req.body.username, req.body.password);
    const input = { subjectId: identity.subjectId, email: identity.email, displayName: identity.displayName, firstName: identity.firstName, lastName: identity.lastName, claims: { sub: identity.subjectId, email: identity.email, groups: identity.groups } };
    const enrolled = enrollment ? await identityProviderProvisioningService.enrollLdapInvitation(provider, input, enrollment,
      enrollmentEvidence(req, { subjectId: identity.subjectId }, false)) : null;
    const user = enrolled ? enrolled.user : await identityProviderProvisioningService.reconcileLdapLogin(provider, input);
    if (!user.isActive) throw Errors.forbidden('Your account has been deactivated');
    const session = enrolled ? enrolled.session : await setProviderSession(req, res, user, provider, {
      mfaVerified: false,
      subjectId: identity.subjectId,
    });
    if (enrolled) setSessionCookies(res, session, true);
    await logAudit(auditFromRequest(req, { action: AuditActions.LOGIN_SUCCESS, resourceType: 'identity_provider', resourceId: provider.id, details: { providerKey: provider.key, protocol: 'ldap' } }));
    const platformAdministratorUserIds = await getActivePlatformAdministratorUserIds([user.id]);
    res.json(AuthenticatedSessionLoginResponseSchema.parse({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        platformRole: platformAdministratorUserIds.has(user.id) ? 'admin' : 'user',
        session: createAuthenticatedSessionContext(user.id, session.tenantId),
      },
      expiresIn: config.jwtAccessTokenExpires,
    }));
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 403) throw error;
    await logAudit(auditFromRequest(req, { action: AuditActions.LOGIN_FAILED, resourceType: 'identity_provider', resourceId: provider.id, details: { providerKey: provider.key, protocol: 'ldap', reason: 'invalid_directory_credentials' } }));
    throw Errors.unauthorized('Invalid directory credentials');
  }
}

async function startMeasuredProviderLogin(req: Request, res: Response, provider: IdentityProvider, enrollment?: InvitationEnrollmentContext): Promise<void> {
  const method: LoginExperienceMethod = provider.protocol === 'saml' ? 'saml' : 'oidc';
  const startedAt = Date.now();
  recordLoginExperienceMetric({ method, event: 'selected' });
  try {
    if (provider.protocol === 'saml') await startSamlLogin(req, res, provider, enrollment);
    else await startOidcLogin(req, res, provider, enrollment);
  } catch (error) {
    recordLoginExperienceMetric({ method, event: 'redirect_failed', durationMs: Date.now() - startedAt });
    throw error;
  }
}

async function authenticateMeasuredDirectLdap(req: Request, res: Response, provider: IdentityProvider, enrollment?: InvitationEnrollmentContext): Promise<void> {
  const startedAt = Date.now();
  recordLoginExperienceMetric({ method: 'ldap', event: 'selected' });
  try {
    await authenticateDirectLdap(req, res, provider, enrollment);
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

router.get('/api/auth/cloud-signup/providers', apiLimiter, identityFlowLimiter, asyncHandler(async (_req: Request, res: Response) => {
  if (!config.cloudAccountIdentityEnabled) throw Errors.notFound('Cloud signup');
  // Cloud accounts use global providers only; the ordinary login helper merges
  // default-tenant providers and can shadow a global provider with the same key.
  const providers = (await identityProviderService.listEnabledDirectLoginProviders(null))
    .filter((provider) => provider.tenantId === null && (provider.protocol === 'oidc' || provider.protocol === 'saml'));
  res.json(providers.map((provider) => ({
    id: provider.id,
    displayName: provider.displayName?.trim() || provider.key,
    protocol: provider.protocol,
  })));
}));

router.get('/api/auth/cloud-signup/providers/:providerId/start', apiLimiter, identityFlowLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!config.cloudAccountIdentityEnabled) throw Errors.notFound('Cloud signup');
  if (Object.keys(req.query).join(',') !== 'returnTo' || req.query.returnTo !== '/cloud/onboarding') {
    throw Errors.validation('Cloud signup return path is invalid');
  }
  const provider = await identityProviderService.getDirectLoginProviderById(String(req.params.providerId || ''), null);
  if (!provider || provider.tenantId !== null || (provider.protocol !== 'oidc' && provider.protocol !== 'saml')) {
    throw Errors.notFound('Identity provider');
  }
  await startMeasuredProviderLogin(req, res, provider);
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

function onboardingEnrollment(req: Request): InvitationEnrollmentContext {
  const onboarding = req.onboarding;
  const enrollment = parseInvitationEnrollmentContext({ invitationId: onboarding?.invitationId, userId: onboarding?.userId,
    tenantId: onboarding?.tenantId, tenantSlug: onboarding?.tenantSlug, authSessionVersion: onboarding?.authSessionVersion });
  if (!enrollment) throw Errors.unauthorized('A fresh invitation is required for enrollment');
  return enrollment;
}

async function onboardingProvider(req: Request): Promise<{ provider: IdentityProvider; enrollment: InvitationEnrollmentContext }> {
  const enrollment = onboardingEnrollment(req);
  const provider = await identityProviderService.getDirectLoginProviderById(String(req.params.providerId || ''), enrollment.tenantId);
  if (!provider || provider.id !== req.params.providerId || provider.tenantId !== enrollment.tenantId
    || !provider.isEnabled || provider.authenticationMode !== 'direct') throw Errors.notFound('Identity provider not found');
  return { provider, enrollment };
}

// Only authenticated onboarding context can initiate enrollment. General login
// routes never read enrollment references from query/body/cookies into state.
const onboardingLoginMethods = asyncHandler(async (req, res) => {
  // Provider enrollment is a pooled capability. Preserve the historical
  // single-mode invitation password flow instead of advertising an unsupported
  // enrollment endpoint or applying the pooled fresh-account parser there.
  if (config.tenancyMode !== 'pooled') {
    res.json(PublicLoginMethodsResponseSchema.parse({ localPassword: { enabled: true }, providers: [],
      autoRedirectProviderId: null, providerSelection: 'chooser', configurationStatus: 'ready' }));
    return;
  }
  const enrollment = onboardingEnrollment(req);
  res.json(PublicLoginMethodsResponseSchema.parse(await loginMethodService.get(enrollment.tenantId)));
});
const startOnboardingProvider = asyncHandler(async (req, res) => {
  const { provider, enrollment } = await onboardingProvider(req);
  await startMeasuredProviderLogin(req, res, provider, enrollment);
});
const loginOnboardingProvider = asyncHandler(async (req, res) => {
  const { provider, enrollment } = await onboardingProvider(req);
  await authenticateMeasuredDirectLdap(req, res, provider, enrollment);
});
router.get('/api/auth/onboarding/login-methods', apiLimiter, identityFlowLimiter, requireOnboarding, onboardingLoginMethods);
router.get('/api/auth/onboarding/providers/:providerId/start', apiLimiter, identityFlowLimiter, requireOnboarding, startOnboardingProvider);
router.post('/api/auth/onboarding/providers/:providerId/login', apiLimiter, identityFlowLimiter, authLimiter, requireOnboarding, validateBody(ldapLoginSchema.strict()), loginOnboardingProvider);
router.get('/api/t/:tenantSlug/auth/onboarding/login-methods', apiLimiter, identityFlowLimiter, resolveTenantContext({ required: true }), requireOnboarding, onboardingLoginMethods);
router.get('/api/t/:tenantSlug/auth/onboarding/providers/:providerId/start', apiLimiter, identityFlowLimiter, resolveTenantContext({ required: true }), requireOnboarding, startOnboardingProvider);
router.post('/api/t/:tenantSlug/auth/onboarding/providers/:providerId/login', apiLimiter, identityFlowLimiter, authLimiter, resolveTenantContext({ required: true }), requireOnboarding, validateBody(ldapLoginSchema.strict()), loginOnboardingProvider);

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

async function completeOidcLogin(req: Request, res: Response): Promise<void> {
  if (req.method === 'POST' && !req.is('application/x-www-form-urlencoded')) {
    throw Errors.validation('OIDC POST callback requires form-urlencoded content');
  }
  const callback = req.method === 'POST' ? req.body : req.query;
  const state = typeof callback?.state === 'string' ? callback.state : '';
  const parsed = parseSignedOidcState(state);
  const redirectRejected = typeof callback?.error === 'string';
  const selectedProvider = { current: null as IdentityProvider | null };
  try {
    if (redirectRejected) throw Errors.unauthorized('Identity provider authentication was rejected');
    if (typeof callback?.code !== 'string') throw Errors.validation('Missing authorization code');
    if (!state || req.cookies?.[stateCookie] !== state) throw Errors.unauthorized('Invalid identity provider state');
    const verifier = typeof req.cookies?.[verifierCookie] === 'string' ? req.cookies[verifierCookie] : '';
    res.clearCookie(stateCookie, { path: '/' });
    res.clearCookie(verifierCookie, { path: '/' });
    if (!parsed?.identityProviderKey || !verifier) throw Errors.unauthorized('Identity provider login has expired');
    await runInSsoCallbackTenantContext(req, parsed, async () => {
      const provider = await readCallbackProvider(parsed);
      if (!provider) throw Errors.notFound('Identity provider not found');
      requireDirectOidc(provider);
      selectedProvider.current = provider;
      if (parsed.providerId && parsed.providerId !== provider.id) throw Errors.unauthorized('Identity provider state does not match the selected provider');
      const rawConfiguration = configuration(provider);
      const verifiedClaims = await genericOidcService.exchangeCode(rawConfiguration, { code: callback.code as string, codeVerifier: verifier, nonce: parsed.nonce }, providerSecretContext(req, provider));
      const claims = genericOidcService.withCallbackUser(rawConfiguration, verifiedClaims, callback?.user);
      const assurance = genericOidcService.authenticationAssurance(rawConfiguration, claims);
      const evidence = {
        mfaVerified: assurance.mfaVerified,
        subjectId: claims.sub,
        sessionId: typeof claims.sid === 'string' ? claims.sid : null,
      };
      const enrolled = parsed.enrollment ? await identityProviderProvisioningService.enrollOidcInvitation(provider, claims, parsed.enrollment,
        enrollmentEvidence(req, { subjectId: evidence.subjectId, sessionId: evidence.sessionId }, evidence.mfaVerified)) : null;
      const user = enrolled ? enrolled.user : await identityProviderProvisioningService.reconcileOidcLogin(provider, claims);
      if (!user.isActive) throw Errors.forbidden('Your account has been deactivated');
      if (enrolled) setSessionCookies(res, enrolled.session, true);
      else await setProviderSession(req, res, user, provider, evidence);
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
}

async function completeSamlLogin(req: Request, res: Response): Promise<void> {
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
      const provider = await readCallbackProvider(parsed);
      if (!provider) throw Errors.notFound('Identity provider not found');
      requireDirectSaml(provider);
      selectedProvider.current = provider;
      if (parsed.providerId && parsed.providerId !== provider.id) throw Errors.unauthorized('Identity provider state does not match the selected provider');
      const rawConfiguration = configuration(provider);
      const profile = await genericSamlService.validatePostResponse(rawConfiguration, samlResponse, parsed.samlRequestId!, providerSecretContext(req, provider));
      await samlAssertionReplayService.consume({ providerId: provider.id, tenantId: provider.tenantId, requestId: parsed.samlRequestId! });
      const identity = genericSamlService.extractUserClaims(rawConfiguration, profile);
      const input = {
        subjectId: identity.subjectId,
        email: identity.email,
        displayName: identity.displayName,
        firstName: identity.firstName,
        lastName: identity.lastName,
        directoryTenantId: identity.directoryTenantId || provider.directoryTenantId,
        claims: identity.claims,
      };
      const assurance = genericSamlService.authenticationAssurance(rawConfiguration, profile);
      const evidence = {
        mfaVerified: assurance.mfaVerified,
        subjectId: identity.subjectId,
        sessionId: typeof profile.sessionIndex === 'string' ? profile.sessionIndex : null,
        nameIdFormat: typeof profile.nameIDFormat === 'string' ? profile.nameIDFormat : null,
      };
      const enrolled = parsed.enrollment ? await identityProviderProvisioningService.enrollSamlInvitation(provider, input, parsed.enrollment,
        enrollmentEvidence(req, { subjectId: evidence.subjectId, sessionId: evidence.sessionId, nameIdFormat: evidence.nameIdFormat }, evidence.mfaVerified)) : null;
      const user = enrolled ? enrolled.user : await identityProviderProvisioningService.reconcileSamlLogin(provider, input);
      if (!user.isActive) throw Errors.forbidden('Your account has been deactivated');
      if (enrolled) setSessionCookies(res, enrolled.session, true);
      else await setProviderSession(req, res, user, provider, evidence);
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
}

// A tenant-scoped callback is required by release-aware pooled deployments so
// the edge can select the tenant's assigned host release before any provider
// state is consumed. The global callbacks remain backward-compatible aliases.
router.get('/api/t/:tenantSlug/auth/identity/callback', resolveTenantContext({ required: true }), apiLimiter, identityFlowLimiter, asyncHandler(completeOidcLogin));
router.post('/api/t/:tenantSlug/auth/identity/callback', resolveTenantContext({ required: true }), apiLimiter, identityFlowLimiter, oidcCallbackFormPayloadLimit, asyncHandler(completeOidcLogin));
router.post('/api/t/:tenantSlug/auth/providers/saml/callback', resolveTenantContext({ required: true }), apiLimiter, identityFlowLimiter, asyncHandler(completeSamlLogin));
router.get('/api/auth/identity/callback', apiLimiter, identityFlowLimiter, asyncHandler(completeOidcLogin));
router.post('/api/auth/identity/callback', apiLimiter, identityFlowLimiter, oidcCallbackFormPayloadLimit, asyncHandler(completeOidcLogin));
router.post('/api/auth/providers/saml/callback', apiLimiter, identityFlowLimiter, asyncHandler(completeSamlLogin));

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
  const revoked = await revokeFederatedSessions(provider, {
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
    await genericSamlService.validateRedirectLogoutResponse(rawConfiguration, req.query as Record<string, unknown>, originalQuery, state.requestId, providerSecretContext(req, provider));
  } else {
    await genericSamlService.validatePostLogoutResponse(rawConfiguration, samlResponse, state.requestId, providerSecretContext(req, provider));
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
      const request = await genericSamlService.validatePostLogoutRequest(candidateConfiguration, parsed.data.SAMLRequest!, providerSecretContext(req, candidate));
      verified = { provider: candidate, configuration: candidateConfiguration, request };
      break;
    } catch { /* A same-key provider is selected only by successful signature and issuer validation. */ }
  }
  if (!verified) throw Errors.unauthorized('SAML LogoutRequest signature is invalid');
  const { provider, configuration: rawConfiguration, request } = verified;
  const subjectId = typeof request.nameID === 'string' ? request.nameID : '';
  const sessionId = typeof request.sessionIndex === 'string' ? request.sessionIndex : undefined;
  const revoked = await revokeFederatedSessions(provider, { subjectId, ...(sessionId ? { sessionId } : {}) });
  await logAudit(auditFromRequest(req, {
    action: AuditActions.LOGOUT,
    resourceType: 'identity_provider',
    resourceId: provider.id,
    details: { protocol: 'saml', mode: 'idp_initiated', sessionsRevoked: revoked },
  }));
  res.redirect(await genericSamlService.createLogoutResponse(rawConfiguration, request, parsed.data.RelayState || '', providerSecretContext(req, provider)));
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
