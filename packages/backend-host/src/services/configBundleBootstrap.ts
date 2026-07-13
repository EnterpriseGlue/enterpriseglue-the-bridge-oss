import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { config } from '@enterpriseglue/shared/config/index.js';
import { configBundlePreviewService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundlePreviewService.js';
import { configBundleApplyService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleApplyService.js';
import { configBundleArchiveService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleArchiveService.js';
import { configBundleSecretPreflightService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleSecretPreflightService.js';

export type ConfigBootstrapStatus = {
  mode: 'disabled' | 'validate' | 'apply';
  status: 'disabled' | 'validated' | 'applied' | 'failed';
  hash: string | null;
  message: string | null;
  reconciliation: 'not_run' | 'completed' | 'pending';
  secretPreflight: 'not_required' | 'passed' | 'failed';
};

let status: ConfigBootstrapStatus = { mode: 'disabled', status: 'disabled', hash: null, message: null, reconciliation: 'not_run', secretPreflight: 'not_required' };

export function getConfigBootstrapStatus(): ConfigBootstrapStatus {
  return { ...status };
}

export async function runConfigBundleBootstrap(): Promise<ConfigBootstrapStatus> {
  const mode = config.configBootstrapMode;
  let secretPreflight: ConfigBootstrapStatus['secretPreflight'] = 'not_required';
  status = { mode, status: mode === 'disabled' ? 'disabled' : 'failed', hash: null, message: null, reconciliation: 'not_run', secretPreflight };
  if (mode === 'disabled') return getConfigBootstrapStatus();
  if (!config.configBundlePath) throw new Error('EG_CONFIG_BUNDLE_PATH is required when configuration bootstrap is enabled');

  try {
    const metadata = await stat(config.configBundlePath);
    if (!metadata.isFile()) throw new Error('EG_CONFIG_BUNDLE_PATH must point to a JSON file or folder-style ZIP archive');
    if (metadata.size > config.configMaxBytes) throw new Error(`Configuration bundle exceeds EG_CONFIG_MAX_BYTES (${config.configMaxBytes})`);
    const source = await readFile(config.configBundlePath);
    const hash = createHash('sha256').update(source).digest('hex');
    status = { ...status, hash };
    if (config.configExpectedSha256 && hash !== config.configExpectedSha256.toLowerCase()) throw new Error('Configuration bundle SHA-256 does not match EG_CONFIG_EXPECTED_SHA256');
    const payload = config.configBundlePath.toLowerCase().endsWith('.zip')
      ? configBundleArchiveService.readZip(source, config.configMaxBytes)
      : JSON.parse(source.toString('utf8')) as { bundle: unknown; files: Record<string, unknown> };
    const preview = configBundlePreviewService.preview(payload);
    if (!preview.valid || !preview.canonicalHash) throw new Error(`Configuration bundle validation failed: ${preview.errors.map((item) => item.message).join('; ')}`);
    const checkedSecretPreflight = config.configRequireSecretPreflight
      ? configBundleSecretPreflightService.check(payload)
      : null;
    if (checkedSecretPreflight && (!checkedSecretPreflight.valid || !checkedSecretPreflight.available || checkedSecretPreflight.canonicalHash !== preview.canonicalHash || !checkedSecretPreflight.availabilityHash)) {
      secretPreflight = 'failed';
      throw new Error('Configuration bundle secret preflight failed: one or more secret references are unavailable or invalid');
    }
    if (checkedSecretPreflight) secretPreflight = 'passed';
    if (mode === 'apply') {
      if (!config.configExpectedTenantScope) throw new Error('EG_CONFIG_EXPECTED_TENANT_SCOPE is required when configuration bootstrap applies a bundle');
      const result = await configBundleApplyService.apply({
        ...payload,
        expectedPreviewHash: preview.canonicalHash,
        expectedSecretPreflightHash: checkedSecretPreflight?.availabilityHash,
        idempotencyKey: `bootstrap:${hash}`,
        expectedTenantScope: config.configExpectedTenantScope,
        actorId: 'system:config-bootstrap',
      });
      if (result.reconciliation?.identitySnapshot?.status === 'truncated') {
        status = { ...status, reconciliation: 'pending' };
      }
    }
    status = { mode, status: mode === 'apply' ? 'applied' : 'validated', hash, message: null, reconciliation: mode === 'apply' && status.reconciliation !== 'pending' ? 'completed' : status.reconciliation, secretPreflight };
  } catch (error) {
    status = { mode, status: 'failed', hash: status.hash, message: error instanceof Error ? error.message : String(error), reconciliation: 'not_run', secretPreflight };
    throw error;
  }
  return getConfigBootstrapStatus();
}
