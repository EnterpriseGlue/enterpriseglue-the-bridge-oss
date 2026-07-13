import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdmZip from 'adm-zip';

const config = vi.hoisted(() => ({
  configBundlePath: '/etc/enterpriseglue/config/bundle.json',
  configBootstrapMode: 'apply' as 'apply' | 'validate' | 'disabled',
  configExpectedSha256: undefined as string | undefined,
  configExpectedTenantScope: undefined as string | undefined,
  configRequireSecretPreflight: false,
  configMaxBytes: 1024 * 1024,
}));
const stat = vi.hoisted(() => vi.fn());
const readFile = vi.hoisted(() => vi.fn());
const preview = vi.hoisted(() => vi.fn());
const apply = vi.hoisted(() => vi.fn());
const secretPreflight = vi.hoisted(() => vi.fn());

vi.mock('@enterpriseglue/shared/config/index.js', () => ({ config }));
vi.mock('node:fs/promises', () => ({ stat, readFile }));
vi.mock('@enterpriseglue/shared/services/platform-admin/ConfigBundlePreviewService.js', () => ({
  configBundlePreviewService: { preview },
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/ConfigBundleApplyService.js', () => ({
  configBundleApplyService: { apply },
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/ConfigBundleSecretPreflightService.js', () => ({
  configBundleSecretPreflightService: { check: secretPreflight },
}));

import { getConfigBootstrapStatus, runConfigBundleBootstrap } from '../../../../packages/backend-host/src/services/configBundleBootstrap.js';

describe('configBundleBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.configBundlePath = '/etc/enterpriseglue/config/bundle.json';
    config.configBootstrapMode = 'apply';
    config.configExpectedSha256 = undefined;
    config.configExpectedTenantScope = undefined;
    config.configRequireSecretPreflight = false;
    config.configMaxBytes = 1024 * 1024;
    stat.mockResolvedValue({ isFile: () => true, size: 2 });
    readFile.mockResolvedValue('{}');
    preview.mockReturnValue({ valid: true, canonicalHash: 'preview-hash', errors: [] });
    secretPreflight.mockReturnValue({ valid: true, available: true, canonicalHash: 'preview-hash', availabilityHash: 'secret-preflight-hash', errors: [] });
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

  it('loads a folder-style ZIP through the same configuration envelope path', async () => {
    config.configBundlePath = '/etc/enterpriseglue/config/bundle.zip';
    config.configExpectedTenantScope = 'tenant-a';
    const zip = new AdmZip();
    const bundle = { apiVersion: 'enterpriseglue.ai/v1alpha1', kind: 'EnterpriseGlueConfigBundle', metadata: { key: 'acme.authz', owner: 'platform' }, tenantKey: 'acme', mode: 'preview_only', settings: {}, imports: ['./groups.json'] };
    zip.addFile('bundle.json', Buffer.from(JSON.stringify(bundle)));
    zip.addFile('groups.json', Buffer.from(JSON.stringify({ groups: [{ key: 'group.ops', name: 'Operations' }] })));
    readFile.mockResolvedValue(zip.toBuffer());
    apply.mockResolvedValue({ canonicalHash: 'preview-hash' });

    await expect(runConfigBundleBootstrap()).resolves.toMatchObject({ mode: 'apply', status: 'applied' });

    expect(preview).toHaveBeenCalledWith({ bundle, files: { './groups.json': { groups: [{ key: 'group.ops', name: 'Operations' }] } } });
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ expectedPreviewHash: 'preview-hash', expectedTenantScope: 'tenant-a' }));
  });

  it('requires available secret references when bootstrap preflight is enabled', async () => {
    config.configExpectedTenantScope = 'tenant-a';
    config.configRequireSecretPreflight = true;
    secretPreflight.mockReturnValue({ valid: true, available: false, canonicalHash: 'preview-hash', availabilityHash: 'secret-preflight-hash', errors: [] });

    await expect(runConfigBundleBootstrap()).rejects.toThrow('Configuration bundle secret preflight failed');

    expect(apply).not.toHaveBeenCalled();
    expect(getConfigBootstrapStatus()).toMatchObject({ status: 'failed', secretPreflight: 'failed' });
  });

  it('binds apply to the available secret preflight result when required', async () => {
    config.configExpectedTenantScope = 'tenant-a';
    config.configRequireSecretPreflight = true;
    apply.mockResolvedValue({ canonicalHash: 'preview-hash' });

    await expect(runConfigBundleBootstrap()).resolves.toMatchObject({ status: 'applied', secretPreflight: 'passed' });

    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ expectedSecretPreflightHash: 'secret-preflight-hash' }));
  });
});
