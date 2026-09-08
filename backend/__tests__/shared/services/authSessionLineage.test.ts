import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { authSessionService } from '@enterpriseglue/shared/services/AuthSessionService.js';
import { generateAccessToken, generateRefreshToken, normalizeUserJwtPayload, verifyToken } from '@enterpriseglue/shared/utils/jwt.js';

vi.mock('@enterpriseglue/shared/config/index.js', () => ({ config: {
  tenancyMode: 'pooled', jwtSecret: 'synthetic-session-lineage-test-signing-key',
  jwtAccessTokenExpires: 3600, jwtRefreshTokenExpires: 86400,
  tenancyCloudRequired: true, cloudAccountIdentityEnabled: true,
} }));
vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

describe('durable browser session identity', () => {
  const insert = vi.fn();
  const findSession = vi.fn();
  const claimSession = vi.fn();
  const findProvider = vi.fn();
  const claimProvider = vi.fn();
  const user = { id: 'same-user', email: 'same@example.test', authSessionVersion: 3 };
  const provider = { id: 'provider-a', protocol: 'oidc', authenticationMode: 'direct', updatedAt: 12, directoryTenantId: null, configurationJson: '{}' };
  beforeEach(() => {
    vi.resetAllMocks();
    claimSession.mockResolvedValue({ affected: 1 });
    claimProvider.mockResolvedValue({ affected: 1 });
    findProvider.mockResolvedValue(provider);
    const store = { getRepository: (entity: unknown) => {
      if (entity === RefreshToken) return { insert, findOneBy: findSession, update: claimSession };
      if (entity === IdentityProvider) return { findOneBy: findProvider, update: claimProvider };
      throw new Error('Unexpected repository');
    } };
    vi.mocked(getDataSource).mockResolvedValue({ ...store, transaction: async (work: (value: typeof store) => unknown) => work(store) } as any);
  });
  afterEach(() => vi.restoreAllMocks());

  async function sourceSession(method: 'local' | 'oidc' | 'saml' | 'ldap' = 'local') {
    findProvider.mockResolvedValue({ ...provider, protocol: method });
    const session = await authSessionService.issue(user, {
      tenantId: 'alpha', tenantSlug: 'alpha', authenticationMethod: method, mfaVerified: true,
      ...(method !== 'local' ? {
        identityProviderId: provider.id, identityProviderUpdatedAt: provider.updatedAt,
        identityProviderProtocol: method, identityProviderAuthenticationMode: 'direct' as const,
        identityProviderConfigurationJson: '{}', federationSession: { subjectId: 'subject-a', sessionId: 'provider-session-a', nameIdFormat: 'name-format' },
      } : {}),
    });
    const row = insert.mock.calls[0]![0];
    findSession.mockResolvedValue(row);
    insert.mockClear(); claimProvider.mockClear();
    return { row, input: {
      principal: normalizeUserJwtPayload(verifyToken(session.accessToken)), refreshToken: session.refreshToken,
      tenantId: 'beta', tenantSlug: 'beta',
    } };
  }

  it.each(['oidc', 'saml', 'ldap'] as const)('preserves %s provider lineage and assurance on a different-tenant child', async (method) => {
    const { row, input } = await sourceSession(method);
    const child = await authSessionService.switchTenant(user, input);
    expect(verifyToken(child.accessToken)).toMatchObject({ tenantId: 'beta', tenantSlug: 'beta', authenticationMethod: method, mfaVerified: true, authSessionVersion: 3 });
    expect(insert.mock.calls[0]![0]).toMatchObject({ identityProviderId: 'provider-a', providerSubjectId: 'subject-a', providerSessionId: 'provider-session-a', providerNameIdFormat: 'name-format', tenantId: 'beta' });
    expect(insert.mock.calls[0]![0].id).not.toBe(row.id);
    expect(claimProvider.mock.invocationCallOrder[0]).toBeLessThan(claimSession.mock.invocationCallOrder[0]);
    expect(claimSession.mock.invocationCallOrder[0]).toBeLessThan(insert.mock.invocationCallOrder[0]);
    expect(findSession).toHaveBeenCalledWith(expect.objectContaining({ id: row.id, userId: user.id, tenantId: 'alpha', revokedAt: expect.objectContaining({ _type: 'isNull' }), expiresAt: expect.objectContaining({ _type: 'moreThan' }) }));
  });

  it('consumes an exact neutral Cloud account source and removes its class after tenant switch', async () => {
    const session = await authSessionService.issue(user, {
      sessionClass: 'cloud_account',
      authenticationMethod: 'oidc',
      identityProviderId: provider.id,
      identityProviderUpdatedAt: provider.updatedAt,
      identityProviderProtocol: 'oidc',
      identityProviderAuthenticationMode: 'direct',
      identityProviderDirectoryTenantId: null,
      identityProviderConfigurationJson: '{}',
      federationSession: { subjectId: 'subject-a', sessionId: 'provider-session-a' },
    });
    const sourceRow = insert.mock.calls[0]![0];
    expect(sourceRow).toMatchObject({ tenantId: null, identityProviderId: provider.id });
    expect(JSON.parse(sourceRow.deviceInfo)).toMatchObject({ sessionClass: 'cloud_account' });
    findSession.mockResolvedValue(sourceRow);
    insert.mockClear();
    claimProvider.mockClear();

    const child = await authSessionService.switchTenant(user, {
      principal: normalizeUserJwtPayload(verifyToken(session.accessToken)),
      refreshToken: session.refreshToken,
      tenantId: 'alpha',
      tenantSlug: 'alpha',
    });

    expect(verifyToken(child.accessToken)).toMatchObject({ tenantId: 'alpha', tenantSlug: 'alpha' });
    expect(verifyToken(child.accessToken).sessionClass).toBeUndefined();
    expect(verifyToken(child.refreshToken).sessionClass).toBeUndefined();
    expect(JSON.parse(insert.mock.calls[0]![0].deviceInfo)).not.toHaveProperty('sessionClass');
    expect(findSession).toHaveBeenCalledWith(expect.objectContaining({
      id: sourceRow.id, tenantId: expect.objectContaining({ _type: 'isNull' }),
    }));
  });

  it('also claims the source for a same-tenant switch', async () => {
    const { input } = await sourceSession();
    await authSessionService.switchTenant(user, { ...input, tenantId: 'alpha', tenantSlug: 'alpha' });
    expect(claimSession).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledOnce();
    expect(insert.mock.calls[0]![0].identityProviderId).toBeNull();
  });

  it.each([
    ['session', { sessionId: '00000000-0000-0000-0000-000000000001' }],
    ['user', { userId: 'other', principalId: 'other' }],
    ['tenant', { tenantId: 'other' }], ['tenant slug', { tenantSlug: 'other' }],
    ['version', { authSessionVersion: 4 }], ['method', { authenticationMethod: 'saml' }],
    ['MFA', { mfaVerified: false }], ['recovery', { recovery: 'platform_administrator' }],
    ['session class', { sessionClass: 'cloud_account' }],
    ['token type', { type: 'refresh' }],
  ])('rejects an access/refresh %s mismatch before reading a source row', async (_label, mismatch) => {
    const { input } = await sourceSession();
    await expect(authSessionService.switchTenant(user, { ...input, principal: { ...input.principal, ...mismatch } as any })).rejects.toThrow('current source session');
    expect(findSession).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled();
  });

  it('requires reauthentication for legacy tokens without exact session identity', async () => {
    const options = { tenantId: 'alpha', tenantSlug: 'alpha' };
    await expect(authSessionService.switchTenant(user, {
      principal: normalizeUserJwtPayload(verifyToken(generateAccessToken(user, options))),
      refreshToken: generateRefreshToken(user, options), tenantId: 'beta', tenantSlug: 'beta',
    })).rejects.toThrow('current source session');
    expect(findSession).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled();
  });

  it.each([undefined, 'not-a-jwt', 'x'.repeat(16_385)])('rejects absent or malformed refresh credentials', async (refreshToken) => {
    const { input } = await sourceSession();
    await expect(authSessionService.switchTenant(user, { ...input, refreshToken })).rejects.toThrow('current source session');
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects a source not found by the active exact-session predicate', async () => {
    const { input } = await sourceSession(); findSession.mockResolvedValue(null);
    await expect(authSessionService.switchTenant(user, input)).rejects.toThrow('current source session');
    expect(insert).not.toHaveBeenCalled();
  });

  it.each(['provider', 'source'] as const)('rejects a lost %s claim without inserting a child', async (claim) => {
    const { input } = await sourceSession('oidc');
    (claim === 'provider' ? claimProvider : claimSession).mockResolvedValue({ affected: 0 });
    await expect(authSessionService.switchTenant(user, input)).rejects.toThrow(claim === 'provider' ? 'provider changed' : 'no longer active');
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects a provider disabled before derivation', async () => {
    const { input } = await sourceSession('oidc'); findProvider.mockResolvedValue(null);
    await expect(authSessionService.switchTenant(user, input)).rejects.toThrow('current source session');
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects missing federated lineage rather than converting it to a local session', async () => {
    const { row, input } = await sourceSession('oidc');
    findSession.mockResolvedValue({ ...row, identityProviderId: null });
    await expect(authSessionService.switchTenant(user, input)).rejects.toThrow('current source session');
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects source expiry while waiting for the conditional claim', async () => {
    const { row, input } = await sourceSession();
    claimSession.mockImplementation(async () => { vi.spyOn(Date, 'now').mockReturnValue(row.expiresAt + 1); return { affected: 1 }; });
    await expect(authSessionService.switchTenant(user, input)).rejects.toThrow('no longer active');
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects a freshly loaded user with a newer revocation version', async () => {
    const { input } = await sourceSession();
    await expect(authSessionService.switchTenant({ ...user, authSessionVersion: 4 }, input)).rejects.toThrow('current source session');
    expect(insert).not.toHaveBeenCalled();
  });

  it('binds both signed tokens to the persisted row and distinguishes logins in the same second', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const user = { id: 'same-user', email: 'same@example.test', authSessionVersion: 3 };
    const input = { tenantId: 'alpha', tenantSlug: 'alpha', authenticationMethod: 'local' as const };
    const first = await authSessionService.issue(user, input);
    const second = await authSessionService.issue(user, input);
    const firstRow = insert.mock.calls[0]![0];
    const secondRow = insert.mock.calls[1]![0];
    expect(firstRow.id).not.toBe(secondRow.id);
    expect(verifyToken(first.accessToken)).toMatchObject({ sessionId: firstRow.id, principalId: user.id, type: 'access' });
    expect(verifyToken(first.refreshToken)).toMatchObject({ sessionId: firstRow.id, principalId: user.id, type: 'refresh' });
    expect(verifyToken(second.refreshToken)).toMatchObject({ sessionId: secondRow.id });
    expect(first.refreshToken).not.toBe(second.refreshToken);
  });
});
