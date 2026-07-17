import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { provisionSamlUser, type SamlUserInfo } from '@enterpriseglue/shared/services/saml.js';
import { ssoProviderService } from '@enterpriseglue/shared/services/platform-admin/SsoProviderService.js';
import { ssoClaimsMappingService } from '@enterpriseglue/shared/services/platform-admin/SsoClaimsMappingService.js';
import { ssoAssignmentMappingService } from '@enterpriseglue/shared/services/platform-admin/SsoAssignmentMappingService.js';
import { ssoGroupMappingService } from '@enterpriseglue/shared/services/platform-admin/SsoGroupMappingService.js';
import { ssoNormalizedIdentityService } from '@enterpriseglue/shared/services/platform-admin/SsoNormalizedIdentityService.js';
import { ssoSyncDiagnosticsService } from '@enterpriseglue/shared/services/platform-admin/SsoSyncDiagnosticsService.js';
import { authzGroupService } from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';

const externalIdentityService = vi.hoisted(() => ({ getActiveLinkedUserIdWithManager: vi.fn(), upsertWithManager: vi.fn() }));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/ExternalIdentityService.js', () => ({ externalIdentityService }));

vi.mock('@enterpriseglue/shared/services/platform-admin/SsoProviderService.js', () => ({
  ssoProviderService: {
    getProvider: vi.fn(),
  },
}));

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

describe('saml service - provisionSamlUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    externalIdentityService.getActiveLinkedUserIdWithManager.mockResolvedValue(null);
    externalIdentityService.upsertWithManager.mockResolvedValue({ id: 'external-identity-1', created: true });
  });

  it('returns authProvider as saml when user exists by entraId', async () => {
    const existingUser = {
      id: 'user-1',
      email: 'old@example.com',
      authProvider: 'local',
      platformRole: 'user',
      firstName: 'Old',
      lastName: 'Name',
      entraId: 'oid-123',
      entraEmail: 'old@example.com',
    };

    const userRepo = {
      findOneBy: vi.fn().mockResolvedValue(existingUser),
      update: vi.fn().mockResolvedValue(undefined),
      insert: vi.fn(),
    };
    const manager = {
      getRepository: vi.fn().mockReturnValue(userRepo),
    };
    const dataSource = {
      transaction: vi.fn(async (callback: (managerArg: typeof manager) => Promise<unknown>) => callback(manager)),
    };

    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    (ssoProviderService.getProvider as unknown as Mock).mockResolvedValue({
      id: 'provider-saml-1',
      // A legacy administrator default must not affect login authorization.
      defaultRole: 'admin',
      tenantId: 'tenant-a',
    });

    (ssoClaimsMappingService.resolveRoleFromClaims as unknown as Mock).mockResolvedValue('user');

    const userInfo: SamlUserInfo = {
      email: 'saml-user@example.com',
      oid: 'oid-123',
      groups: ['eng'],
      roles: ['dev'],
      customClaims: {},
      given_name: 'Saml',
      family_name: 'User',
    };

    const result = await provisionSamlUser(userInfo, 'provider-saml-1');

    expect(ssoClaimsMappingService.resolveRoleFromClaims).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'saml-user@example.com' }),
      'provider-saml-1',
    );

    expect(ssoSyncDiagnosticsService.startRun).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      providerId: 'provider-saml-1',
      trigger: 'login',
      details: expect.objectContaining({ groupsCount: 1, rolesCount: 1 }),
    }));
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(externalIdentityService.upsertWithManager).toHaveBeenCalledWith(manager, expect.objectContaining({
      tenantId: 'tenant-a', providerId: 'provider-saml-1', providerType: 'saml', subjectId: 'oid-123', userId: 'user-1',
    }));
    expect(userRepo.update).toHaveBeenCalledWith(
      { id: 'user-1' },
      expect.objectContaining({ authProvider: 'saml', email: 'saml-user@example.com' })
    );
    expect(userRepo.update).toHaveBeenCalledWith(
      { id: 'user-1' },
      expect.not.objectContaining({ platformRole: expect.anything() })
    );
    expect(authzGroupService.syncLegacySsoPlatformAdministratorMembershipWithManager).toHaveBeenCalledWith(
      manager,
      'user-1',
      'provider-saml-1',
      'user'
    );
    expect(ssoNormalizedIdentityService.upsertIdentityWithManager).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        tenantId: 'tenant-a',
        providerId: 'provider-saml-1',
        providerType: 'saml',
        providerSubject: 'oid-123',
        subjectClaim: 'oid',
        userId: 'user-1',
        email: 'saml-user@example.com',
        firstName: 'Saml',
        lastName: 'User',
        claims: expect.objectContaining({
          groups: ['eng'],
          roles: ['dev'],
        }),
      })
    );
    expect(ssoGroupMappingService.syncMembershipsForUserWithManager).toHaveBeenCalledWith(
      manager,
      'user-1',
      expect.objectContaining({
        email: 'saml-user@example.com',
        groups: ['eng'],
        roles: ['dev'],
      }),
      'provider-saml-1',
      'tenant-a',
    );
    expect(ssoAssignmentMappingService.syncAssignmentsForUserWithManager).toHaveBeenCalledWith(
      manager,
      'user-1',
      expect.objectContaining({
        email: 'saml-user@example.com',
        groups: ['eng'],
        roles: ['dev'],
      }),
      'provider-saml-1',
      'tenant-a',
    );
    expect(authzGroupService.ensureAuthenticatedUserMembershipWithManager).toHaveBeenCalledWith(manager, 'user-1');
    expect(authzGroupService.syncLegacySsoPlatformAdministratorMembershipWithManager).toHaveBeenCalledWith(
      manager,
      'user-1',
      'provider-saml-1',
      'user'
    );
    expect(authzGroupService.removeLegacyPlatformAdministratorMembershipWithManager).not.toHaveBeenCalled();
    expect(authzGroupService.ensureLegacyPlatformAdministratorMembershipWithManager).not.toHaveBeenCalled();
    const snapshotOrder = (ssoNormalizedIdentityService.upsertIdentityWithManager as unknown as Mock).mock.invocationCallOrder[0];
    const groupSyncOrder = (ssoGroupMappingService.syncMembershipsForUserWithManager as unknown as Mock).mock.invocationCallOrder[0];
    const engineSyncOrder = (ssoAssignmentMappingService.syncAssignmentsForUserWithManager as unknown as Mock).mock.invocationCallOrder[0];
    expect(snapshotOrder).toBeLessThan(groupSyncOrder);
    expect(snapshotOrder).toBeLessThan(groupSyncOrder);
    expect(groupSyncOrder).toBeLessThan(engineSyncOrder);
    expect(ssoSyncDiagnosticsService.completeRun).toHaveBeenCalledWith('sync-run-1', expect.objectContaining({
      tenantId: 'tenant-a',
      providerId: 'provider-saml-1',
      userId: 'user-1',
      groupMembershipsCreated: 4,
      groupMembershipsRemoved: 1,
      assignmentsCreated: 1,
      details: {},
    }));
    expect(ssoSyncDiagnosticsService.failRun).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ authProvider: 'saml' }));
  });

  it('prefers an exact SAML provider link before the staged legacy namespace or Entra column', async () => {
    const userRepo = { findOneBy: vi.fn().mockResolvedValue({ id: 'user-linked', email: 'before@example.test', firstName: null, lastName: null, platformRole: 'user' }), update: vi.fn(), insert: vi.fn() };
    const manager = { getRepository: vi.fn().mockReturnValue(userRepo) };
    (getDataSource as unknown as Mock).mockResolvedValue({ transaction: (callback: any) => callback(manager) });
    (ssoProviderService.getProvider as unknown as Mock).mockResolvedValue({ id: 'provider-saml-1', defaultRole: 'user', tenantId: 'tenant-a' });
    (ssoClaimsMappingService.resolveRoleFromClaims as unknown as Mock).mockResolvedValue('user');
    externalIdentityService.getActiveLinkedUserIdWithManager.mockResolvedValue('user-linked');

    await provisionSamlUser({ email: 'person@example.test', oid: 'oid-linked', groups: [], roles: [], customClaims: {} }, 'provider-saml-1');

    expect(userRepo.findOneBy).toHaveBeenCalledWith({ id: 'user-linked' });
    expect(userRepo.findOneBy).not.toHaveBeenCalledWith({ entraId: 'oid-linked' });
    expect(externalIdentityService.upsertWithManager).toHaveBeenCalledWith(manager, expect.objectContaining({
      tenantId: 'tenant-a', providerId: 'provider-saml-1', subjectId: 'oid-linked', userId: 'user-linked',
    }));
  });

  it('does not link an unverified standalone account by matching a SAML email', async () => {
    const userRepo = { findOneBy: vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'local-user', email: 'person@example.test', authProvider: 'local', isEmailVerified: false }), update: vi.fn(), insert: vi.fn() };
    const manager = { getRepository: vi.fn().mockReturnValue(userRepo) };
    (getDataSource as unknown as Mock).mockResolvedValue({ transaction: (callback: any) => callback(manager) });
    (ssoProviderService.getProvider as unknown as Mock).mockResolvedValue({ id: 'provider-saml-1', defaultRole: 'user', tenantId: 'tenant-a' });
    (ssoClaimsMappingService.resolveRoleFromClaims as unknown as Mock).mockResolvedValue('user');

    await expect(provisionSamlUser({ email: 'person@example.test', oid: 'oid-new', groups: [], roles: [], customClaims: {} }, 'provider-saml-1'))
      .rejects.toThrow('Verified local email is required');
    expect(externalIdentityService.upsertWithManager).not.toHaveBeenCalled();
  });
});
