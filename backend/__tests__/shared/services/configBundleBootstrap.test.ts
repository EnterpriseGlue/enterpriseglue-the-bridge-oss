import { beforeEach, describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({
  configBundlePath: '/etc/enterpriseglue/config/bundle.json',
  configBootstrapMode: 'apply' as 'apply' | 'validate' | 'disabled',
  configExpectedSha256: undefined as string | undefined,
  configExpectedTenantScope: undefined as string | undefined,
  configMaxBytes: 1024 * 1024,
}));
const stat = vi.hoisted(() => vi.fn());
const readFile = vi.hoisted(() => vi.fn());
const preview = vi.hoisted(() => vi.fn());
const apply = vi.hoisted(() => vi.fn());

vi.mock('@enterpriseglue/shared/config/index.js', () => ({ config }));
vi.mock('node:fs/promises', () => ({ stat, readFile }));
vi.mock('@enterpriseglue/shared/services/platform-admin/ConfigBundlePreviewService.js', () => ({
  configBundlePreviewService: { preview },
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/ConfigBundleApplyService.js', () => ({
  configBundleApplyService: { apply },
}));

import { getConfigBootstrapStatus, runConfigBundleBootstrap } from '../../../../packages/backend-host/src/services/configBundleBootstrap.js';

describe('configBundleBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.configBundlePath = '/etc/enterpriseglue/config/bundle.json';
    config.configBootstrapMode = 'apply';
    config.configExpectedSha256 = undefined;
    config.configExpectedTenantScope = undefined;
    config.configMaxBytes = 1024 * 1024;
    stat.mockResolvedValue({ isFile: () => true, size: 2 });
    readFile.mockResolvedValue('{}');
    preview.mockReturnValue({ valid: true, canonicalHash: 'preview-hash', errors: [] });
  });

  it('rejects a bootstrap apply without an explicit expected tenant scope', async () => {
    await expect(runConfigBundleBootstrap()).rejects.toThrow('EG_CONFIG_EXPECTED_TENANT_SCOPE is required');

    expect(apply).not.toHaveBeenCalled();
    expect(getConfigBootstrapStatus()).toMatchObject({
      mode: 'apply',
      status: 'failed',
      reconciliation: 'not_run',
    });
  });
});
