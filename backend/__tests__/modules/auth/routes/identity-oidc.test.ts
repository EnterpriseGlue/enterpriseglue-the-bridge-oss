import { beforeEach, describe, expect, it, vi } from 'vitest';
import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { identityFlowLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import identityOidcRoute from '../../../../../packages/backend-host/src/modules/auth/routes/identity-oidc.js';
import { buildSignedOidcState, parseSignedOidcState } from '../../../../../packages/backend-host/src/modules/auth/routes/sso-state.js';

const identityProviderService = vi.hoisted(() => ({ getByKey: vi.fn(), getById: vi.fn(), getDirectLoginProviderByKey: vi.fn(), getDirectLoginProviderById: vi.fn(), listEnabledDirectLoginProviders: vi.fn(), listEnabledDirectLoginProvidersForUnauthenticatedLogin: vi.fn() }));
const genericOidcService = vi.hoisted(() => ({ createAuthorizationRequest: vi.fn(), exchangeCode: vi.fn(), authenticationAssurance: vi.fn(), verifyBackChannelLogoutToken: vi.fn() }));
const genericSamlService = vi.hoisted(() => ({ createAuthorizationRequest: vi.fn(), validatePostResponse: vi.fn(), extractUserClaims: vi.fn(), authenticationAssurance: vi.fn(), validatePostLogoutRequest: vi.fn(), createLogoutResponse: vi.fn(), validatePostLogoutResponse: vi.fn(), validateRedirectLogoutResponse: vi.fn() }));
const samlAssertionReplayService = vi.hoisted(() => ({ consume: vi.fn() }));
const identityProviderProvisioningService = vi.hoisted(() => ({ reconcileOidcLogin: vi.fn(), reconcileLdapLogin: vi.fn(), reconcileSamlLogin: vi.fn() }));
const directLdapIdentityService = vi.hoisted(() => ({ authenticate: vi.fn() }));
const authSessionService = vi.hoisted(() => ({ issue: vi.fn() }));
const auditService = vi.hoisted(() => ({ auditFromRequest: vi.fn((_req: unknown, input: unknown) => input), logAudit: vi.fn() }));
const loginMethodService = vi.hoisted(() => ({ get: vi.fn() }));
const recordLoginExperienceMetric = vi.hoisted(() => vi.fn());
const identityProviderRepository = vi.hoisted(() => ({ findOne: vi.fn(), find: vi.fn() }));
const refreshTokenRepository = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js', () => ({ identityProviderService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/LoginMethodService.js', () => ({ loginMethodService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/GenericOidcService.js', () => ({ genericOidcService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/GenericSamlService.js', () => ({ genericSamlService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/SamlAssertionReplayService.js', () => ({ samlAssertionReplayService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityProviderProvisioningService.js', () => ({ identityProviderProvisioningService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/DirectLdapIdentityService.js', () => ({ directLdapIdentityService }));
vi.mock('@enterpriseglue/shared/services/AuthSessionService.js', () => ({ authSessionService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/PlatformAdministratorMembershipService.js', () => ({
  getActivePlatformAdministratorUserIds: vi.fn().mockResolvedValue(new Set()),
}));
vi.mock('@enterpriseglue/shared/services/audit.js', () => ({ AuditActions: { LOGIN_SUCCESS: 'auth.login.success', LOGIN_FAILED: 'auth.login.failed' }, ...auditService }));
vi.mock('@enterpriseglue/shared/auth/login-experience-metrics.js', () => ({ recordLoginExperienceMetric }));
vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn(async () => ({
  getRepository: (entity: { name?: string }) => entity?.name === 'IdentityProvider' ? identityProviderRepository : refreshTokenRepository,
})) }));

const provider = {
  id: 'provider-1', tenantId: null, key: 'identity.oidc.main', protocol: 'oidc', isEnabled: true,
  updatedAt: 1234,
  authenticationMode: 'direct', configurationJson: JSON.stringify({ issuerUrl: 'https://issuer.example.test', clientId: 'client', callbackUrl: 'https://app.example.test/api/auth/identity/callback', scopes: ['openid'] }),
};

describe('provider-neutral OIDC routes', () => {
  let app: express.Application;
  beforeEach(() => {
    vi.clearAllMocks();
    identityProviderService.getByKey.mockResolvedValue(provider);
    identityProviderService.getById.mockResolvedValue(provider);
    identityProviderService.getDirectLoginProviderByKey.mockResolvedValue(provider);
    identityProviderService.getDirectLoginProviderById.mockResolvedValue(provider);
    identityProviderService.listEnabledDirectLoginProviders.mockResolvedValue([provider]);
    identityProviderService.listEnabledDirectLoginProvidersForUnauthenticatedLogin.mockResolvedValue([provider]);
    loginMethodService.get.mockResolvedValue({
      localPassword: { enabled: false },
      providerSelection: 'chooser',
      autoRedirectProviderId: null,
      providers: [{ id: 'provider-1', key: 'identity.oidc.main', displayName: 'Corporate identity', organization: 'Example', protocol: 'oidc', loginMethod: 'redirect', preferred: true, loginDomains: ['example.test'] }],
      configurationStatus: 'ready',
    });
    genericOidcService.createAuthorizationRequest.mockResolvedValue({ url: 'https://issuer.example.test/authorize', codeVerifier: 'verifier' });
    genericOidcService.exchangeCode.mockResolvedValue({ sub: 'subject-1', email: 'person@example.test', nonce: 'nonce' });
    genericOidcService.authenticationAssurance.mockReturnValue({ mfaVerified: false });
    genericOidcService.verifyBackChannelLogoutToken.mockResolvedValue({ sub: 'subject-1', sid: 'session-1', events: {} });
    identityProviderProvisioningService.reconcileOidcLogin.mockResolvedValue({ id: 'user-1', email: 'person@example.test', isActive: true, authSessionVersion: 7 });
    identityProviderProvisioningService.reconcileLdapLogin.mockResolvedValue({ id: 'user-1', email: 'person@example.test', isActive: true, authSessionVersion: 7 });
    identityProviderProvisioningService.reconcileSamlLogin.mockResolvedValue({ id: 'user-1', email: 'person@example.test', isActive: true, authSessionVersion: 7 });
    directLdapIdentityService.authenticate.mockResolvedValue({ subjectId: 'ldap-user-1', email: 'person@example.test', displayName: 'Person', firstName: 'Person', lastName: 'Example', groups: ['ops'] });
    genericSamlService.createAuthorizationRequest.mockResolvedValue({ url: 'https://idp.example.test/sso?SAMLRequest=request', entryPoint: 'https://idp.example.test/sso' });
    genericSamlService.validatePostResponse.mockResolvedValue({ nameID: 'person@example.test', groups: ['ops'] });
    genericSamlService.extractUserClaims.mockReturnValue({ subjectId: 'subject-1', email: 'person@example.test', displayName: 'Person', firstName: 'Person', lastName: 'Example', directoryTenantId: null, claims: { sub: 'subject-1', email: 'person@example.test', groups: ['ops'] } });
    genericSamlService.authenticationAssurance.mockReturnValue({ mfaVerified: false, authnContext: [] });
    genericSamlService.validatePostLogoutRequest.mockResolvedValue({ nameID: 'subject-1', sessionIndex: 'session-1', issuer: 'https://issuer.example.test', ID: '_logout-request' });
    genericSamlService.createLogoutResponse.mockResolvedValue('https://issuer.example.test/slo?SAMLResponse=response');
    genericSamlService.validatePostLogoutResponse.mockResolvedValue(undefined);
    genericSamlService.validateRedirectLogoutResponse.mockResolvedValue(undefined);
    samlAssertionReplayService.consume.mockResolvedValue(undefined);
    authSessionService.issue.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 });
    identityProviderRepository.findOne.mockResolvedValue(provider);
    identityProviderRepository.find.mockResolvedValue([]);
    refreshTokenRepository.update.mockResolvedValue({ affected: 1 });
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(cookieParser());
    app.use(identityOidcRoute);
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode || 500).json({ error: error.message }));
  });

  it('starts direct OIDC only after binding the selected provider into state and PKCE cookies', async () => {
    const response = await request(app).get('/api/auth/identity/identity.oidc.main/start').redirects(0);
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('https://issuer.example.test/authorize');
    expect(genericOidcService.createAuthorizationRequest).toHaveBeenCalledWith(
      expect.any(Object), expect.any(String), expect.any(String),
    );
    const setCookie = response.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    expect(cookies.join(';')).toContain('identity_oidc_state=');
    expect(cookies.join(';')).toContain('identity_oidc_verifier=verifier');
  });

  it('rejects claims-only providers from direct browser login', async () => {
    identityProviderService.getDirectLoginProviderByKey.mockResolvedValue({ ...provider, authenticationMode: 'claims_only' });
    const response = await request(app).get('/api/auth/identity/identity.oidc.main/start');
    expect(response.status).toBe(403);
    expect(genericOidcService.createAuthorizationRequest).not.toHaveBeenCalled();
  });

  it('lists minimal provider-neutral direct-login options without provider configuration', async () => {
    const response = await request(app).get('/api/auth/providers/enabled');
    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 'provider-1', key: 'identity.oidc.main', displayName: 'identity.oidc.main', organization: null, protocol: 'oidc', loginMethod: 'redirect' }]);
    expect(identityProviderService.listEnabledDirectLoginProvidersForUnauthenticatedLogin).toHaveBeenCalledWith();
    expect(identityFlowLimiter).toHaveBeenCalledOnce();
  });

  it('returns the sanitized, policy-resolved login-method contract', async () => {
    const response = await request(app).get('/api/auth/login-methods');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      localPassword: { enabled: false },
      providerSelection: 'chooser',
      providers: [{ displayName: 'Corporate identity', organization: 'Example', loginDomains: ['example.test'] }],
    });
    expect(response.body.providers[0]).not.toHaveProperty('configurationJson');
    expect(loginMethodService.get).toHaveBeenCalledWith(null);
  });

  it('resolves tenant-scoped discovery and binds the slug into provider state', async () => {
    const methods = await request(app).get('/api/t/acme/auth/login-methods');
    expect(methods.status).toBe(200);
    expect(loginMethodService.get).toHaveBeenCalledWith('tenant-default');

    const start = await request(app).get('/api/t/acme/auth/providers/provider-1/start').redirects(0);
    expect(start.status).toBe(302);
    expect(identityProviderService.getDirectLoginProviderById).toHaveBeenCalledWith('provider-1', 'tenant-default');
    const authorizationCalls = genericOidcService.createAuthorizationRequest.mock.calls;
    const encodedState = authorizationCalls[authorizationCalls.length - 1]?.[1];
    const state = parseSignedOidcState(encodedState);
    expect(state).toMatchObject({ tenantSlug: 'acme', providerId: 'provider-1' });
  });

  it('starts OIDC login through the exact provider id', async () => {
    const response = await request(app).get('/api/auth/providers/provider-1/start').redirects(0);
    expect(response.status).toBe(302);
    expect(identityProviderService.getDirectLoginProviderById).toHaveBeenCalledWith('provider-1', null);
    expect(response.headers.location).toBe('https://issuer.example.test/authorize');
    expect(recordLoginExperienceMetric).toHaveBeenCalledWith({ method: 'oidc', event: 'selected' });
  });

  it('completes only when callback state is bound to the exact provider', async () => {
    const state = buildSignedOidcState({ params: {}, query: {} } as any, 'provider-1', { key: 'identity.oidc.main', tenantId: null });
    const response = await request(app)
      .get(`/api/auth/identity/callback?code=code-1&state=${encodeURIComponent(state)}`)
      .set('Cookie', [`identity_oidc_state=${state}`, 'identity_oidc_verifier=verifier'])
      .redirects(0);
    expect(response.status).toBe(302);
    expect(identityProviderService.getByKey).toHaveBeenLastCalledWith('identity.oidc.main', null);
    expect(genericOidcService.exchangeCode).toHaveBeenCalledWith(expect.any(Object), { code: 'code-1', codeVerifier: 'verifier', nonce: expect.any(String) });
    expect(identityProviderProvisioningService.reconcileOidcLogin).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'oidc' }), expect.objectContaining({ sub: 'subject-1', email: 'person@example.test' }));
    expect(identityProviderProvisioningService.reconcileOidcLogin.mock.invocationCallOrder[0]).toBeLessThan(authSessionService.issue.mock.invocationCallOrder[0]);
    expect(authSessionService.issue).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1', authSessionVersion: 7 }), expect.objectContaining({ identityProviderId: 'provider-1', identityProviderUpdatedAt: 1234 }));
    expect(recordLoginExperienceMetric).toHaveBeenCalledWith(expect.objectContaining({ method: 'oidc', event: 'succeeded' }));
  });

  it('rejects callback state when its provider id resolves to a different same-protocol provider', async () => {
    const state = buildSignedOidcState({ params: {}, query: {} } as any, 'provider-1', { key: 'identity.oidc.main', tenantId: null });
    identityProviderService.getByKey.mockResolvedValue({
      ...provider,
      id: 'provider-2',
      key: 'identity.oidc.secondary',
    });

    const response = await request(app)
      .get(`/api/auth/identity/callback?code=code-1&state=${encodeURIComponent(state)}`)
      .set('Cookie', [`identity_oidc_state=${state}`, 'identity_oidc_verifier=verifier'])
      .redirects(0);

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Identity provider state does not match the selected provider');
    expect(genericOidcService.exchangeCode).not.toHaveBeenCalled();
    expect(identityProviderProvisioningService.reconcileOidcLogin).not.toHaveBeenCalled();
    expect(authSessionService.issue).not.toHaveBeenCalled();
    expect(recordLoginExperienceMetric).toHaveBeenCalledWith(expect.objectContaining({ method: 'oidc', event: 'failed' }));
  });

  it('rejects a tenant/provider-tampered OIDC state even when the attacker matches the cookie', async () => {
    const valid = buildSignedOidcState({ params: {}, query: {} } as any, 'provider-1', { key: 'identity.oidc.main', tenantId: null });
    const parts = valid.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const inner = JSON.parse(Buffer.from(payload.state, 'base64url').toString('utf8'));
    inner.identityProviderTenantId = 'tenant-b';
    inner.identityProviderKey = 'identity.oidc.other';
    payload.state = Buffer.from(JSON.stringify(inner)).toString('base64url');
    const tampered = `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${parts[2]}`;

    const response = await request(app)
      .get(`/api/auth/identity/callback?code=code-1&state=${encodeURIComponent(tampered)}`)
      .set('Cookie', [`identity_oidc_state=${tampered}`, 'identity_oidc_verifier=verifier'])
      .redirects(0);

    expect(response.status).toBe(401);
    expect(identityProviderService.getByKey).not.toHaveBeenCalled();
    expect(genericOidcService.exchangeCode).not.toHaveBeenCalled();
  });

  it('authenticates a direct LDAP provider without returning directory credentials', async () => {
    identityProviderService.getDirectLoginProviderByKey.mockResolvedValue({ ...provider, protocol: 'ldap', authenticationMode: 'direct' });
    const response = await request(app).post('/api/auth/identity/identity.oidc.main/ldap/login').send({ username: 'person@example.test', password: 'directory-password' });
    expect(response.status).toBe(200);
    expect(directLdapIdentityService.authenticate).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'ldap' }), 'person@example.test', 'directory-password');
    expect(response.body.user.email).toBe('person@example.test');
    expect(response.body.user.session).toEqual({
      principal: { type: 'user', id: 'user-1' },
      tenant: { id: null },
    });
    expect(response.headers['set-cookie']).toEqual(expect.arrayContaining([expect.stringContaining('accessToken='), expect.stringContaining('refreshToken=')]));
    expect(identityProviderProvisioningService.reconcileLdapLogin).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'ldap' }), expect.objectContaining({
      subjectId: 'ldap-user-1', claims: { sub: 'ldap-user-1', email: 'person@example.test', groups: ['ops'] },
    }));
    expect(recordLoginExperienceMetric).toHaveBeenCalledWith({ method: 'ldap', event: 'selected' });
    expect(recordLoginExperienceMetric).toHaveBeenCalledWith(expect.objectContaining({ method: 'ldap', event: 'succeeded' }));
    expect(identityProviderProvisioningService.reconcileLdapLogin.mock.invocationCallOrder[0]).toBeLessThan(authSessionService.issue.mock.invocationCallOrder[0]);
    expect(authSessionService.issue).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), expect.objectContaining({ identityProviderId: 'provider-1', identityProviderUpdatedAt: 1234 }));
  });

  it('authenticates direct LDAP through the exact provider id', async () => {
    identityProviderService.getDirectLoginProviderById.mockResolvedValue({ ...provider, protocol: 'ldap', authenticationMode: 'direct' });
    const response = await request(app).post('/api/auth/providers/provider-1/login').send({ username: 'person@example.test', password: 'directory-password' });
    expect(response.status).toBe(200);
    expect(identityProviderService.getDirectLoginProviderById).toHaveBeenCalledWith('provider-1', null);
    expect(directLdapIdentityService.authenticate).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'ldap' }), 'person@example.test', 'directory-password');
  });

  it('authenticates direct LDAP only in the resolved tenant scope', async () => {
    identityProviderService.getDirectLoginProviderById.mockResolvedValue({ ...provider, protocol: 'ldap', authenticationMode: 'direct' });
    const response = await request(app).post('/api/t/acme/auth/providers/provider-1/login').send({ username: 'person@example.test', password: 'directory-password' });
    expect(response.status).toBe(200);
    expect(identityProviderService.getDirectLoginProviderById).toHaveBeenCalledWith('provider-1', 'tenant-default');
  });

  it('does not expose LDAP transport failures during direct sign-in', async () => {
    identityProviderService.getDirectLoginProviderByKey.mockResolvedValue({ ...provider, protocol: 'ldap', authenticationMode: 'direct' });
    directLdapIdentityService.authenticate.mockRejectedValue(new Error('ETIMEDOUT ldaps://directory.internal:636 bind password=directory-password'));

    const response = await request(app)
      .post('/api/auth/identity/identity.oidc.main/ldap/login')
      .send({ username: 'person@example.test', password: 'directory-password' });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Invalid directory credentials');
    expect(JSON.stringify(response.body)).not.toContain('directory.internal');
    expect(JSON.stringify(response.body)).not.toContain('directory-password');
    expect(auditService.logAudit).toHaveBeenCalledWith(expect.anything());
    expect(authSessionService.issue).not.toHaveBeenCalled();
  });

  it('does not reconcile memberships or issue a session when LDAP safety budgets stop authentication', async () => {
    identityProviderService.getDirectLoginProviderByKey.mockResolvedValue({ ...provider, protocol: 'ldap', authenticationMode: 'direct' });
    directLdapIdentityService.authenticate.mockRejectedValue(new Error('LDAP group search exceeded its safety limit'));

    const response = await request(app)
      .post('/api/auth/identity/identity.oidc.main/ldap/login')
      .send({ username: 'person@example.test', password: 'directory-password' });

    expect(response.status).toBe(401);
    expect(identityProviderProvisioningService.reconcileLdapLogin).not.toHaveBeenCalled();
    expect(authSessionService.issue).not.toHaveBeenCalled();
  });

  it('starts and completes direct SAML login through the exact provider id', async () => {
    const samlProvider = {
      ...provider,
      key: 'identity.saml.main',
      protocol: 'saml',
      configurationJson: JSON.stringify({ entityId: 'enterpriseglue', idpEntityId: 'https://idp.example.test', callbackUrl: 'https://app.example.test/api/auth/providers/saml/callback', ssoUrl: 'https://idp.example.test/sso', signingCertificateRef: 'EG_SAML_CERT' }),
    };
    identityProviderService.getDirectLoginProviderById.mockResolvedValue(samlProvider);
    identityProviderService.getByKey.mockResolvedValue(samlProvider);
    identityProviderService.listEnabledDirectLoginProviders.mockResolvedValue([samlProvider]);

    const browser = request.agent(app);
    const start = await browser.get('/api/auth/providers/provider-1/start').redirects(0);
    expect(start.status).toBe(302);
    expect(start.headers.location).toContain('https://idp.example.test/sso');
    const relayState = genericSamlService.createAuthorizationRequest.mock.calls[0][1];
    const requestId = genericSamlService.createAuthorizationRequest.mock.calls[0][2];
    expect(relayState).toEqual(expect.any(String));
    expect(requestId).toMatch(/^_[A-Za-z0-9_-]{32,160}$/);

    const callback = await browser
      .post('/api/auth/providers/saml/callback')
      .type('form')
      .send({ SAMLResponse: 'signed-response', RelayState: relayState })
      .redirects(0);
    expect(callback.status).toBe(302);
    expect(genericSamlService.validatePostResponse).toHaveBeenCalledWith(expect.any(Object), 'signed-response', requestId);
    expect(samlAssertionReplayService.consume).toHaveBeenCalledWith({ providerId: 'provider-1', tenantId: null, requestId });
    expect(identityProviderProvisioningService.reconcileSamlLogin).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'saml' }), expect.objectContaining({ subjectId: 'subject-1', claims: expect.objectContaining({ groups: ['ops'] }) }));
    expect(identityProviderProvisioningService.reconcileSamlLogin.mock.invocationCallOrder[0]).toBeLessThan(authSessionService.issue.mock.invocationCallOrder[0]);
    expect(authSessionService.issue).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), expect.objectContaining({ identityProviderId: 'provider-1', identityProviderUpdatedAt: 1234 }));
    expect(callback.headers['set-cookie']).toEqual(expect.arrayContaining([expect.stringContaining('identity_saml_request=;')]));
  });

  it('rejects a valid signed SAML response when the initiating browser cookie is missing or wrong', async () => {
    const samlProvider = { ...provider, protocol: 'saml' };
    identityProviderService.getDirectLoginProviderById.mockResolvedValue(samlProvider);
    identityProviderService.getByKey.mockResolvedValue(samlProvider);
    const initiatingBrowser = request.agent(app);
    await initiatingBrowser.get('/api/auth/providers/provider-1/start').redirects(0);
    const relayState = genericSamlService.createAuthorizationRequest.mock.calls[0][1];

    const missing = await request(app).post('/api/auth/providers/saml/callback').type('form').send({ SAMLResponse: 'signed-response', RelayState: relayState });
    expect(missing.status).toBe(401);
    const wrong = await request(app).post('/api/auth/providers/saml/callback')
      .set('Cookie', 'identity_saml_request=_wrong_browser_request_00000000000000000000000000000000')
      .type('form').send({ SAMLResponse: 'signed-response', RelayState: relayState });
    expect(wrong.status).toBe(401);
    expect(genericSamlService.validatePostResponse).not.toHaveBeenCalled();
    expect(identityProviderProvisioningService.reconcileSamlLogin).not.toHaveBeenCalled();
    expect(authSessionService.issue).not.toHaveBeenCalled();
  });

  it('fails closed when a provider-neutral SAML RelayState is unsigned or expired', async () => {
    identityProviderService.getByKey.mockResolvedValue({ ...provider, protocol: 'saml' });
    const response = await request(app)
      .post('/api/auth/providers/saml/callback')
      .type('form')
      .send({ SAMLResponse: 'signed-response', RelayState: 'forged-state' });

    expect(response.status).toBe(401);
    expect(genericSamlService.validatePostResponse).not.toHaveBeenCalled();
    expect(identityProviderProvisioningService.reconcileSamlLogin).not.toHaveBeenCalled();
  });

  it('rejects a replayed SAML assertion before provisioning a user session', async () => {
    const samlProvider = { ...provider, protocol: 'saml' };
    identityProviderService.getDirectLoginProviderById.mockResolvedValue(samlProvider);
    identityProviderService.getByKey.mockResolvedValue(samlProvider);
    samlAssertionReplayService.consume.mockRejectedValue({ statusCode: 401, message: 'SAML assertion has already been used' });
    const browser = request.agent(app);
    await browser.get('/api/auth/providers/provider-1/start').redirects(0);
    const relayState = genericSamlService.createAuthorizationRequest.mock.calls[0][1];
    const response = await browser
      .post('/api/auth/providers/saml/callback')
      .type('form')
      .send({ SAMLResponse: 'replayed-response', RelayState: relayState });

    expect(response.status).toBe(401);
    expect(identityProviderProvisioningService.reconcileSamlLogin).not.toHaveBeenCalled();
    expect(authSessionService.issue).not.toHaveBeenCalled();
  });

  it('rejects OIDC session issuance after a provider trust edit and never audits login success', async () => {
    authSessionService.issue.mockRejectedValue({ statusCode: 401, message: 'Identity provider changed while sign-in was in progress' });
    const state = buildSignedOidcState({ params: {}, query: {} } as any, 'provider-1', { key: provider.key, tenantId: null });
    const response = await request(app)
      .get(`/api/auth/identity/callback?code=code-1&state=${encodeURIComponent(state)}`)
      .set('Cookie', [`identity_oidc_state=${state}`, 'identity_oidc_verifier=verifier'])
      .redirects(0);

    expect(response.status).toBe(401);
    expect(auditService.logAudit).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.login.success' }));
    expect(auditService.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.login.failed', details: expect.objectContaining({ reason: 'session_not_issued' }) }));
    const oidcCookies = response.headers['set-cookie'];
    const oidcCookieHeader = Array.isArray(oidcCookies) ? oidcCookies.join(';') : oidcCookies || '';
    expect(oidcCookieHeader).not.toContain('accessToken=');
    expect(oidcCookieHeader).not.toContain('refreshToken=');
  });

  it('rejects SAML session issuance after a provider trust edit and never audits login success', async () => {
    const samlProvider = { ...provider, protocol: 'saml' };
    identityProviderService.getDirectLoginProviderById.mockResolvedValue(samlProvider);
    identityProviderService.getByKey.mockResolvedValue(samlProvider);
    authSessionService.issue.mockRejectedValue({ statusCode: 401, message: 'Identity provider changed while sign-in was in progress' });
    const browser = request.agent(app);
    await browser.get('/api/auth/providers/provider-1/start').redirects(0);
    const relayState = genericSamlService.createAuthorizationRequest.mock.calls[0][1];
    const response = await browser.post('/api/auth/providers/saml/callback').type('form').send({ SAMLResponse: 'signed-response', RelayState: relayState });

    expect(response.status).toBe(401);
    expect(auditService.logAudit).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.login.success' }));
    expect(auditService.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.login.failed', details: expect.objectContaining({ reason: 'session_not_issued' }) }));
    const samlCookies = response.headers['set-cookie'];
    const samlCookieHeader = Array.isArray(samlCookies) ? samlCookies.join(';') : samlCookies || '';
    expect(samlCookieHeader).not.toContain('accessToken=');
    expect(samlCookieHeader).not.toContain('refreshToken=');
  });

  it('revokes only the provider subject and session from a verified OIDC back-channel logout token', async () => {
    const response = await request(app)
      .post('/api/auth/providers/provider-1/oidc/backchannel-logout')
      .type('form')
      .send({ logout_token: 'signed-logout-token' });

    expect(response.status).toBe(200);
    expect(genericOidcService.verifyBackChannelLogoutToken).toHaveBeenCalledWith(expect.any(Object), 'signed-logout-token');
    expect(refreshTokenRepository.update).toHaveBeenCalledWith(expect.objectContaining({
      identityProviderId: 'provider-1', providerSubjectId: 'subject-1', providerSessionId: 'session-1',
    }), expect.objectContaining({ revokedAt: expect.any(Number) }));
  });

  it('rejects a non-form OIDC back-channel request before token verification', async () => {
    const response = await request(app)
      .post('/api/auth/providers/provider-1/oidc/backchannel-logout')
      .send({ logout_token: 'signed-logout-token' });

    expect(response.status).toBe(400);
    expect(genericOidcService.verifyBackChannelLogoutToken).not.toHaveBeenCalled();
    expect(refreshTokenRepository.update).not.toHaveBeenCalled();
  });

  it('validates a signed IdP-initiated SAML LogoutRequest before targeted revocation and response', async () => {
    const samlProvider = {
      ...provider,
      key: 'identity.saml.main',
      protocol: 'saml',
      configurationJson: JSON.stringify({
        sloUrl: 'https://issuer.example.test/slo',
        logoutCallbackUrl: 'http://localhost:5173/api/auth/identity/identity.saml.main/saml/logout',
      }),
    };
    identityProviderRepository.find.mockResolvedValue([samlProvider]);

    const response = await request(app)
      .post('/api/auth/identity/identity.saml.main/saml/logout')
      .type('form')
      .send({ SAMLRequest: 'signed-logout-request', RelayState: 'idp-state' })
      .redirects(0);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('https://issuer.example.test/slo?SAMLResponse=response');
    expect(genericSamlService.validatePostLogoutRequest).toHaveBeenCalledBefore(refreshTokenRepository.update);
    expect(refreshTokenRepository.update).toHaveBeenCalledWith(expect.objectContaining({
      identityProviderId: 'provider-1', providerSubjectId: 'subject-1', providerSessionId: 'session-1',
    }), expect.any(Object));
    expect(genericSamlService.createLogoutResponse).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ ID: '_logout-request' }), 'idp-state');
  });
});
