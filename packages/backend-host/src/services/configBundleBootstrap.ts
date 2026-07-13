import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { config } from '@enterpriseglue/shared/config/index.js';
import { configBundlePreviewService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundlePreviewService.js';
import { configBundleApplyService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleApplyService.js';

export type ConfigBootstrapStatus = {
  mode: 'disabled' | 'validate' | 'apply';
  status: 'disabled' | 'validated' | 'applied' | 'failed';
  hash: string | null;
  message: string | null;
  reconciliation: 'not_run' | 'completed';
};

let status: ConfigBootstrapStatus = { mode: 'disabled', status: 'disabled', hash: null, message: null, reconciliation: 'not_run' };

export function getConfigBootstrapStatus(): ConfigBootstrapStatus {
  return { ...status };
}

export async function runConfigBundleBootstrap(): Promise<ConfigBootstrapStatus> {
  const mode = config.configBootstrapMode;
  status = { mode, status: mode === 'disabled' ? 'disabled' : 'failed', hash: null, message: null, reconciliation: 'not_run' };
  if (mode === 'disabled') return getConfigBootstrapStatus();
  if (!config.configBundlePath) throw new Error('EG_CONFIG_BUNDLE_PATH is required when configuration bootstrap is enabled');

  try {
    const metadata = await stat(config.configBundlePath);
    if (!metadata.isFile()) throw new Error('EG_CONFIG_BUNDLE_PATH must point to a JSON file');
    if (metadata.size > config.configMaxBytes) throw new Error(`Configuration bundle exceeds EG_CONFIG_MAX_BYTES (${config.configMaxBytes})`);
    const source = await readFile(config.configBundlePath, 'utf8');
    const hash = createHash('sha256').update(source).digest('hex');
    if (config.configExpectedSha256 && hash !== config.configExpectedSha256.toLowerCase()) throw new Error('Configuration bundle SHA-256 does not match EG_CONFIG_EXPECTED_SHA256');
    const payload = JSON.parse(source) as { bundle: unknown; files: Record<string, unknown> };
    const preview = configBundlePreviewService.preview(payload);
    if (!preview.valid || !preview.canonicalHash) throw new Error(`Configuration bundle validation failed: ${preview.errors.map((item) => item.message).join('; ')}`);
    if (mode === 'apply') {
      await configBundleApplyService.apply({
        ...payload,
        expectedPreviewHash: preview.canonicalHash,
        idempotencyKey: `bootstrap:${hash}`,
        expectedTenantScope: config.configExpectedTenantScope,
        actorId: 'system:config-bootstrap',
      });
    }
    status = { mode, status: mode === 'apply' ? 'applied' : 'validated', hash, message: null, reconciliation: mode === 'apply' ? 'completed' : 'not_run' };
  } catch (error) {
    status = { mode, status: 'failed', hash: status.hash, message: error instanceof Error ? error.message : String(error), reconciliation: 'not_run' };
    throw error;
  }
  return getConfigBootstrapStatus();
}
