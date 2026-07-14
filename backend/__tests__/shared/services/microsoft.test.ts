import { beforeEach, describe, it, expect, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { isMicrosoftAuthEnabled, provisionMicrosoftUser } from '@enterpriseglue/shared/services/microsoft.js';
import { ssoClaimsMappingService } from '@enterpriseglue/shared/services/platform-admin/SsoClaimsMappingService.js';
import { ssoAssignmentMappingService } from '@enterpriseglue/shared/services/platform-admin/SsoAssignmentMappingService.js';
import { ssoGroupMappingService } from '@enterpriseglue/shared/services/platform-admin/SsoGroupMappingService.js';
import { ssoNormalizedIdentityService } from '@enterpriseglue/shared/services/platform-admin/SsoNormalizedIdentityService.js';
import { ssoSyncDiagnosticsService } from '@enterpriseglue/shared/services/platform-admin/SsoSyncDiagnosticsService.js';
import { authzGroupService } from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';

const externalIdentityService = vi.hoisted(() => ({ getActiveLinkedUserIdWithManager: vi.fn(), upsertWithManager: vi.fn() }));

vi.mock('@enterpriseglue/shared/config/index.js', () => ({
  shouldUseSecureCookies: () => false,
  config: {
    microsoftClientId: null,
    microsoftClientSecret: null,
    microsoftTenantId: null,
    microsoftRedirectUri: null,
  },
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ExternalIdentityService.js', () => ({ externalIdentityService }));

vi.mock('@enterpriseglue/shared/services/platform-admin/SsoClaimsMappingService.js', () => ({
  ssoClaimsMappingService: {
    resolveRoleFromClaims: vi.fn(),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js', () => ({
  authzGroupService: {
    ensureAuthenticatedUserMembershipWithManager: vi.fn().mockResolvedValue({ id: 'baseline-1', created: true }),
    ensureLegacyPlatformAdministratorMembershipWithManager: vi.fn().mockResolvedValue({ id: 'admin-1', created: true }),
    removeLegacyPlatformAdministratorMembershipWithManager: vi.fn().mockResolvedValue({ removed: false }),
    syncLegacySsoPlatformAdministratorMembershipWithManager: vi.fn().mockResolvedValue({ created: false, removed: false }),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/SsoAssignmentMappingService.js', () => ({
  ssoAssignmentMappingService: {
    syncAssignmentsForUser: vi.fn().mockResolvedValue({ created: 0, updated: 0, removed: 0 }),
    syncAssignmentsForUserWithManager: vi.fn().mockResolvedValue({ created: 1, updated: 0, removed: 0 }),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/SsoGroupMappingService.js', () => ({
  ssoGroupMappingService: {
    syncMembershipsForUser: vi.fn().mockResolvedValue({ created: 0, updated: 0, removed: 0 }),
    syncMembershipsForUserWithManager: vi.fn().mockResolvedValue({ created: 1, updated: 0, removed: 0 }),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/SsoNormalizedIdentityService.js', () => ({
  ssoNormalizedIdentityService: {
    upsertIdentityWithManager: vi.fn().mockResolvedValue({ id: 'identity-1', created: true, groupMembershipsCreated: 2, groupMembershipsRemoved: 1 }),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/SsoSyncDiagnosticsService.js', () => ({
  ssoSyncDiagnosticsService: {
    startRun: vi.fn().mockResolvedValue('sync-run-1'),
    completeRun: vi.fn().mockResolvedValue(undefined),
    failRun: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('microsoft service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    externalIdentityService.getActiveLinkedUserIdWithManager.mockResolvedValue(null);
    externalIdentityService.upsertWithManager.mockResolvedValue({ id: 'external-identity-1', created: true });
  });

  it('returns false when Microsoft auth not configured', () => {
    const result = isMicrosoftAuthEnabled();
    expect(result).toBe(false);
  });

  it('syncs SSO group memberships before engine assignments when provisioning a new user', async () => {
    const userRepo = {
      findOneBy: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'user-1', email: 'sso-user@example.com', authProvider: 'microsoft', platformRole: 'user' }),
      update: vi.fn(),
      insert: vi.fn().mockResolvedValue(undefined),
    };
    const manager = {
      getRepository: vi.fn().mockReturnValue(userRepo),
    };
    const dataSource = {
      transaction: vi.fn(async (callback: (managerArg: typeof manager) => Promise<unknown>) => callback(manager)),
    };

    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);
    (ssoClaimsMappingService.resolveRoleFromClaims as unknown as Mock).mockResolvedValue('admin');

    const result = await provisionMicrosoftUser({
      oid: 'oid-123',
      email: 'sso-user@example.com',
      given_name: 'Sso',
      family_name: 'User',
      tid: 'microsoft-tenant',
      groups: ['engines-prod'],
      roles: ['deployer'],
    });

    expect(ssoSyncDiagnosticsService.startRun).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'microsoft',
      trigger: 'login',
      details: expect.objectContaining({ email: 'sso-user@example.com' }),
    }));
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(userRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ platformRole: 'user' }));
    expect(userRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ entraId: null, entraEmail: null }));
    expect(externalIdentityService.upsertWithManager).toHaveBeenCalledWith(manager, expect.objectContaining({
      providerId: 'legacy:microsoft', providerType: 'microsoft', subjectId: 'oid-123',
      directoryTenantId: 'microsoft-tenant', emailHint: 'sso-user@example.com',
    }));
    expect(result).toEqual(expect.objectContaining({ id: 'user-1', platformRole: 'user' }));
    expect(authzGroupService.syncLegacySsoPlatformAdministratorMembershipWithManager).toHaveBeenCalledWith(
      manager,
      expect.any(String),
      'microsoft',
      'admin'
    );
    expect(ssoNormalizedIdentityService.upsertIdentityWithManager).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        providerId: 'microsoft',
        providerType: 'microsoft',
        providerSubject: 'oid-123',
        subjectClaim: 'oid',
        providerTenantId: 'microsoft-tenant',
        userId: expect.any(String),
        email: 'sso-user@example.com',
        firstName: 'Sso',
        lastName: 'User',
        claims: expect.objectContaining({
          groups: ['engines-prod'],
          roles: ['deployer'],
        }),
      })
    );
    expect(ssoGroupMappingService.syncMembershipsForUserWithManager).toHaveBeenCalledWith(
      manager,
      expect.any(String),
      expect.objectContaining({
        email: 'sso-user@example.com',
        groups: ['engines-prod'],
        roles: ['deployer'],
      }),
      'microsoft',
    );
    expect(ssoAssignmentMappingService.syncAssignmentsForUserWithManager).toHaveBeenCalledWith(
      manager,
      expect.any(String),
      expect.objectContaining({
        email: 'sso-user@example.com',
        groups: ['engines-prod'],
        roles: ['deployer'],
      }),
      'microsoft',
    );
    expect(authzGroupService.ensureAuthenticatedUserMembershipWithManager).toHaveBeenCalledWith(manager, expect.any(String));
    expect(authzGroupService.syncLegacySsoPlatformAdministratorMembershipWithManager).toHaveBeenCalledWith(
      manager,
      expect.any(String),
      'microsoft',
      'admin'
    );
    expect(authzGroupService.removeLegacyPlatformAdministratorMembershipWithManager).not.toHaveBeenCalled();
    expect(authzGroupService.ensureLegacyPlatformAdministratorMembershipWithManager).not.toHaveBeenCalled();
    const snapshotOrder = (ssoNormalizedIdentityService.upsertIdentityWithManager as unknown as Mock).mock.invocationCallOrder[0];
    const groupSyncOrder = (ssoGroupMappingService.syncMembershipsForUserWithManager as unknown as Mock).mock.invocationCallOrder[0];
    const engineSyncOrder = (ssoAssignmentMappingService.syncAssignmentsForUserWithManager as unknown as Mock).mock.invocationCallOrder[0];
    expect(snapshotOrder).toBeLessThan(groupSyncOrder);
    expect(groupSyncOrder).toBeLessThan(engineSyncOrder);
    expect(ssoSyncDiagnosticsService.completeRun).toHaveBeenCalledWith('sync-run-1', expect.objectContaining({
      providerId: 'microsoft',
      groupMembershipsCreated: 4,
      groupMembershipsRemoved: 1,
      assignmentsCreated: 1,
      details: expect.objectContaining({ email: 'sso-user@example.com' }),
    }));
    expect(ssoSyncDiagnosticsService.failRun).not.toHaveBeenCalled();
  });

  it('prefers the provider-neutral link before consulting the retired Entra column', async () => {
    const linkedUser = { id: 'user-linked', email: 'before@example.test', authProvider: 'microsoft', firstName: null, lastName: null, platformRole: 'user' };
    const userRepo = { findOneBy: vi.fn().mockResolvedValue(linkedUser), update: vi.fn(), insert: vi.fn() };
    const manager = { getRepository: vi.fn().mockReturnValue(userRepo) };
    (getDataSource as unknown as Mock).mockResolvedValue({ transaction: (callback: any) => callback(manager) });
    (ssoClaimsMappingService.resolveRoleFromClaims as unknown as Mock).mockResolvedValue('user');
    externalIdentityService.getActiveLinkedUserIdWithManager.mockResolvedValue('user-linked');

    await provisionMicrosoftUser({ oid: 'oid-linked', email: 'person@example.test', tid: 'directory-1' });

    expect(userRepo.findOneBy).toHaveBeenCalledWith({ id: 'user-linked' });
    expect(userRepo.findOneBy).not.toHaveBeenCalledWith({ entraId: 'oid-linked' });
    expect(externalIdentityService.upsertWithManager).toHaveBeenCalledWith(manager, expect.objectContaining({
      providerId: 'legacy:microsoft', subjectId: 'oid-linked', userId: 'user-linked',
    }));
  });

  it('does not link an unverified standalone account by matching email', async () => {
    const userRepo = { findOneBy: vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'local-user', email: 'person@example.test', authProvider: 'local', isEmailVerified: false }), update: vi.fn(), insert: vi.fn() };
    const manager = { getRepository: vi.fn().mockReturnValue(userRepo) };
    (getDataSource as unknown as Mock).mockResolvedValue({ transaction: (callback: any) => callback(manager) });
    (ssoClaimsMappingService.resolveRoleFromClaims as unknown as Mock).mockResolvedValue('user');

    await expect(provisionMicrosoftUser({ oid: 'oid-new', email: 'person@example.test', tid: 'directory-1' }))
      .rejects.toThrow('Verified local email is required');
    expect(externalIdentityService.upsertWithManager).not.toHaveBeenCalled();
  });
});
