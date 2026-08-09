import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import identityOidcRoute from '../../../../../packages/backend-host/src/modules/auth/routes/identity-oidc.js';
import { MockOidcProvider } from '../../../../test/identity-mocks/index.js';

const identityProviderService = vi.hoisted(() => ({
  getByKey: vi.fn(),
  getById: vi.fn(),
  getDirectLoginProviderByKey: vi.fn(),
  getDirectLoginProviderById: vi.fn(),
  listEnabledDirectLoginProviders: vi.fn(),
  listEnabledDirectLoginProvidersForUnauthenticatedLogin: vi.fn(),
}));
const identityProviderProvisioningService = vi.hoisted(() => ({ reconcileOidcLogin: vi.fn() }));
const authSessionService = vi.hoisted(() => ({ issue: vi.fn() }));

vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js', () => ({ identityProviderService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityProviderProvisioningService.js', () => ({ identityProviderProvisioningService }));
vi.mock('@enterpriseglue/shared/services/AuthSessionService.js', () => ({ authSessionService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/PlatformAdministratorMembershipService.js', () => ({
  getActivePlatformAdministratorUserIds: vi.fn().mockResolvedValue(new Set()),
}));
vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  AuditActions: { LOGIN_SUCCESS: 'auth.login.success' },
  auditFromRequest: vi.fn(() => ({})),
  logAudit: vi.fn(),
}));
vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  identityFlowLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('@enterpriseglue/shared/config/index.js', () => ({
  shouldUseSecureCookies: () => false,
  config: {
    frontendUrl: 'http://frontend.test',
    jwtSecret: 'identity-flow-test-secret-that-is-long-enough',
    jwtAccessTokenExpires: 900,
    jwtRefreshTokenExpires: 604800,
  },
}));

describe('provider-neutral OIDC browser flow', () => {
  const protocol = new MockOidcProvider({ callbackUrl: 'http://frontend.test/api/auth/identity/callback' });
  const providerA = {
    id: 'provider-oidc-a',
    tenantId: null,
    key: 'identity.oidc.a',
    updatedAt: 1234,
    protocol: 'oidc',
    isEnabled: true,
    authenticationMode: 'direct',
    configurationJson: JSON.stringify(protocol.configuration()),
  };
  const providerB = {
    ...providerA,
    id: 'provider-oidc-b',
    key: 'identity.oidc.b',
  };
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    protocol.reset();
    vi.stubGlobal('fetch', protocol.fetch.bind(protocol));
    const byId = new Map([[providerA.id, providerA], [providerB.id, providerB]]);
    const byKey = new Map([[providerA.key, providerA], [providerB.key, providerB]]);
    identityProviderService.getById.mockImplementation(async (id: string) => byId.get(id) || null);
    identityProviderService.getByKey.mockImplementation(async (key: string) => byKey.get(key) || null);
    identityProviderService.getDirectLoginProviderById.mockImplementation(async (id: string) => byId.get(id) || null);
    identityProviderService.getDirectLoginProviderByKey.mockImplementation(async (key: string) => byKey.get(key) || null);
    identityProviderService.listEnabledDirectLoginProviders.mockResolvedValue([providerA, providerB]);
    identityProviderService.listEnabledDirectLoginProvidersForUnauthenticatedLogin.mockResolvedValue([providerA, providerB]);
    identityProviderProvisioningService.reconcileOidcLogin.mockImplementation(async (provider: typeof providerA, claims: { email?: string }) => ({
      id: `user-for-${provider.id}`,
      email: claims.email || 'person@example.test',
      isActive: true,
    }));
    authSessionService.issue.mockImplementation(async (user: { id: string }, options: { identityProviderId: string }) => ({
      accessToken: `access-${user.id}-${options.identityProviderId}`,
      refreshToken: `refresh-${user.id}-${options.identityProviderId}`,
      expiresIn: 900,
    }));
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(identityOidcRoute);
    app.use((error: any, _req: unknown, res: express.Response, _next: unknown) => {
      res.status(error.statusCode || 500).json({ error: error.message });
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('keeps two OIDC providers isolated by provider id, state, PKCE verifier, provisioning, and session', async () => {
    const browserA = request.agent(app);
    const browserB = request.agent(app);

    const startA = await browserA.get(`/api/auth/providers/${providerA.id}/start`).redirects(0);
    const startB = await browserB.get(`/api/auth/providers/${providerB.id}/start`).redirects(0);
    expect(startA.status).toBe(302);
    expect(startB.status).toBe(302);

    const authorizationA = new URL(startA.headers.location);
    const authorizationB = new URL(startB.headers.location);
    const stateA = authorizationA.searchParams.get('state');
    const stateB = authorizationB.searchParams.get('state');
    const nonceA = authorizationA.searchParams.get('nonce');
    const nonceB = authorizationB.searchParams.get('nonce');
    expect(stateA).toBeTruthy();
    expect(stateB).toBeTruthy();
    expect(stateA).not.toBe(stateB);
    expect(nonceA).not.toBe(nonceB);

    const crossedState = await browserA
      .get('/api/auth/identity/callback')
      .query({ code: 'code-b', state: stateB })
      .redirects(0);
    expect(crossedState.status).toBe(401);
    expect(identityProviderProvisioningService.reconcileOidcLogin).not.toHaveBeenCalled();

    protocol.setTokenClaims({
      sub: 'subject-a',
      email: 'a@example.test',
      email_verified: true,
      groups: ['group-a'],
      nonce: nonceA,
    });
    const callbackA = await browserA
      .get('/api/auth/identity/callback')
      .query({ code: 'code-a', state: stateA })
      .redirects(0);
    expect(callbackA.status).toBe(302);

    protocol.setTokenClaims({
      sub: 'subject-b',
      email: 'b@example.test',
      email_verified: true,
      groups: ['group-b'],
      nonce: nonceB,
    });
    const callbackB = await browserB
      .get('/api/auth/identity/callback')
      .query({ code: 'code-b', state: stateB })
      .redirects(0);
    expect(callbackB.status).toBe(302);

    expect(identityProviderService.getDirectLoginProviderById).toHaveBeenCalledWith(providerA.id, null);
    expect(identityProviderService.getDirectLoginProviderById).toHaveBeenCalledWith(providerB.id, null);
    expect(identityProviderService.getByKey).toHaveBeenCalledWith(providerA.key, null);
    expect(identityProviderService.getByKey).toHaveBeenCalledWith(providerB.key, null);
    expect(identityProviderProvisioningService.reconcileOidcLogin).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: providerA.id, key: providerA.key }),
      expect.objectContaining({ sub: 'subject-a', groups: ['group-a'] }),
    );
    expect(identityProviderProvisioningService.reconcileOidcLogin).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: providerB.id, key: providerB.key }),
      expect.objectContaining({ sub: 'subject-b', groups: ['group-b'] }),
    );
    expect(authSessionService.issue).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: `user-for-${providerA.id}` }),
      expect.objectContaining({ identityProviderId: providerA.id }),
    );
    expect(authSessionService.issue).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: `user-for-${providerB.id}` }),
      expect.objectContaining({ identityProviderId: providerB.id }),
    );
  });
});
