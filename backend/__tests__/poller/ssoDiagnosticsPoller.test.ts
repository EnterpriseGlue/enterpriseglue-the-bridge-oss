import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityProviderService } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js';
import { ldapReconciliationService } from '@enterpriseglue/shared/services/platform-admin/LdapReconciliationService.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { getTenantDatabaseContext } from '@enterpriseglue/shared/services/tenant-database-context.js';
import { ssoSyncDiagnosticsService } from '@enterpriseglue/shared/services/platform-admin/SsoSyncDiagnosticsService.js';
import {
  runScheduledLdapReconciliationOnce,
  runScheduledSsoProviderIdentityCheckOnce,
  startSsoDiagnosticsPollerIfEnabled,
  stopSsoDiagnosticsPoller,
} from '../../../packages/backend-host/src/poller/ssoDiagnosticsPoller.js';

vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js', () => ({
  identityProviderService: { list: vi.fn() },
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/LdapReconciliationService.js', () => ({
  ldapReconciliationService: { reconcileProvider: vi.fn() },
}));
vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoSyncDiagnosticsService.js', () => ({
  ssoSyncDiagnosticsService: { runProviderIdentityCheck: vi.fn() },
}));

describe('ssoDiagnosticsPoller LDAP scheduler', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalTenancyMode = config.tenancyMode;

  beforeEach(() => {
    vi.clearAllMocks();
    config.tenancyMode = 'single';
    vi.useFakeTimers();
    delete process.env.SSO_DIAGNOSTICS_INTERVAL_MS;
    delete process.env.SSO_DIAGNOSTICS_TENANT_IDS;
    delete process.env.SSO_DIAGNOSTICS_RUN_ON_START;
    process.env.NODE_ENV = 'test';
    stopSsoDiagnosticsPoller();
    vi.mocked(identityProviderService.list).mockResolvedValue([] as never);
    vi.mocked(ldapReconciliationService.reconcileProvider).mockResolvedValue({ processed: 0, runId: null });
  });

  afterEach(() => {
    stopSsoDiagnosticsPoller();
    process.env.NODE_ENV = originalNodeEnv;
    config.tenancyMode = originalTenancyMode;
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

  it('uses the fail-safe production cadence when the interval is omitted or disabled', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SSO_DIAGNOSTICS_INTERVAL_MS = '0';

    await expect(startSsoDiagnosticsPollerIfEnabled()).resolves.not.toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(identityProviderService.list).toHaveBeenCalledWith(null);
  });

  it('fans out pooled LDAP and diagnostics under canonical active tenant context', async () => {
    config.tenancyMode = 'pooled';
    vi.mocked(getDataSource).mockResolvedValue({ getRepository: () => ({ find: async () => [
      { id: 'tenant-a', slug: 'alpha', status: 'active' },
      { id: 'tenant-b', slug: 'beta', status: 'active' },
      { id: 'tenant-c', slug: 'closed', status: 'suspended' },
    ] }) } as any);
    const scopes: unknown[] = [];
    vi.mocked(identityProviderService.list).mockImplementation(async tenantId => {
      scopes.push(getTenantDatabaseContext());
      return [{ key: `ldap-${tenantId}`, protocol: 'ldap', isEnabled: true }] as never;
    });
    vi.mocked(ldapReconciliationService.reconcileProvider).mockImplementation(async (_, tenantId) => {
      expect(getTenantDatabaseContext()?.tenantId).toBe(tenantId);
      return { processed: 1 };
    });
    vi.mocked(ssoSyncDiagnosticsService.runProviderIdentityCheck).mockImplementation(async input => {
      expect(getTenantDatabaseContext()?.tenantId).toBe(input?.tenantId);
      return { status: 'checked' } as never;
    });
    await expect(runScheduledLdapReconciliationOnce()).resolves.toHaveLength(2);
    await expect(runScheduledSsoProviderIdentityCheckOnce()).resolves.toHaveLength(2);
    expect(scopes).toEqual([{ tenantId: 'tenant-a', tenantSlug: 'alpha' }, { tenantId: 'tenant-b', tenantSlug: 'beta' }]);
    expect(getTenantDatabaseContext()).toBeUndefined();
  });

  it('rejects explicit global or unknown pooled scopes before provider work', async () => {
    config.tenancyMode = 'pooled';
    vi.mocked(getDataSource).mockResolvedValue({ getRepository: () => ({ find: async () => [] }) } as any);
    await expect(runScheduledLdapReconciliationOnce({ tenantIds: [null] })).rejects.toThrow('unavailable');
    await expect(runScheduledSsoProviderIdentityCheckOnce({ tenantIds: [null] })).rejects.toThrow('unavailable');
    await expect(runScheduledLdapReconciliationOnce({ tenantIds: ['missing'] })).rejects.toThrow('not registered');
    expect(identityProviderService.list).not.toHaveBeenCalled();
  });
});
