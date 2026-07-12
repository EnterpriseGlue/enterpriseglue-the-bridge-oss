import { beforeEach, describe, expect, it, vi } from 'vitest';
import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import identityOidcRoute from '../../../../../packages/backend-host/src/modules/auth/routes/identity-oidc.js';

const identityProviderService = vi.hoisted(() => ({ getByKey: vi.fn() }));
const genericOidcService = vi.hoisted(() => ({ createAuthorizationRequest: vi.fn(), exchangeCode: vi.fn() }));
const identityProviderProvisioningService = vi.hoisted(() => ({ provisionOidcUser: vi.fn(), provisionLdapUser: vi.fn() }));
const directLdapIdentityService = vi.hoisted(() => ({ authenticate: vi.fn() }));

vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js', () => ({ identityProviderService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/GenericOidcService.js', () => ({ genericOidcService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityProviderProvisioningService.js', () => ({ identityProviderProvisioningService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/DirectLdapIdentityService.js', () => ({ directLdapIdentityService }));
vi.mock('@enterpriseglue/shared/services/audit.js', () => ({ AuditActions: { LOGIN_SUCCESS: 'auth.login.success' }, auditFromRequest: vi.fn(() => ({})), logAudit: vi.fn() }));
vi.mock('@enterpriseglue/shared/utils/jwt.js', () => ({ generateAccessToken: vi.fn(() => 'access'), generateRefreshToken: vi.fn(() => 'refresh') }));

const provider = {
  id: 'provider-1', tenantId: null, key: 'identity.oidc.main', protocol: 'oidc', isEnabled: true,
  authenticationMode: 'direct', configurationJson: JSON.stringify({ issuerUrl: 'https://issuer.example.test', clientId: 'client', callbackUrl: 'https://app.example.test/api/auth/identity/callback', scopes: ['openid'] }),
};

describe('provider-neutral OIDC routes', () => {
  let app: express.Application;
  beforeEach(() => {
    vi.clearAllMocks();
    identityProviderService.getByKey.mockResolvedValue(provider);
    genericOidcService.createAuthorizationRequest.mockResolvedValue({ url: 'https://issuer.example.test/authorize', codeVerifier: 'verifier' });
    genericOidcService.exchangeCode.mockResolvedValue({ sub: 'subject-1', email: 'person@example.test', nonce: 'nonce' });
    identityProviderProvisioningService.provisionOidcUser.mockResolvedValue({ id: 'user-1', email: 'person@example.test', platformRole: 'user', isActive: true });
    identityProviderProvisioningService.provisionLdapUser.mockResolvedValue({ id: 'user-1', email: 'person@example.test', platformRole: 'user', isActive: true });
    directLdapIdentityService.authenticate.mockResolvedValue({ subjectId: 'ldap-user-1', email: 'person@example.test', displayName: 'Person', firstName: 'Person', lastName: 'Example', groups: ['ops'] });
    app = express();
    app.use(express.json());
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
    expect(response.headers['set-cookie'].join(';')).toContain('identity_oidc_state=');
    expect(response.headers['set-cookie'].join(';')).toContain('identity_oidc_verifier=verifier');
  });

  it('rejects claims-only providers from direct browser login', async () => {
    identityProviderService.getByKey.mockResolvedValue({ ...provider, authenticationMode: 'claims_only' });
    const response = await request(app).get('/api/auth/identity/identity.oidc.main/start');
    expect(response.status).toBe(403);
    expect(genericOidcService.createAuthorizationRequest).not.toHaveBeenCalled();
  });

  it('completes only when callback state is bound to the exact provider', async () => {
    const state = Buffer.from(JSON.stringify({ timestamp: Date.now(), nonce: 'nonce', providerId: 'provider-1', identityProviderKey: 'identity.oidc.main' })).toString('base64');
    const response = await request(app)
      .get(`/api/auth/identity/callback?code=code-1&state=${encodeURIComponent(state)}`)
      .set('Cookie', [`identity_oidc_state=${state}`, 'identity_oidc_verifier=verifier'])
      .redirects(0);
    expect(response.status).toBe(302);
    expect(identityProviderService.getByKey).toHaveBeenLastCalledWith('identity.oidc.main', null);
    expect(genericOidcService.exchangeCode).toHaveBeenCalledWith(expect.any(Object), { code: 'code-1', codeVerifier: 'verifier', nonce: 'nonce' });
  });

  it('authenticates a direct LDAP provider without returning directory credentials', async () => {
    identityProviderService.getByKey.mockResolvedValue({ ...provider, protocol: 'ldap', authenticationMode: 'direct' });
    const response = await request(app).post('/api/auth/identity/identity.oidc.main/ldap/login').send({ username: 'person@example.test', password: 'directory-password' });
    expect(response.status).toBe(200);
    expect(directLdapIdentityService.authenticate).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'ldap' }), 'person@example.test', 'directory-password');
    expect(response.body.user.email).toBe('person@example.test');
    expect(response.headers['set-cookie']).toEqual(expect.arrayContaining([expect.stringContaining('accessToken='), expect.stringContaining('refreshToken=')]));
  });
});
