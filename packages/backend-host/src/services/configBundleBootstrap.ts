import { config } from '@enterpriseglue/shared/config/index.js';
import { configBundlePreviewService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundlePreviewService.js';
import { configBundleApplyService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleApplyService.js';
import { configBundleSecretPreflightService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleSecretPreflightService.js';
import { platformSettingsService } from '@enterpriseglue/shared/services/platform-admin/PlatformSettingsService.js';
import { configBundleIdentityReplayTaskService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleIdentityReplayTaskService.js';
import { configBundleRuntimeReconciliationTaskService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleRuntimeReconciliationTaskService.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ConfigBundleApplyRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/ConfigBundleApplyRun.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import type { EngineTenantReferenceResolver } from '@enterpriseglue/shared/services/platform-admin/EngineTenancyProvisioningService.js';
import { readConfigBundleFile } from './configBundleFileIngress.js';

export const CONFIG_BOOTSTRAP_ISSUE_CODES = [
  'bundle_path_missing', 'bundle_read_failed', 'hash_mismatch', 'validation_failed',
  'secret_preflight_failed', 'tenant_scope_missing', 'apply_failed', 'identity_reconciliation_failed',
] as const;
export type ConfigBootstrapIssueCode = typeof CONFIG_BOOTSTRAP_ISSUE_CODES[number];

export type ConfigBootstrapStatus = {
  mode: 'disabled' | 'validate' | 'apply';
  status: 'disabled' | 'validated' | 'applied' | 'failed';
  hash: string | null;
  message: string | null;
  reconciliation: 'not_run' | 'completed' | 'pending';
  secretPreflight: 'not_required' | 'passed' | 'failed';
  issueCode: ConfigBootstrapIssueCode | null;
};

const SAFE_MESSAGES: Record<ConfigBootstrapIssueCode, string> = {
  bundle_path_missing: 'Configuration bundle path is required',
  bundle_read_failed: 'Configuration bundle could not be read',
  hash_mismatch: 'Configuration bundle hash verification failed',
  validation_failed: 'Configuration bundle validation failed',
  secret_preflight_failed: 'Configuration bundle secret preflight failed',
  tenant_scope_missing: 'Configuration bundle target scope is required',
  apply_failed: 'Configuration bundle apply failed',
  identity_reconciliation_failed: 'Configuration bundle identity reconciliation failed',
};

class ConfigBootstrapFailure extends Error {
  constructor(readonly issueCode: ConfigBootstrapIssueCode) { super(SAFE_MESSAGES[issueCode]); }
}

let status: ConfigBootstrapStatus = { mode: 'disabled', status: 'disabled', hash: null, message: null, reconciliation: 'not_run', secretPreflight: 'not_required', issueCode: null };

export function getConfigBootstrapStatus(): ConfigBootstrapStatus {
  return { ...status };
}

export function getConfigBootstrapMetrics(): string {
  const current = getConfigBootstrapStatus();
  const ready = current.status === 'failed' ? 0 : 1;
  const applied = current.status === 'applied' ? 1 : 0;
  const labels = `mode="${current.mode}",status="${current.status}",reconciliation="${current.reconciliation}",secret_preflight="${current.secretPreflight}",issue_code="${current.issueCode || 'none'}"`;
  return [
    '# HELP enterpriseglue_config_bootstrap_ready Whether configuration bootstrap permits readiness.',
    '# TYPE enterpriseglue_config_bootstrap_ready gauge',
    `enterpriseglue_config_bootstrap_ready ${ready}`,
    '# HELP enterpriseglue_config_bootstrap_applied Whether a configuration bundle was applied at startup.',
    '# TYPE enterpriseglue_config_bootstrap_applied gauge',
    `enterpriseglue_config_bootstrap_applied ${applied}`,
    '# HELP enterpriseglue_config_bootstrap_info Sanitized configuration bootstrap state.',
    '# TYPE enterpriseglue_config_bootstrap_info gauge',
    `enterpriseglue_config_bootstrap_info{${labels}} 1`,
    '',
  ].join('\n');
}

async function persistBootstrapReceipt(applyRunId: string | null, bootstrap: ConfigBootstrapStatus): Promise<void> {
  if (!applyRunId) return;
  try {
    const repo = (await getDataSource()).getRepository(ConfigBundleApplyRun);
    const run = await repo.findOne({ where: { id: applyRunId } });
    if (!run) return;
    let result: Record<string, unknown> = {};
    try { result = run.resultJson ? JSON.parse(run.resultJson) as Record<string, unknown> : {}; } catch { /* retain receipt availability */ }
    await repo.update({ id: applyRunId }, { resultJson: JSON.stringify({ ...result, bootstrap }), updatedAt: Date.now() });
  } catch {
    logger.warn('Configuration bootstrap receipt update failed', { applyRunIdPresent: true });
  }
}

export async function runConfigBundleBootstrap(options: {
  tenantReferenceResolver?: EngineTenantReferenceResolver | null;
} = {}): Promise<ConfigBootstrapStatus> {
  const mode = config.configBootstrapMode;
  let secretPreflight: ConfigBootstrapStatus['secretPreflight'] = 'not_required';
  let phase: 'read' | 'hash' | 'validate' | 'preflight' | 'apply' | 'identity' = 'read';
  let applyRunId: string | null = null;
  status = { mode, status: mode === 'disabled' ? 'disabled' : 'failed', hash: null, message: null, reconciliation: 'not_run', secretPreflight, issueCode: null };
  if (mode === 'disabled') return getConfigBootstrapStatus();

  try {
    if (!config.configBundlePath) throw new ConfigBootstrapFailure('bundle_path_missing');
    const { payload, sha256: hash } = await readConfigBundleFile(config.configBundlePath, config.configMaxBytes);
    status = { ...status, hash };
    phase = 'hash';
    if (config.configExpectedSha256 && hash !== config.configExpectedSha256.toLowerCase()) throw new ConfigBootstrapFailure('hash_mismatch');
    phase = 'validate';
    const settings = await platformSettingsService.get();
    const preview = configBundlePreviewService.preview(payload, settings);
    if (!preview.valid || !preview.canonicalHash) throw new ConfigBootstrapFailure('validation_failed');
    phase = 'preflight';
    const checkedSecretPreflight = config.configRequireSecretPreflight
      ? configBundleSecretPreflightService.check(payload, settings)
      : null;
    if (checkedSecretPreflight && (!checkedSecretPreflight.valid || !checkedSecretPreflight.available || checkedSecretPreflight.canonicalHash !== preview.canonicalHash || !checkedSecretPreflight.availabilityHash)) {
      secretPreflight = 'failed';
      throw new ConfigBootstrapFailure('secret_preflight_failed');
    }
    if (checkedSecretPreflight) secretPreflight = 'passed';
    if (mode === 'apply') {
      if (!config.configExpectedTenantScope) throw new ConfigBootstrapFailure('tenant_scope_missing');
      phase = 'apply';
      const result = await configBundleApplyService.apply({
        ...payload,
        expectedPreviewHash: preview.canonicalHash,
        expectedSecretPreflightHash: checkedSecretPreflight?.availabilityHash,
        idempotencyKey: `bootstrap:${hash}`,
        expectedTenantScope: config.configExpectedTenantScope,
        actorId: 'system:config-bootstrap',
      }, {
        ...settings,
        tenantReferenceResolver: options.tenantReferenceResolver || null,
        tenantReferencePrincipalType: 'system',
        tenantReferencePrincipalId: 'system:config-bootstrap',
      });
      applyRunId = result.applyRunId || null;
      phase = 'identity';
      const identityStatus = result.reconciliation?.identitySnapshot?.status;
      const runtimeStatus = result.reconciliation?.runtimeReconciliation?.status;
      if (identityStatus === 'failed' || runtimeStatus === 'failed') {
        throw new ConfigBootstrapFailure('identity_reconciliation_failed');
      }
      if (identityStatus === 'truncated') {
        status = { ...status, reconciliation: 'pending' };
        if (!result.applyRunId) throw new ConfigBootstrapFailure('identity_reconciliation_failed');
        const drain = await configBundleIdentityReplayTaskService.drainApplyRun({
          applyRunId: result.applyRunId,
          maxPages: 100,
          pageLimit: 500,
        });
        if (drain.status !== 'completed') {
          throw new ConfigBootstrapFailure('identity_reconciliation_failed');
        }
        status = { ...status, reconciliation: 'completed' };
      }
      if (runtimeStatus === 'queued') {
        status = { ...status, reconciliation: 'pending' };
        if (!result.applyRunId) throw new ConfigBootstrapFailure('identity_reconciliation_failed');
        const drain = await configBundleRuntimeReconciliationTaskService.drainApplyRun({
          applyRunId: result.applyRunId,
          maxTasks: 100,
        });
        if (drain.status !== 'completed') {
          throw new ConfigBootstrapFailure('identity_reconciliation_failed');
        }
        status = { ...status, reconciliation: 'completed' };
      }
    }
    status = { mode, status: mode === 'apply' ? 'applied' : 'validated', hash, message: null, reconciliation: mode === 'apply' && status.reconciliation !== 'pending' ? 'completed' : status.reconciliation, secretPreflight, issueCode: null };
    await persistBootstrapReceipt(applyRunId, status);
    logger.info('Configuration bootstrap completed', status);
  } catch (error) {
    const issueCode = error instanceof ConfigBootstrapFailure
      ? error.issueCode
      : phase === 'read' ? 'bundle_read_failed'
        : phase === 'hash' || phase === 'validate' ? 'validation_failed'
          : phase === 'preflight' ? 'secret_preflight_failed'
            : phase === 'identity' ? 'identity_reconciliation_failed'
              : 'apply_failed';
    status = { mode, status: 'failed', hash: status.hash, message: SAFE_MESSAGES[issueCode], reconciliation: status.reconciliation, secretPreflight, issueCode };
    await persistBootstrapReceipt(applyRunId, status);
    logger.error('Configuration bootstrap failed', status);
    throw new Error(SAFE_MESSAGES[issueCode]);
  }
  return getConfigBootstrapStatus();
}
