import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { authSessionService } from '@enterpriseglue/shared/services/AuthSessionService.js';
import { generateAccessToken, generateRefreshToken } from '@enterpriseglue/shared/utils/jwt.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/utils/jwt.js', () => ({ generateAccessToken: vi.fn(() => 'access-token'), generateRefreshToken: vi.fn(() => 'refresh-token') }));
vi.mock('@enterpriseglue/shared/utils/id.js', () => ({ generateId: vi.fn(() => 'session-1') }));
describe('authSessionService', () => {
  const providerTrust = {
    identityProviderUpdatedAt: 1234,
    identityProviderProtocol: 'oidc' as const,
    identityProviderAuthenticationMode: 'direct' as const,
    identityProviderDirectoryTenantId: null,
    identityProviderConfigurationJson: '{"issuerUrl":"https://idp.example.test"}',
  };
  const insert = vi.fn();
  const providerUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    insert.mockResolvedValue(undefined);
    providerUpdate.mockResolvedValue({ affected: 1 });
    const manager = { getRepository: (entity: unknown) => {
      if (entity === RefreshToken) return { insert };
      if (entity === IdentityProvider) return { update: providerUpdate };
      throw new Error('Unexpected repository');
    }};
    (getDataSource as any).mockResolvedValue({ ...manager, transaction: async (work: (store: typeof manager) => unknown) => work(manager) });
  });

  it('persists provider lineage for a renewable provider-neutral session', async () => {
    await expect(authSessionService.issue({ id: 'user-1', email: 'person@example.test' }, {
      identityProviderId: 'provider-1', ...providerTrust, userAgent: 'test-agent', ipAddress: '127.0.0.1',
      authenticationMethod: 'oidc', mfaVerified: true,
      federationSession: { subjectId: 'subject-1', sessionId: 'sid-1' },
    })).resolves.toEqual(expect.objectContaining({ accessToken: 'access-token', refreshToken: 'refresh-token' }));

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'session-1', userId: 'user-1', identityProviderId: 'provider-1', revokedAt: null,
      providerSubjectId: 'subject-1', providerSessionId: 'sid-1', providerNameIdFormat: null,
      deviceInfo: JSON.stringify({ userAgent: 'test-agent', ip: '127.0.0.1', authenticationMethod: 'oidc', mfaVerified: true, federationSession: { subjectId: 'subject-1', sessionId: 'sid-1', nameIdFormat: null } }),
    }));
    expect(providerUpdate).toHaveBeenCalledWith(expect.objectContaining({
      id: 'provider-1', updatedAt: 1234, protocol: 'oidc', configurationJson: providerTrust.identityProviderConfigurationJson,
    }), { isEnabled: true });
  });

  it('keeps local sessions unscoped when no provider lineage is supplied', async () => {
    await authSessionService.issue({ id: 'user-1', email: 'person@example.test' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ identityProviderId: null }));
  });

  it('preserves the current session version in newly issued provider sessions', async () => {
    const user = { id: 'user-1', email: 'person@example.test', authSessionVersion: 7 };

    await authSessionService.issue(user, { identityProviderId: 'provider-1', ...providerTrust });

    expect(generateAccessToken).toHaveBeenCalledWith(user, { administratorRecovery: false, authenticationMethod: undefined, mfaVerified: false });
    expect(generateRefreshToken).toHaveBeenCalledWith(user, { administratorRecovery: false, authenticationMethod: undefined, mfaVerified: false });
  });

  it('marks administrator-recovery access, refresh, and durable session metadata', async () => {
    const user = { id: 'user-1', email: 'person@example.test', authSessionVersion: 7 };

    await authSessionService.issue(user, { administratorRecovery: true, authenticationMethod: 'recovery', userAgent: 'recovery-agent' });

    expect(generateAccessToken).toHaveBeenCalledWith(user, { administratorRecovery: true, authenticationMethod: 'recovery', mfaVerified: false });
    expect(generateRefreshToken).toHaveBeenCalledWith(user, { administratorRecovery: true, authenticationMethod: 'recovery', mfaVerified: false });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      deviceInfo: JSON.stringify({ userAgent: 'recovery-agent', ip: null, recovery: 'platform_administrator', authenticationMethod: 'recovery' }),
    }));
  });

  it('does not issue a provider session after that provider has been disabled', async () => {
    providerUpdate.mockResolvedValueOnce({ affected: 0 });

    await expect(authSessionService.issue({ id: 'user-1', email: 'person@example.test' }, {
      identityProviderId: 'provider-1', ...providerTrust,
    })).rejects.toThrow('changed while sign-in was in progress');

    expect(insert).not.toHaveBeenCalled();
  });

  it('requires and claims the exact provider generation before inserting a refresh session', async () => {
    await expect(authSessionService.issue({ id: 'user-1', email: 'person@example.test' }, {
      identityProviderId: 'provider-1',
    })).rejects.toThrow('changed while sign-in was in progress');
    expect(providerUpdate).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});
