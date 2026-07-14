import { beforeEach, describe, it, expect, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { isGoogleAuthEnabled, provisionGoogleUser } from '@enterpriseglue/shared/services/google.js';
import { authzGroupService } from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';

const normalizedIdentityService = vi.hoisted(() => ({ upsertIdentityWithManager: vi.fn() }));
const syncDiagnosticsService = vi.hoisted(() => ({ startRun: vi.fn(), completeRun: vi.fn(), failRun: vi.fn() }));
const claimsMappingService = vi.hoisted(() => ({ resolveRoleFromClaims: vi.fn() }));
const externalIdentityService = vi.hoisted(() => ({ getActiveLinkedUserIdWithManager: vi.fn(), upsertWithManager: vi.fn() }));
const legacyProviderService = vi.hoisted(() => ({ getProviderByType: vi.fn(), getProviderWithSecrets: vi.fn() }));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/platform-admin/ExternalIdentityService.js', () => ({ externalIdentityService }));

vi.mock('@enterpriseglue/shared/services/platform-admin/SsoProviderService.js', () => ({
  ssoProviderService: legacyProviderService,
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoNormalizedIdentityService.js', () => ({ ssoNormalizedIdentityService: normalizedIdentityService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoSyncDiagnosticsService.js', () => ({ ssoSyncDiagnosticsService: syncDiagnosticsService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoClaimsMappingService.js', () => ({ ssoClaimsMappingService: claimsMappingService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js', () => ({
  authzGroupService: {
    ensureAuthenticatedUserMembershipWithManager: vi.fn().mockResolvedValue({ id: 'baseline-1', created: true }),
    ensureLegacyPlatformAdministratorMembershipWithManager: vi.fn().mockResolvedValue({ id: 'admin-1', created: true }),
    removeLegacyPlatformAdministratorMembershipWithManager: vi.fn().mockResolvedValue({ removed: false }),
    syncLegacySsoPlatformAdministratorMembershipWithManager: vi.fn().mockResolvedValue({ created: false, removed: false }),
  },
}));

vi.mock('@enterpriseglue/shared/config/index.js', () => ({
  shouldUseSecureCookies: () => false,
  config: {
    googleClientId: null,
    googleClientSecret: null,
    googleRedirectUri: null,
  },
}));

describe('google service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    legacyProviderService.getProviderByType.mockResolvedValue(null);
    legacyProviderService.getProviderWithSecrets.mockResolvedValue(null);
    claimsMappingService.resolveRoleFromClaims.mockResolvedValue('user');
    normalizedIdentityService.upsertIdentityWithManager.mockResolvedValue({ id: 'normalized-1', created: true, groupMembershipsCreated: 2, groupMembershipsRemoved: 1 });
    syncDiagnosticsService.startRun.mockResolvedValue('sync-run-1');
    syncDiagnosticsService.completeRun.mockResolvedValue(undefined);
    syncDiagnosticsService.failRun.mockResolvedValue(undefined);
    externalIdentityService.getActiveLinkedUserIdWithManager.mockResolvedValue(null);
    externalIdentityService.upsertWithManager.mockResolvedValue({ id: 'external-identity-1', created: true });
  });

  it('returns false when Google auth not configured', async () => {
    const result = await isGoogleAuthEnabled();
    expect(result).toBe(false);
  });

  it('accepts only an enabled selected Google provider with its own credentials', async () => {
    legacyProviderService.getProviderWithSecrets.mockResolvedValue({
      id: 'legacy-google-1', type: 'google', enabled: true, clientId: 'client-1', clientSecretEnc: 'secret-1', callbackUrl: 'https://app.example.test/api/auth/google/callback',
    });

    await expect(isGoogleAuthEnabled('legacy-google-1')).resolves.toBe(true);
    expect(legacyProviderService.getProviderWithSecrets).toHaveBeenCalledWith('legacy-google-1');

    legacyProviderService.getProviderWithSecrets.mockResolvedValue({
      id: 'legacy-microsoft-1', type: 'microsoft', enabled: true, clientId: 'client-1', clientSecretEnc: 'secret-1', callbackUrl: null,
    });
    await expect(isGoogleAuthEnabled('legacy-microsoft-1')).resolves.toBe(false);
  });

  it('writes the normalized Google identity and provider-neutral memberships within user provisioning', async () => {
    const user = { id: 'user-1', email: 'google-user@example.com', platformRole: 'user', firstName: null, lastName: null };
    const repository = {
      findOneBy: vi.fn().mockResolvedValueOnce(user),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const manager = { getRepository: vi.fn().mockReturnValue(repository) };
    (getDataSource as any).mockResolvedValue({ transaction: (callback: any) => callback(manager) });

    const result = await provisionGoogleUser({ sub: 'google-subject-1', email: 'google-user@example.com', email_verified: true, name: 'Google User', hd: 'example.com' });

    expect(result).toEqual(expect.objectContaining({ id: 'user-1', email: 'google-user@example.com' }));
    expect(normalizedIdentityService.upsertIdentityWithManager).toHaveBeenCalledWith(manager, expect.objectContaining({ providerId: 'google', providerSubject: 'google-subject-1', providerTenantId: 'example.com', userId: 'user-1' }));
    expect(authzGroupService.ensureAuthenticatedUserMembershipWithManager).toHaveBeenCalledWith(manager, 'user-1');
    expect(authzGroupService.syncLegacySsoPlatformAdministratorMembershipWithManager).toHaveBeenCalledWith(manager, 'user-1', 'google', 'user');
    expect(authzGroupService.removeLegacyPlatformAdministratorMembershipWithManager).not.toHaveBeenCalled();
    expect(authzGroupService.ensureLegacyPlatformAdministratorMembershipWithManager).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith(
      { id: 'user-1' },
      expect.not.objectContaining({ platformRole: expect.anything() })
    );
    expect(externalIdentityService.upsertWithManager).toHaveBeenCalledWith(manager, expect.objectContaining({
      providerId: 'legacy:google', providerType: 'google', subjectId: 'google-subject-1', userId: 'user-1',
    }));
    expect(syncDiagnosticsService.completeRun).toHaveBeenCalledWith('sync-run-1', expect.objectContaining({ groupMembershipsCreated: 3, groupMembershipsRemoved: 1 }));
  });

  it('keeps selected legacy Google provider lineage through account linking and reconciliation', async () => {
    const user = { id: 'user-1', email: 'google-user@example.com', platformRole: 'user', firstName: null, lastName: null };
    const repository = {
      findOneBy: vi.fn().mockResolvedValueOnce(user),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const manager = { getRepository: vi.fn().mockReturnValue(repository) };
    (getDataSource as any).mockResolvedValue({ transaction: (callback: any) => callback(manager) });

    await provisionGoogleUser({ sub: 'google-subject-1', email: 'google-user@example.com', email_verified: true, hd: 'example.com' }, 'legacy-google-1');

    expect(claimsMappingService.resolveRoleFromClaims).toHaveBeenCalledWith(expect.any(Object), 'legacy-google-1');
    expect(externalIdentityService.getActiveLinkedUserIdWithManager).toHaveBeenCalledWith(manager, {
      providerId: 'legacy-google-1',
      subjectId: 'google-subject-1',
    });
    expect(externalIdentityService.upsertWithManager).toHaveBeenCalledWith(manager, expect.objectContaining({
      providerId: 'legacy-google-1', providerType: 'google', subjectId: 'google-subject-1', userId: 'user-1',
    }));
    expect(normalizedIdentityService.upsertIdentityWithManager).toHaveBeenCalledWith(manager, expect.objectContaining({
      providerId: 'legacy-google-1', providerSubject: 'google-subject-1',
    }));
    expect(authzGroupService.syncLegacySsoPlatformAdministratorMembershipWithManager).toHaveBeenCalledWith(
      manager, 'user-1', 'legacy-google-1', 'user',
    );
    expect(syncDiagnosticsService.completeRun).toHaveBeenCalledWith('sync-run-1', expect.objectContaining({ providerId: 'legacy-google-1' }));
  });

  it('requires both a verified Google email and a verified standalone account before email linking', async () => {
    const repository = { findOneBy: vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'local-user', email: 'person@example.test', authProvider: 'local', isEmailVerified: true }), update: vi.fn(), insert: vi.fn() };
    const manager = { getRepository: vi.fn().mockReturnValue(repository) };
    (getDataSource as any).mockResolvedValue({ transaction: (callback: any) => callback(manager) });

    await expect(provisionGoogleUser({ sub: 'google-new', email: 'person@example.test', email_verified: false }))
      .rejects.toThrow('Verified local email is required');
    expect(externalIdentityService.upsertWithManager).not.toHaveBeenCalled();
  });
});
