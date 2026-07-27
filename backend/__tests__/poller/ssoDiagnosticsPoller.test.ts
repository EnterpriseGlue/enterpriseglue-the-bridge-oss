import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityProviderService } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js';
import { ldapReconciliationService } from '@enterpriseglue/shared/services/platform-admin/LdapReconciliationService.js';
import {
  runScheduledLdapReconciliationOnce,
  startSsoDiagnosticsPollerIfEnabled,
  stopSsoDiagnosticsPoller,
} from '../../../packages/backend-host/src/poller/ssoDiagnosticsPoller.js';

vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js', () => ({
  identityProviderService: { list: vi.fn() },
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/LdapReconciliationService.js', () => ({
  ldapReconciliationService: { reconcileProvider: vi.fn() },
}));

describe('ssoDiagnosticsPoller LDAP scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    delete process.env.SSO_DIAGNOSTICS_INTERVAL_MS;
    delete process.env.SSO_DIAGNOSTICS_TENANT_IDS;
    delete process.env.SSO_DIAGNOSTICS_RUN_ON_START;
    stopSsoDiagnosticsPoller();
    vi.mocked(identityProviderService.list).mockResolvedValue([] as never);
    vi.mocked(ldapReconciliationService.reconcileProvider).mockResolvedValue({ processed: 0, runId: null });
  });

  afterEach(() => {
    stopSsoDiagnosticsPoller();
    vi.useRealTimers();
  });

  it('runs only enabled LDAP providers in each selected tenant with the scheduled trigger', async () => {
    vi.mocked(identityProviderService.list).mockImplementation(async (tenantId?: string | null) => {
      if (tenantId === 'tenant-a') return [
        { key: 'ldap-scheduled', protocol: 'ldap', isEnabled: true },
        { key: 'ldap-disabled', protocol: 'ldap', isEnabled: false },
        { key: 'oidc', protocol: 'oidc', isEnabled: true },
      ] as never;
      return [{ key: 'ldap-platform', protocol: 'ldap', isEnabled: true }] as never;
    });
    vi.mocked(ldapReconciliationService.reconcileProvider)
      .mockResolvedValueOnce({ processed: 3, runId: 'run-tenant-a' })
      .mockResolvedValueOnce({ skipped: 'not_due_or_lease_held' });

    await expect(runScheduledLdapReconciliationOnce({ tenantIds: ['tenant-a', null] })).resolves.toEqual([
      { processed: 3, runId: 'run-tenant-a' },
      { skipped: 'not_due_or_lease_held' },
    ]);
    expect(ldapReconciliationService.reconcileProvider).toHaveBeenNthCalledWith(1, 'ldap-scheduled', 'tenant-a');
    expect(ldapReconciliationService.reconcileProvider).toHaveBeenNthCalledWith(2, 'ldap-platform', null);
  });

  it('does not start until explicitly configured, then avoids overlapping scheduler ticks', async () => {
    await expect(startSsoDiagnosticsPollerIfEnabled()).resolves.toBeNull();
    expect(identityProviderService.list).not.toHaveBeenCalled();

    process.env.SSO_DIAGNOSTICS_INTERVAL_MS = '1000';
    let release!: () => void;
    vi.mocked(identityProviderService.list).mockResolvedValue([{ key: 'ldap-scheduled', protocol: 'ldap', isEnabled: true }] as never);
    vi.mocked(ldapReconciliationService.reconcileProvider).mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ processed: 3, runId: 'run-1' });
    }));

    await expect(startSsoDiagnosticsPollerIfEnabled()).resolves.not.toBeNull();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(ldapReconciliationService.reconcileProvider).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(ldapReconciliationService.reconcileProvider).toHaveBeenCalledTimes(2);
  });
});
