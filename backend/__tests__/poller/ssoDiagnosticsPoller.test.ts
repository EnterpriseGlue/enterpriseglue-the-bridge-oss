import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ssoSyncDiagnosticsService } from '@enterpriseglue/shared/services/platform-admin/SsoSyncDiagnosticsService.js';
import {
  runScheduledLdapReconciliationOnce,
  runScheduledSsoCleanupOnce,
  runScheduledSsoDiagnosticsOnce,
  runScheduledSsoProviderIdentityCheckOnce,
  runScheduledSsoSnapshotReplayOnce,
  startSsoDiagnosticsPollerIfEnabled,
  stopSsoDiagnosticsPoller,
} from '../../../packages/backend-host/src/poller/ssoDiagnosticsPoller.js';

const { listIdentityProviders, reconcileLdapProvider } = vi.hoisted(() => ({
  listIdentityProviders: vi.fn(),
  reconcileLdapProvider: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js', () => ({
  identityProviderService: { list: listIdentityProviders },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/LdapReconciliationService.js', () => ({
  ldapReconciliationService: { reconcileProvider: reconcileLdapProvider },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/SsoSyncDiagnosticsService.js', () => ({
  ssoSyncDiagnosticsService: {
    runReconciliationDiagnostics: vi.fn().mockResolvedValue({
      runId: 'sync-run-1',
      scannedGroupMappings: 0,
      scannedAssignmentMappings: 0,
      scannedGroupMemberships: 0,
      scannedAssignments: 0,
      warnings: 0,
      errors: 0,
    }),
    runReconciliationCleanup: vi.fn().mockResolvedValue({
      runId: 'cleanup-run-1',
      scannedGroupMemberships: 0,
      scannedAssignments: 0,
      groupMembershipsRemoved: 0,
      assignmentsRemoved: 0,
    }),
    runProviderIdentityCheck: vi.fn().mockResolvedValue({
      runId: 'provider-check-run-1',
      scannedIdentities: 0,
      checkedIdentities: 0,
      unsupportedIdentities: 0,
      activeIdentities: 0,
      inactiveIdentities: 0,
      deletedIdentities: 0,
      unknownIdentities: 0,
      failedIdentities: 0,
    }),
    runSnapshotReconciliation: vi.fn().mockResolvedValue({
      runId: 'snapshot-run-1',
      scannedIdentities: 0,
      replayedIdentities: 0,
      skippedIdentities: 0,
      failedIdentities: 0,
      groupMembershipsCreated: 0,
      groupMembershipsUpdated: 0,
      groupMembershipsRemoved: 0,
      assignmentsCreated: 0,
      assignmentsUpdated: 0,
      assignmentsRemoved: 0,
    }),
  },
}));

describe('ssoDiagnosticsPoller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ssoSyncDiagnosticsService.runReconciliationDiagnostics).mockResolvedValue({
      runId: 'sync-run-1',
      scannedGroupMappings: 0,
      scannedAssignmentMappings: 0,
      scannedGroupMemberships: 0,
      scannedAssignments: 0,
      warnings: 0,
      errors: 0,
    });
    vi.mocked(ssoSyncDiagnosticsService.runReconciliationCleanup).mockResolvedValue({
      runId: 'cleanup-run-1',
      scannedGroupMemberships: 0,
      scannedAssignments: 0,
      groupMembershipsRemoved: 0,
      assignmentsRemoved: 0,
    });
    vi.mocked(ssoSyncDiagnosticsService.runProviderIdentityCheck).mockResolvedValue({
      runId: 'provider-check-run-1',
      scannedIdentities: 0,
      checkedIdentities: 0,
      unsupportedIdentities: 0,
      activeIdentities: 0,
      inactiveIdentities: 0,
      deletedIdentities: 0,
      unknownIdentities: 0,
      failedIdentities: 0,
    });
    vi.mocked(ssoSyncDiagnosticsService.runSnapshotReconciliation).mockResolvedValue({
      runId: 'snapshot-run-1',
      scannedIdentities: 0,
      replayedIdentities: 0,
      skippedIdentities: 0,
      failedIdentities: 0,
      groupMembershipsCreated: 0,
      groupMembershipsUpdated: 0,
      groupMembershipsRemoved: 0,
      assignmentsCreated: 0,
      assignmentsUpdated: 0,
      assignmentsRemoved: 0,
    });
    listIdentityProviders.mockResolvedValue([]);
    reconcileLdapProvider.mockResolvedValue({ processed: 0 });
    vi.useFakeTimers();
    delete process.env.SSO_DIAGNOSTICS_INTERVAL_MS;
    delete process.env.SSO_DIAGNOSTICS_TENANT_IDS;
    delete process.env.SSO_DIAGNOSTICS_PROVIDER_IDS;
    delete process.env.SSO_DIAGNOSTICS_RUN_ON_START;
    delete process.env.SSO_DIAGNOSTICS_PROVIDER_CHECK_ENABLED;
    delete process.env.SSO_DIAGNOSTICS_REFRESH_CLAIMS_ENABLED;
    delete process.env.SSO_DIAGNOSTICS_REPLAY_SNAPSHOTS_ENABLED;
    delete process.env.SSO_DIAGNOSTICS_CLEANUP_ENABLED;
    stopSsoDiagnosticsPoller();
  });

  afterEach(() => {
    stopSsoDiagnosticsPoller();
    vi.useRealTimers();
  });

  it('does not start unless the interval is explicitly enabled', async () => {
    const timer = await startSsoDiagnosticsPollerIfEnabled();

    expect(timer).toBeNull();
    expect(ssoSyncDiagnosticsService.runReconciliationDiagnostics).not.toHaveBeenCalled();
  });

  it('runs scheduled diagnostics for configured tenant and provider scopes', async () => {
    await runScheduledSsoDiagnosticsOnce({
      tenantIds: [null, 'tenant-a'],
      providerIds: [null, 'microsoft'],
    });

    expect(ssoSyncDiagnosticsService.runReconciliationDiagnostics).toHaveBeenCalledTimes(4);
    expect(ssoSyncDiagnosticsService.runReconciliationDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: null,
      providerId: null,
      trigger: 'scheduled',
      details: expect.objectContaining({ source: 'sso_diagnostics_poller' }),
    }));
    expect(ssoSyncDiagnosticsService.runReconciliationDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      providerId: 'microsoft',
      trigger: 'scheduled',
    }));
    expect(ssoSyncDiagnosticsService.runReconciliationCleanup).not.toHaveBeenCalled();
    expect(ssoSyncDiagnosticsService.runProviderIdentityCheck).not.toHaveBeenCalled();
    expect(ssoSyncDiagnosticsService.runSnapshotReconciliation).not.toHaveBeenCalled();
  });

  it('runs scheduled cleanup only when explicitly requested', async () => {
    await runScheduledSsoCleanupOnce({
      tenantIds: ['tenant-a'],
      providerIds: ['microsoft'],
    });

    expect(ssoSyncDiagnosticsService.runReconciliationCleanup).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      providerId: 'microsoft',
      trigger: 'scheduled',
      details: expect.objectContaining({ source: 'sso_diagnostics_poller' }),
    }));
  });

  it('runs scheduled provider identity checks only when explicitly requested', async () => {
    await runScheduledSsoProviderIdentityCheckOnce({
      tenantIds: ['tenant-a'],
      providerIds: ['microsoft'],
    });

    expect(ssoSyncDiagnosticsService.runProviderIdentityCheck).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      providerId: 'microsoft',
      trigger: 'scheduled',
      details: expect.objectContaining({ source: 'sso_diagnostics_poller' }),
    }));
  });

  it('runs scheduled snapshot replay only when explicitly requested', async () => {
    await runScheduledSsoSnapshotReplayOnce({
      tenantIds: ['tenant-a'],
      providerIds: ['microsoft'],
    });

    expect(ssoSyncDiagnosticsService.runSnapshotReconciliation).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      providerId: 'microsoft',
      refreshProviderClaims: false,
      trigger: 'scheduled',
      details: expect.objectContaining({ source: 'sso_diagnostics_poller' }),
    }));
  });

  it('passes live claim refresh through scheduled snapshot replay only when requested', async () => {
    await runScheduledSsoSnapshotReplayOnce({
      tenantIds: ['tenant-a'],
      providerIds: ['microsoft'],
      refreshClaimsEnabled: true,
    });

    expect(ssoSyncDiagnosticsService.runSnapshotReconciliation).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      providerId: 'microsoft',
      refreshProviderClaims: true,
      trigger: 'scheduled',
    }));
  });

  it('starts from env config and skips overlapping ticks', async () => {
    process.env.SSO_DIAGNOSTICS_INTERVAL_MS = '1000';
    process.env.SSO_DIAGNOSTICS_TENANT_IDS = 'global,tenant-a';
    process.env.SSO_DIAGNOSTICS_PROVIDER_IDS = 'microsoft';
    let releaseScan!: () => void;
    vi.mocked(ssoSyncDiagnosticsService.runReconciliationDiagnostics).mockImplementation(() =>
      new Promise((resolve) => {
        releaseScan = () => resolve({
          runId: 'sync-run-1',
          scannedGroupMappings: 0,
          scannedAssignmentMappings: 0,
          scannedGroupMemberships: 0,
          scannedAssignments: 0,
          warnings: 0,
          errors: 0,
        });
      })
    );

    const timer = await startSsoDiagnosticsPollerIfEnabled();
    expect(timer).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ssoSyncDiagnosticsService.runReconciliationDiagnostics).toHaveBeenCalledTimes(1);

    releaseScan();
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(1000);
    expect(ssoSyncDiagnosticsService.runReconciliationDiagnostics).toHaveBeenCalledTimes(2);
    expect(ssoSyncDiagnosticsService.runReconciliationCleanup).not.toHaveBeenCalled();
    expect(ssoSyncDiagnosticsService.runProviderIdentityCheck).not.toHaveBeenCalled();
    expect(ssoSyncDiagnosticsService.runSnapshotReconciliation).not.toHaveBeenCalled();
  });

  it('runs cleanup after diagnostics when env cleanup is enabled', async () => {
    process.env.SSO_DIAGNOSTICS_INTERVAL_MS = '1000';
    process.env.SSO_DIAGNOSTICS_CLEANUP_ENABLED = 'true';

    await startSsoDiagnosticsPollerIfEnabled();
    await vi.advanceTimersByTimeAsync(1000);

    expect(ssoSyncDiagnosticsService.runReconciliationDiagnostics).toHaveBeenCalledTimes(1);
    expect(ssoSyncDiagnosticsService.runReconciliationCleanup).toHaveBeenCalledTimes(1);
    expect(ssoSyncDiagnosticsService.runProviderIdentityCheck).not.toHaveBeenCalled();
  });

  it('runs provider identity checks after diagnostics and before replay when env provider check is enabled', async () => {
    process.env.SSO_DIAGNOSTICS_INTERVAL_MS = '1000';
    process.env.SSO_DIAGNOSTICS_PROVIDER_CHECK_ENABLED = 'true';
    process.env.SSO_DIAGNOSTICS_REPLAY_SNAPSHOTS_ENABLED = 'true';

    await startSsoDiagnosticsPollerIfEnabled();
    await vi.advanceTimersByTimeAsync(1000);

    expect(ssoSyncDiagnosticsService.runReconciliationDiagnostics).toHaveBeenCalledTimes(1);
    expect(ssoSyncDiagnosticsService.runProviderIdentityCheck).toHaveBeenCalledTimes(1);
    expect(ssoSyncDiagnosticsService.runSnapshotReconciliation).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ssoSyncDiagnosticsService.runProviderIdentityCheck).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(ssoSyncDiagnosticsService.runSnapshotReconciliation).mock.invocationCallOrder[0]);
  });

  it('runs snapshot replay after diagnostics when env replay is enabled', async () => {
    process.env.SSO_DIAGNOSTICS_INTERVAL_MS = '1000';
    process.env.SSO_DIAGNOSTICS_REPLAY_SNAPSHOTS_ENABLED = 'true';

    await startSsoDiagnosticsPollerIfEnabled();
    await vi.advanceTimersByTimeAsync(1000);

    expect(ssoSyncDiagnosticsService.runReconciliationDiagnostics).toHaveBeenCalledTimes(1);
    expect(ssoSyncDiagnosticsService.runProviderIdentityCheck).not.toHaveBeenCalled();
    expect(ssoSyncDiagnosticsService.runSnapshotReconciliation).toHaveBeenCalledTimes(1);
    expect(ssoSyncDiagnosticsService.runSnapshotReconciliation).toHaveBeenCalledWith(expect.objectContaining({
      refreshProviderClaims: false,
    }));
    expect(ssoSyncDiagnosticsService.runReconciliationCleanup).not.toHaveBeenCalled();
  });

  it('runs snapshot replay with live claim refresh when env refresh is enabled', async () => {
    process.env.SSO_DIAGNOSTICS_INTERVAL_MS = '1000';
    process.env.SSO_DIAGNOSTICS_REPLAY_SNAPSHOTS_ENABLED = 'true';
    process.env.SSO_DIAGNOSTICS_REFRESH_CLAIMS_ENABLED = 'true';

    await startSsoDiagnosticsPollerIfEnabled();
    await vi.advanceTimersByTimeAsync(1000);

    expect(ssoSyncDiagnosticsService.runSnapshotReconciliation).toHaveBeenCalledWith(expect.objectContaining({
      refreshProviderClaims: true,
    }));
  });

  it('reconciles enabled LDAP providers and ignores other provider protocols', async () => {
    listIdentityProviders.mockResolvedValue([
      { key: 'ldap-directory', protocol: 'ldap', isEnabled: true },
      { key: 'disabled-ldap', protocol: 'ldap', isEnabled: false },
      { key: 'oidc', protocol: 'oidc', isEnabled: true },
    ]);

    await runScheduledLdapReconciliationOnce({ tenantIds: ['tenant-a'] });

    expect(reconcileLdapProvider).toHaveBeenCalledTimes(1);
    expect(reconcileLdapProvider).toHaveBeenCalledWith('ldap-directory', 'tenant-a');
  });
});
