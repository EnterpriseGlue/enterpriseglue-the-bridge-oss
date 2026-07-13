import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { provisionSamlUser, type SamlUserInfo } from '@enterpriseglue/shared/services/saml.js';
import { ssoProviderService } from '@enterpriseglue/shared/services/platform-admin/SsoProviderService.js';
import { ssoClaimsMappingService } from '@enterpriseglue/shared/services/platform-admin/SsoClaimsMappingService.js';
import { ssoAssignmentMappingService } from '@enterpriseglue/shared/services/platform-admin/SsoAssignmentMappingService.js';
import { ssoGroupMappingService } from '@enterpriseglue/shared/services/platform-admin/SsoGroupMappingService.js';
import { ssoNormalizedIdentityService } from '@enterpriseglue/shared/services/platform-admin/SsoNormalizedIdentityService.js';
import { identityEntitlementMappingService } from '@enterpriseglue/shared/services/platform-admin/IdentityEntitlementMappingService.js';
import { ssoSyncDiagnosticsService } from '@enterpriseglue/shared/services/platform-admin/SsoSyncDiagnosticsService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

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
    upsertIdentityWithManager: vi.fn().mockResolvedValue({ id: 'identity-1', created: true }),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityEntitlementMappingService.js', () => ({
  identityEntitlementMappingService: {
    syncMembershipsInStore: vi.fn().mockResolvedValue({ created: 2, removed: 1 }),
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
      defaultRole: 'user',
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

    expect(ssoSyncDiagnosticsService.startRun).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      providerId: 'provider-saml-1',
      trigger: 'login',
      details: expect.objectContaining({ email: 'saml-user@example.com' }),
    }));
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(userRepo.update).toHaveBeenCalledWith(
      { id: 'user-1' },
      expect.objectContaining({ authProvider: 'saml', email: 'saml-user@example.com' })
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
    expect(identityEntitlementMappingService.syncMembershipsInStore).toHaveBeenCalledWith(
      manager,
      'user-1',
      'tenant-a',
      expect.objectContaining({ providerKey: 'provider-saml-1', providerType: 'saml', subjectId: 'oid-123', email: 'saml-user@example.com' }),
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
    const snapshotOrder = (ssoNormalizedIdentityService.upsertIdentityWithManager as unknown as Mock).mock.invocationCallOrder[0];
    const groupSyncOrder = (ssoGroupMappingService.syncMembershipsForUserWithManager as unknown as Mock).mock.invocationCallOrder[0];
    const engineSyncOrder = (ssoAssignmentMappingService.syncAssignmentsForUserWithManager as unknown as Mock).mock.invocationCallOrder[0];
    expect(snapshotOrder).toBeLessThan(groupSyncOrder);
    const identitySyncOrder = (identityEntitlementMappingService.syncMembershipsInStore as unknown as Mock).mock.invocationCallOrder[0];
    expect(snapshotOrder).toBeLessThan(identitySyncOrder);
    expect(identitySyncOrder).toBeLessThan(groupSyncOrder);
    expect(groupSyncOrder).toBeLessThan(engineSyncOrder);
    expect(ssoSyncDiagnosticsService.completeRun).toHaveBeenCalledWith('sync-run-1', expect.objectContaining({
      tenantId: 'tenant-a',
      providerId: 'provider-saml-1',
      userId: 'user-1',
      groupMembershipsCreated: 3,
      groupMembershipsRemoved: 1,
      assignmentsCreated: 1,
      details: expect.objectContaining({ email: 'saml-user@example.com' }),
    }));
    expect(ssoSyncDiagnosticsService.failRun).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ authProvider: 'saml' }));
  });
});
