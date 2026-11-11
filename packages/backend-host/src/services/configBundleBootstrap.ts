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
import { ConfigReferenceKeySchema } from '@enterpriseglue/shared/schemas/platform-admin/config-bundle.js';
import {
  configBundleSha256, isConfigBundleDirectory, listConfigBundleDirectory, parseConfigBundleFile,
  readConfigBundleDirectoryEntry, readConfigBundleFile, type ConfigBundleFileReadResult,
} from './configBundleFileIngress.js';
import { providerBootstrapCapability } from './configBundleBootstrapScope.js';
import { runWithPlatformDatabaseCapability } from '@enterpriseglue/shared/services/platform-database-context.js';
import { OSS_DEFAULT_TENANT_ID } from '@enterpriseglue/shared/authz/tenant-scope.js';

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

function initialStatus(mode: ConfigBootstrapStatus['mode']): ConfigBootstrapStatus {
  return { mode, status: mode === 'disabled' ? 'disabled' : 'failed', hash: null, message: null, reconciliation: 'not_run', secretPreflight: 'not_required', issueCode: null };
}

let status = initialStatus('disabled');

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

async function persistBootstrapReceipt(applyRunId: string | null, bootstrap: ConfigBootstrapStatus, required = false): Promise<void> {
  if (!applyRunId) {
    if (required) throw new ConfigBootstrapFailure('apply_failed');
    return;
  }
  try {
    const repo = (await getDataSource()).getRepository(ConfigBundleApplyRun);
    const run = await repo.findOne({ where: { id: applyRunId } });
    if (!run) {
      if (required) throw new ConfigBootstrapFailure('apply_failed');
      return;
    }
    let result: Record<string, unknown> = {};
    try { result = run.resultJson ? JSON.parse(run.resultJson) as Record<string, unknown> : {}; } catch { /* retain receipt availability */ }
    const updated = await repo.update({ id: applyRunId }, { resultJson: JSON.stringify({ ...result, bootstrap }), updatedAt: Date.now() });
    if (required && updated.affected !== 1) throw new ConfigBootstrapFailure('apply_failed');
  } catch {
    logger.warn('Configuration bootstrap receipt update failed', { applyRunIdPresent: true });
    if (required) throw new ConfigBootstrapFailure('apply_failed');
  }
}

type ConfigBundleBootstrapOptions = {
  tenantReferenceResolver?: EngineTenantReferenceResolver | null;
};

async function runBundle(
  mode: Exclude<ConfigBootstrapStatus['mode'], 'disabled'>,
  read: () => Promise<ConfigBundleFileReadResult>,
  options: ConfigBundleBootstrapOptions,
  expectedHash?: string,
  filename?: string,
): Promise<ConfigBootstrapStatus> {
  let status = initialStatus(mode);
  let bundleKey: string | null = null;
  let secretPreflight: ConfigBootstrapStatus['secretPreflight'] = 'not_required';
  let phase: 'read' | 'hash' | 'validate' | 'preflight' | 'apply' | 'identity' = 'read';
  let applyRunId: string | null = null;
  let failureRecorded = false;
  const diagnostics = () => filename === undefined ? status : { ...status, filename, bundleKey };

  const recordFailure = async (error: unknown) => {
    const issueCode = error instanceof ConfigBootstrapFailure
      ? error.issueCode
      : phase === 'read' ? 'bundle_read_failed'
        : phase === 'hash' || phase === 'validate' ? 'validation_failed'
          : phase === 'preflight' ? 'secret_preflight_failed'
            : phase === 'identity' ? 'identity_reconciliation_failed'
              : 'apply_failed';
    status = { mode, status: 'failed', hash: status.hash, message: SAFE_MESSAGES[issueCode], reconciliation: status.reconciliation, secretPreflight, issueCode };
    await persistBootstrapReceipt(applyRunId, status);
    logger.error('Configuration bootstrap failed', diagnostics());
    failureRecorded = true;
  };

  try {
    const { payload, sha256: hash } = await read();
    if (filename !== undefined) {
      const key = (payload.bundle as { metadata?: { key?: unknown } } | null)?.metadata?.key;
      bundleKey = ConfigReferenceKeySchema.safeParse(key).data ?? null;
    }
    status = { ...status, hash };
    phase = 'hash';
    if (expectedHash && hash !== expectedHash) throw new ConfigBootstrapFailure('hash_mismatch');
    phase = 'validate';
    const capability = config.tenancyMode === 'pooled' ? providerBootstrapCapability(payload) : null;
    if (capability && (!config.configExpectedSha256 || config.configExpectedTenantScope !== 'platform'
      || !config.configRequireSecretPreflight)) throw new ConfigBootstrapFailure('validation_failed');
    const settings = await platformSettingsService.get();
    const previewPayload = { bundle: payload.bundle, files: payload.files };
    const preview = configBundlePreviewService.preview(previewPayload, settings);
    if (!preview.valid || !preview.canonicalHash) throw new ConfigBootstrapFailure('validation_failed');
    const canonicalHash = preview.canonicalHash;
    phase = 'preflight';
    const checkedSecretPreflight = config.configRequireSecretPreflight
      ? configBundleSecretPreflightService.check(previewPayload, settings)
      : null;
    if (checkedSecretPreflight && (!checkedSecretPreflight.valid || !checkedSecretPreflight.available || checkedSecretPreflight.canonicalHash !== preview.canonicalHash || !checkedSecretPreflight.availabilityHash)) {
      secretPreflight = 'failed';
      throw new ConfigBootstrapFailure('secret_preflight_failed');
    }
    if (checkedSecretPreflight) secretPreflight = 'passed';
    const execute = async () => {
      try {
        if (mode === 'apply') {
          const expectedTenantScope = config.configExpectedTenantScope;
          if (!expectedTenantScope) throw new ConfigBootstrapFailure('tenant_scope_missing');
          // Directory bundles on a standalone host share the live API's
          // persistence scope. Keep the startup assertion and the legacy
          // single-file and pooled capability paths intact.
          const tenantId = filename !== undefined && config.tenancyMode === 'single' ? OSS_DEFAULT_TENANT_ID : null;
          phase = 'apply';
          const result = await configBundleApplyService.apply({
            ...previewPayload,
            acknowledgements: payload.acknowledgements || [],
            expectedPreviewHash: canonicalHash,
            expectedSecretPreflightHash: checkedSecretPreflight?.availabilityHash,
            idempotencyKey: `bootstrap:${hash}`,
            expectedTenantScope: tenantId && expectedTenantScope === 'platform' ? tenantId : expectedTenantScope,
            ...(tenantId ? { tenantId } : {}),
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
          // Provider-only imports cannot legitimately enqueue entitlement or engine
          // work. Do not mistake queues hidden by RLS for a completed global drain.
          if (capability && (identityStatus === 'truncated' || runtimeStatus === 'queued')) {
            throw new ConfigBootstrapFailure('identity_reconciliation_failed');
          }
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
        await persistBootstrapReceipt(applyRunId, status, Boolean(capability && mode === 'apply'));
        logger.info('Configuration bootstrap completed', diagnostics());
      } catch (error) {
        // Failure receipts are written before the capability lease is revoked.
        await recordFailure(error);
        throw error;
      }
    };
    if (capability && mode === 'apply') await runWithPlatformDatabaseCapability(capability, execute);
    else await execute();
  } catch (error) {
    if (!failureRecorded) await recordFailure(error);
  }
  return status;
}

async function runDirectory(
  path: string,
  mode: Exclude<ConfigBootstrapStatus['mode'], 'disabled'>,
  options: ConfigBundleBootstrapOptions,
  expectedHash?: string,
): Promise<ConfigBootstrapStatus> {
  const { root, filenames } = await listConfigBundleDirectory(path);
  const verifiedHashes = new Map<string, string>();
  const read = (filename: string) => readConfigBundleDirectoryEntry(root, filename, config.configMaxBytes);
  const aggregate = initialStatus(mode);
  if (expectedHash) {
    for (const filename of filenames) {
      try {
        verifiedHashes.set(filename, configBundleSha256(await read(filename)));
      } catch {
        logger.error('Configuration bootstrap input could not be verified', { filename, issueCode: 'bundle_read_failed' });
        throw new ConfigBootstrapFailure('bundle_read_failed');
      }
    }
    aggregate.hash = configBundleSha256(JSON.stringify([...verifiedHashes]));
    if (aggregate.hash !== expectedHash) {
      return { ...aggregate, issueCode: 'hash_mismatch', message: SAFE_MESSAGES.hash_mismatch };
    }
  }

  for (const filename of filenames) {
    const result = await runBundle(mode, async () => {
      const source = await read(filename);
      const hash = configBundleSha256(source);
      if (expectedHash && verifiedHashes.get(filename) !== hash) throw new ConfigBootstrapFailure('hash_mismatch');
      return parseConfigBundleFile(filename, source, config.configMaxBytes, hash);
    }, options, undefined, filename);

    if (result.status === 'failed' && !aggregate.issueCode) {
      aggregate.issueCode = result.issueCode;
      aggregate.message = result.message;
    }
    if (result.reconciliation === 'pending') aggregate.reconciliation = 'pending';
    if (result.secretPreflight === 'failed' || aggregate.secretPreflight === 'not_required') {
      aggregate.secretPreflight = result.secretPreflight;
    }
  }

  if (!aggregate.issueCode) {
    aggregate.status = mode === 'apply' ? 'applied' : 'validated';
    if (mode === 'apply') aggregate.reconciliation = 'completed';
  }
  return aggregate;
}

export async function runConfigBundleBootstrap(options: ConfigBundleBootstrapOptions = {}): Promise<ConfigBootstrapStatus> {
  const mode = config.configBootstrapMode;
  status = initialStatus(mode);
  if (mode === 'disabled') return getConfigBootstrapStatus();

  try {
    const path = config.configBundlePath;
    if (!path) throw new ConfigBootstrapFailure('bundle_path_missing');
    const expectedHash = config.configExpectedSha256?.toLowerCase();
    status = await isConfigBundleDirectory(path)
      ? await runDirectory(path, mode, options, expectedHash)
      : await runBundle(mode, () => readConfigBundleFile(path, config.configMaxBytes), options, expectedHash);
  } catch (error) {
    const issueCode = error instanceof ConfigBootstrapFailure ? error.issueCode : 'bundle_read_failed';
    status = { ...status, issueCode, message: SAFE_MESSAGES[issueCode] };
    logger.error('Configuration bootstrap failed', status);
  }
  if (status.status === 'failed') throw new Error(status.message || SAFE_MESSAGES.apply_failed);
  return getConfigBootstrapStatus();
}
