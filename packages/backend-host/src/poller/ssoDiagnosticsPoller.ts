import { ssoSyncDiagnosticsService } from '@enterpriseglue/shared/services/platform-admin/SsoSyncDiagnosticsService.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { identityProviderService } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js';
import { ldapReconciliationService } from '@enterpriseglue/shared/services/platform-admin/LdapReconciliationService.js';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

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
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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
    tenantIds: parseNullableList(process.env.SSO_DIAGNOSTICS_TENANT_IDS, [null]),
    providerIds: parseNullableList(process.env.SSO_DIAGNOSTICS_PROVIDER_IDS, [null]),
    runOnStart: process.env.SSO_DIAGNOSTICS_RUN_ON_START === 'true',
    cleanupEnabled: process.env.SSO_DIAGNOSTICS_CLEANUP_ENABLED === 'true',
    providerCheckEnabled: process.env.SSO_DIAGNOSTICS_PROVIDER_CHECK_ENABLED === 'true',
    refreshClaimsEnabled: process.env.SSO_DIAGNOSTICS_REFRESH_CLAIMS_ENABLED === 'true',
    snapshotReplayEnabled: process.env.SSO_DIAGNOSTICS_REPLAY_SNAPSHOTS_ENABLED === 'true',
  };
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
  const tenantIds = options.tenantIds && options.tenantIds.length > 0 ? options.tenantIds : [null];
  const providerIds = options.providerIds && options.providerIds.length > 0 ? options.providerIds : [null];
  const results = [];

  for (const tenantId of tenantIds) {
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
  }

  return results;
}

export async function runScheduledSsoSnapshotReplayOnce(
  options: Pick<SsoDiagnosticsPollerOptions, 'tenantIds' | 'providerIds' | 'refreshClaimsEnabled'> = {}
) {
  void options;
  return [];
}

export async function runScheduledLdapReconciliationOnce(options: Pick<SsoDiagnosticsPollerOptions, 'tenantIds'> = {}) {
  const tenantIds = options.tenantIds && options.tenantIds.length > 0 ? options.tenantIds : [null];
  const results = [];
  for (const tenantId of tenantIds) {
    const providers = await identityProviderService.list(tenantId);
    for (const provider of providers) {
      if (provider.protocol !== 'ldap' || !provider.isEnabled) continue;
      results.push(await ldapReconciliationService.reconcileProvider(provider.key, tenantId));
    }
  }
  return results;
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
