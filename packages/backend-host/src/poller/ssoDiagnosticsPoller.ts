import { ssoSyncDiagnosticsService } from '@enterpriseglue/shared/services/platform-admin/SsoSyncDiagnosticsService.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { identityProviderService } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js';
import { ldapReconciliationService } from '@enterpriseglue/shared/services/platform-admin/LdapReconciliationService.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Tenant } from '@enterpriseglue/shared/infrastructure/persistence/entities/Tenant.js';
import { runWithTenantDatabaseContext } from '@enterpriseglue/shared/services/tenant-database-context.js';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
const PRODUCTION_SSO_SCHEDULER_INTERVAL_MS = 60_000;

export interface SsoDiagnosticsPollerOptions {
  intervalMs?: number;
  tenantIds?: Array<string | null>;
  providerIds?: Array<string | null>;
  runOnStart?: boolean;
  cleanupEnabled?: boolean;
  providerCheckEnabled?: boolean;
  refreshClaimsEnabled?: boolean;
  snapshotReplayEnabled?: boolean;
}

function parsePositiveInterval(value: string | undefined): number {
  const parsed = Number(value || 0);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  // Scheduled LDAP is an authoritative revocation path. Production may tune
  // its cadence but cannot silently turn the scheduler off with an omitted,
  // zero, or malformed value.
  return process.env.NODE_ENV === 'production' ? PRODUCTION_SSO_SCHEDULER_INTERVAL_MS : 0;
}

function parseNullableList(value: string | undefined, defaultValue: Array<string | null>): Array<string | null> {
  const normalized = value?.trim();
  if (!normalized) return defaultValue;
  const items = normalized
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item === '*' || item.toLowerCase() === 'global' || item.toLowerCase() === 'null') ? null : item);
  return items.length > 0 ? items : defaultValue;
}

function readOptionsFromEnv(): Required<SsoDiagnosticsPollerOptions> {
  return {
    intervalMs: parsePositiveInterval(process.env.SSO_DIAGNOSTICS_INTERVAL_MS),
    tenantIds: parseNullableList(process.env.SSO_DIAGNOSTICS_TENANT_IDS, config.tenancyMode === 'pooled' ? [] : [null]),
    providerIds: parseNullableList(process.env.SSO_DIAGNOSTICS_PROVIDER_IDS, [null]),
    runOnStart: process.env.SSO_DIAGNOSTICS_RUN_ON_START === 'true',
    cleanupEnabled: process.env.SSO_DIAGNOSTICS_CLEANUP_ENABLED === 'true',
    providerCheckEnabled: process.env.SSO_DIAGNOSTICS_PROVIDER_CHECK_ENABLED === 'true',
    refreshClaimsEnabled: process.env.SSO_DIAGNOSTICS_REFRESH_CLAIMS_ENABLED === 'true',
    snapshotReplayEnabled: process.env.SSO_DIAGNOSTICS_REPLAY_SNAPSHOTS_ENABLED === 'true',
  };
}

async function inScheduledTenantScopes<T>(tenantIds: Array<string | null> | undefined, work: (tenantId: string | null) => Promise<T>): Promise<T[]> {
  if (config.tenancyMode !== 'pooled') {
    const results: T[] = [];
    for (const id of tenantIds?.length ? tenantIds : [null]) results.push(await work(id));
    return results;
  }
  // Global provider reconciliation has no verified provider-bound capability.
  // An explicit global selection must not masquerade as a successful empty scan.
  if (tenantIds?.includes(null)) throw new Error('Global SSO scheduling is unavailable in pooled tenancy');
  const tenants = await (await getDataSource()).getRepository(Tenant).find();
  const selected = tenantIds?.length ? [...new Set(tenantIds)].map(id => {
    const tenant = tenants.find(row => row.id === id);
    if (!tenant) throw new Error('Scheduled SSO tenant is not registered');
    return tenant;
  }) : tenants;
  const results: T[] = [];
  for (const tenant of selected) {
    if (tenant.status !== 'active') continue;
    results.push(await runWithTenantDatabaseContext({ tenantId: tenant.id, tenantSlug: tenant.slug }, () => work(tenant.id)));
  }
  return results;
}

export async function runScheduledSsoDiagnosticsOnce(options: Pick<SsoDiagnosticsPollerOptions, 'tenantIds' | 'providerIds'> = {}) {
  void options;
  // Legacy mapping diagnostics are deliberately retired. Provider-neutral
  // identity replay is owned by the identity-provider reconciliation flows.
  return [];
}

export async function runScheduledSsoCleanupOnce(options: Pick<SsoDiagnosticsPollerOptions, 'tenantIds' | 'providerIds'> = {}) {
  void options;
  return [];
}

export async function runScheduledSsoProviderIdentityCheckOnce(options: Pick<SsoDiagnosticsPollerOptions, 'tenantIds' | 'providerIds'> = {}) {
  const providerIds = options.providerIds && options.providerIds.length > 0 ? options.providerIds : [null];
  const groups = await inScheduledTenantScopes(options.tenantIds, async tenantId => {
    const results = [];
    for (const providerId of providerIds) {
      results.push(await ssoSyncDiagnosticsService.runProviderIdentityCheck({
        tenantId,
        providerId,
        trigger: 'scheduled',
        details: {
          source: 'sso_diagnostics_poller',
        },
      }));
    }
    return results;
  });
  return groups.flat();
}

export async function runScheduledSsoSnapshotReplayOnce(
  options: Pick<SsoDiagnosticsPollerOptions, 'tenantIds' | 'providerIds' | 'refreshClaimsEnabled'> = {}
) {
  void options;
  return [];
}

export async function runScheduledLdapReconciliationOnce(options: Pick<SsoDiagnosticsPollerOptions, 'tenantIds'> = {}) {
  const groups = await inScheduledTenantScopes(options.tenantIds, async tenantId => {
    const results = [];
    const providers = await identityProviderService.list(tenantId);
    for (const provider of providers) {
      if (provider.protocol !== 'ldap' || !provider.isEnabled) continue;
      results.push(await ldapReconciliationService.reconcileProvider(provider.key, tenantId));
    }
    return results;
  });
  return groups.flat();
}

export async function startSsoDiagnosticsPollerIfEnabled(options: SsoDiagnosticsPollerOptions = {}) {
  const envOptions = readOptionsFromEnv();
  const intervalMs = options.intervalMs ?? envOptions.intervalMs;
  if (timer) return timer;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return null;

  const tenantIds = options.tenantIds ?? envOptions.tenantIds;
  const providerIds = options.providerIds ?? envOptions.providerIds;
  const runOnStart = options.runOnStart ?? envOptions.runOnStart;
  const cleanupEnabled = options.cleanupEnabled ?? envOptions.cleanupEnabled;
  const providerCheckEnabled = options.providerCheckEnabled ?? envOptions.providerCheckEnabled;
  const refreshClaimsEnabled = options.refreshClaimsEnabled ?? envOptions.refreshClaimsEnabled;
  const snapshotReplayEnabled = options.snapshotReplayEnabled ?? envOptions.snapshotReplayEnabled;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      if (providerCheckEnabled) {
        await runScheduledSsoProviderIdentityCheckOnce({ tenantIds, providerIds });
      }
      await runScheduledLdapReconciliationOnce({ tenantIds });
      void cleanupEnabled;
      void refreshClaimsEnabled;
      void snapshotReplayEnabled;
    } catch (error) {
      logger.warn('Scheduled SSO diagnostics scan failed:', error);
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => {
    void tick();
  }, intervalMs);

  if (runOnStart) {
    void tick();
  }

  return timer;
}

export function stopSsoDiagnosticsPoller() {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}
