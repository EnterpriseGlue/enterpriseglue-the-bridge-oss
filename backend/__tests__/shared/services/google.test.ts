import { beforeEach, describe, it, expect, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { isGoogleAuthEnabled, provisionGoogleUser } from '@enterpriseglue/shared/services/google.js';
import { authzGroupService } from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';

const normalizedIdentityService = vi.hoisted(() => ({ upsertIdentityWithManager: vi.fn() }));
const syncDiagnosticsService = vi.hoisted(() => ({ startRun: vi.fn(), completeRun: vi.fn(), failRun: vi.fn() }));
const claimsMappingService = vi.hoisted(() => ({ resolveRoleFromClaims: vi.fn() }));
const externalIdentityService = vi.hoisted(() => ({ getActiveLinkedUserIdWithManager: vi.fn(), upsertWithManager: vi.fn() }));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/platform-admin/ExternalIdentityService.js', () => ({ externalIdentityService }));

vi.mock('@enterpriseglue/shared/services/platform-admin/SsoProviderService.js', () => ({
  ssoProviderService: {
    getProviderByType: vi.fn().mockResolvedValue(null),
  },
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
});
