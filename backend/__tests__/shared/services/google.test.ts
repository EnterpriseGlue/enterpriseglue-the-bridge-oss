import { beforeEach, describe, it, expect, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { isGoogleAuthEnabled, provisionGoogleUser } from '@enterpriseglue/shared/services/google.js';
import { authzGroupService } from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';

const normalizedIdentityService = vi.hoisted(() => ({ upsertIdentityWithManager: vi.fn() }));
const syncDiagnosticsService = vi.hoisted(() => ({ startRun: vi.fn(), completeRun: vi.fn(), failRun: vi.fn() }));
const claimsMappingService = vi.hoisted(() => ({ resolveRoleFromClaims: vi.fn() }));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

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
    expect(syncDiagnosticsService.completeRun).toHaveBeenCalledWith('sync-run-1', expect.objectContaining({ groupMembershipsCreated: 3, groupMembershipsRemoved: 1 }));
  });
});
