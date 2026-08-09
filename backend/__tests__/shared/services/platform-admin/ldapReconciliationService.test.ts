import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ldapReconciliationService } from '@enterpriseglue/shared/services/platform-admin/LdapReconciliationService.js';

const mocks = vi.hoisted(() => ({
  getByKey: vi.fn(),
  listDirectoryPage: vi.fn(),
  provision: vi.fn(),
  acquire: vi.fn(), renew: vi.fn(), completeCheckpoint: vi.fn(), release: vi.fn(),
  startRun: vi.fn(), completeRun: vi.fn(), failRun: vi.fn(),
  deactivateMissing: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js', () => ({ identityProviderService: { getByKey: mocks.getByKey } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/DirectLdapIdentityService.js', () => ({ directLdapIdentityService: { listDirectoryPage: mocks.listDirectoryPage } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityProviderProvisioningService.js', () => ({ identityProviderProvisioningService: { provisionLdapUserForReconciliation: mocks.provision } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityReconciliationCheckpointService.js', () => ({ identityReconciliationCheckpointService: { acquire: mocks.acquire, renew: mocks.renew, complete: mocks.completeCheckpoint, release: mocks.release } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoSyncDiagnosticsService.js', () => ({ ssoSyncDiagnosticsService: { startRun: mocks.startRun, completeRun: mocks.completeRun, failRun: mocks.failRun } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoNormalizedIdentityService.js', () => ({ ssoNormalizedIdentityService: { deactivateMissingProviderIdentities: mocks.deactivateMissing } }));

const provider = {
  id: 'provider-ldap', key: 'identity.ldap.main', protocol: 'ldap', isEnabled: true,
  updatedAt: 1234,
  authenticationMode: 'direct', directoryTenantId: null, configurationJson: '{"url":"ldaps://directory.example.test"}',
  syncJson: JSON.stringify({ connectorCapability: 'ldap_directory', scheduled: true, intervalSeconds: 60 }),
};

describe('ldapReconciliationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getByKey.mockResolvedValue(provider);
    mocks.acquire.mockResolvedValue({ leaseId: 'lease-1', cursor: null });
    mocks.renew.mockResolvedValue(true);
    mocks.completeCheckpoint.mockResolvedValue(true);
    mocks.startRun.mockResolvedValue('run-1');
    mocks.provision.mockResolvedValue({ groupMembershipsCreated: 1, groupMembershipsRemoved: 0 });
    mocks.deactivateMissing.mockResolvedValue({ identitiesDeactivated: 1, providerManagedMembershipsRemoved: 2, providerRefreshSessionsRevoked: 1, providerUserSessionsInvalidated: 1 });
  });

  it('sweeps missing LDAP subjects only after one complete authoritative snapshot', async () => {
    mocks.listDirectoryPage.mockResolvedValue({ identities: [
      { subjectId: 'subject-1', email: 'one@example.test', displayName: null, firstName: null, lastName: null, groups: ['operators'] },
      { subjectId: 'subject-2', email: 'two@example.test', displayName: null, firstName: null, lastName: null, groups: [] },
    ], nextCursor: null });

    await expect(ldapReconciliationService.reconcileProvider(provider.key, 'tenant-a', 'manual')).resolves.toEqual({ processed: 2, runId: 'run-1' });
    expect(mocks.provision).toHaveBeenNthCalledWith(1, provider, expect.objectContaining({ subjectId: 'subject-1' }), { providerId: provider.id, leaseId: 'lease-1' });
    expect(mocks.provision).toHaveBeenNthCalledWith(2, provider, expect.objectContaining({ subjectId: 'subject-2' }), { providerId: provider.id, leaseId: 'lease-1' });
    expect(mocks.deactivateMissing).toHaveBeenCalledWith({
      tenantId: 'tenant-a', providerId: provider.id, seenProviderSubjects: ['subject-1', 'subject-2'],
      leaseId: 'lease-1', providerUpdatedAt: 1234, cursor: null,
      providerProtocol: 'ldap', providerAuthenticationMode: 'direct', providerDirectoryTenantId: null,
      providerConfigurationJson: provider.configurationJson,
    });
    expect(mocks.completeCheckpoint).not.toHaveBeenCalled();
    expect(mocks.completeRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
      groupMembershipsCreated: 2,
      groupMembershipsRemoved: 2,
      details: expect.objectContaining({ identitiesDeactivated: 1, providerUserSessionsInvalidated: 1 }),
    }));
  });

  it('does not remove absent identities when directory enumeration fails', async () => {
    mocks.listDirectoryPage.mockRejectedValue(new Error('LDAP enumeration safety budget exceeded'));

    await expect(ldapReconciliationService.reconcileProvider(provider.key, 'tenant-a', 'manual')).rejects.toThrow('safety budget');
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.deactivateMissing).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledWith(provider.id, 'lease-1');
    expect(mocks.failRun).toHaveBeenCalled();
  });

  it('does not sweep absent identities from an incomplete page', async () => {
    mocks.listDirectoryPage.mockResolvedValue({ identities: [], nextCursor: 'more' });

    await expect(ldapReconciliationService.reconcileProvider(provider.key, 'tenant-a', 'manual')).rejects.toThrow('incomplete directory snapshot');
    expect(mocks.deactivateMissing).not.toHaveBeenCalled();
    expect(mocks.completeCheckpoint).not.toHaveBeenCalled();
  });

  it('stops before absence removal when the reconciliation lease is lost', async () => {
    mocks.listDirectoryPage.mockResolvedValue({ identities: [], nextCursor: null });
    mocks.renew.mockResolvedValue(false);

    await expect(ldapReconciliationService.reconcileProvider(provider.key, 'tenant-a', 'manual')).rejects.toThrow('lease was lost');

    expect(mocks.deactivateMissing).not.toHaveBeenCalled();
    expect(mocks.completeCheckpoint).not.toHaveBeenCalled();
    expect(mocks.failRun).toHaveBeenCalled();
  });

  it('stops the stale scheduled worker when its per-identity lease fence is superseded', async () => {
    mocks.listDirectoryPage.mockResolvedValue({ identities: [
      { subjectId: 'subject-1', email: 'one@example.test', displayName: null, firstName: null, lastName: null, groups: ['operators'] },
    ], nextCursor: null });
    mocks.provision.mockRejectedValueOnce(new Error('LDAP reconciliation lease was lost before identity provisioning'));

    await expect(ldapReconciliationService.reconcileProvider(provider.key, 'tenant-a', 'scheduled')).rejects.toThrow('lease was lost');

    expect(mocks.deactivateMissing).not.toHaveBeenCalled();
    expect(mocks.completeRun).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledWith(provider.id, 'lease-1');
    expect(mocks.failRun).toHaveBeenCalled();
  });
});
