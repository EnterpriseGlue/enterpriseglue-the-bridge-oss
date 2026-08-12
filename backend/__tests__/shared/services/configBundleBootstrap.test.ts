import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdmZip from 'adm-zip';

const config = vi.hoisted(() => ({
  configBundlePath: '/etc/enterpriseglue/config/bundle.json' as string | undefined,
  configBootstrapMode: 'apply' as 'apply' | 'validate' | 'disabled',
  configExpectedSha256: undefined as string | undefined,
  configExpectedTenantScope: undefined as string | undefined,
  configRequireSecretPreflight: false,
  configMaxBytes: 1024 * 1024,
}));
const open = vi.hoisted(() => vi.fn());
const stat = vi.hoisted(() => vi.fn());
const readFile = vi.hoisted(() => vi.fn());
const close = vi.hoisted(() => vi.fn());
const preview = vi.hoisted(() => vi.fn());
const apply = vi.hoisted(() => vi.fn());
const secretPreflight = vi.hoisted(() => vi.fn());
const getPlatformSettings = vi.hoisted(() => vi.fn());
const drainApplyRun = vi.hoisted(() => vi.fn());
const drainRuntimeApplyRun = vi.hoisted(() => vi.fn());
const findApplyRun = vi.hoisted(() => vi.fn());
const updateApplyRun = vi.hoisted(() => vi.fn());
const bootstrapLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock('@enterpriseglue/shared/config/index.js', () => ({ config }));
vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn().mockResolvedValue({ getRepository: () => ({ findOne: findApplyRun, update: updateApplyRun }) }),
}));
vi.mock('@enterpriseglue/shared/utils/logger.js', () => ({ logger: bootstrapLogger }));
vi.mock('node:fs/promises', () => ({ open }));
vi.mock('@enterpriseglue/shared/services/platform-admin/ConfigBundlePreviewService.js', () => ({
  configBundlePreviewService: { preview },
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/ConfigBundleApplyService.js', () => ({
  configBundleApplyService: { apply },
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/ConfigBundleSecretPreflightService.js', () => ({
  configBundleSecretPreflightService: { check: secretPreflight },
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/PlatformSettingsService.js', () => ({
  platformSettingsService: { get: getPlatformSettings },
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/ConfigBundleIdentityReplayTaskService.js', () => ({
  configBundleIdentityReplayTaskService: { drainApplyRun },
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/ConfigBundleRuntimeReconciliationTaskService.js', () => ({
  configBundleRuntimeReconciliationTaskService: { drainApplyRun: drainRuntimeApplyRun },
}));

import { getConfigBootstrapMetrics, getConfigBootstrapStatus, runConfigBundleBootstrap } from '../../../../packages/backend-host/src/services/configBundleBootstrap.js';

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
    close.mockResolvedValue(undefined);
    open.mockResolvedValue({ stat, readFile, close });
    preview.mockReturnValue({ valid: true, canonicalHash: 'preview-hash', errors: [] });
    secretPreflight.mockReturnValue({ valid: true, available: true, canonicalHash: 'preview-hash', availabilityHash: 'secret-preflight-hash', errors: [] });
    getPlatformSettings.mockResolvedValue({ credentiallessCustomerSidecarsEnabled: false });
    drainApplyRun.mockResolvedValue({ status: 'completed', pagesProcessed: 1, taskCount: 1, activeTaskCount: 0, failedTaskCount: 0 });
    drainRuntimeApplyRun.mockResolvedValue({ status: 'completed', taskCount: 1, activeTaskCount: 0, failedTaskCount: 0 });
    findApplyRun.mockResolvedValue({ id: 'apply-run-1', resultJson: JSON.stringify({ canonicalHash: 'preview-hash', changes: [] }) });
    updateApplyRun.mockResolvedValue({ affected: 1 });
  });

  it('keeps a no-bundle startup ready without touching filesystem ingress', async () => {
    config.configBootstrapMode = 'disabled';
    config.configBundlePath = undefined;

    await expect(runConfigBundleBootstrap()).resolves.toMatchObject({ mode: 'disabled', status: 'disabled', hash: null });

    expect(open).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
  });

  it('rejects a bootstrap apply without an explicit expected tenant scope', async () => {
    await expect(runConfigBundleBootstrap()).rejects.toThrow('Configuration bundle target scope is required');

    expect(apply).not.toHaveBeenCalled();
    expect(getConfigBootstrapStatus()).toMatchObject({
      mode: 'apply',
      status: 'failed',
      reconciliation: 'not_run',
      issueCode: 'tenant_scope_missing',
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

    expect(preview).toHaveBeenCalledWith(
      { bundle, files: { './groups.json': { groups: [{ key: 'group.ops', name: 'Operations' }] } } },
      expect.objectContaining({ credentiallessCustomerSidecarsEnabled: false }),
    );
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ expectedPreviewHash: 'preview-hash', expectedTenantScope: 'tenant-a' }),
      expect.objectContaining({ credentiallessCustomerSidecarsEnabled: false }),
    );
  });

  it('passes the enterprise tenant reference resolver to startup mapping apply', async () => {
    config.configExpectedTenantScope = 'tenant-a';
    apply.mockResolvedValue({ canonicalHash: 'preview-hash' });
    const tenantReferenceResolver = { resolve: vi.fn() };

    await expect(runConfigBundleBootstrap({ tenantReferenceResolver })).resolves.toMatchObject({
      mode: 'apply',
      status: 'applied',
    });

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'system:config-bootstrap' }),
      expect.objectContaining({
        tenantReferenceResolver,
        tenantReferencePrincipalType: 'system',
        tenantReferencePrincipalId: 'system:config-bootstrap',
      }),
    );
  });

  it('passes hash-bound startup acknowledgements to apply without including them in preview', async () => {
    config.configExpectedTenantScope = 'platform';
    const payload = {
      bundle: { apiVersion: 'enterpriseglue.ai/v1beta1', kind: 'EnterpriseGlueConfigBundle' },
      files: {},
      acknowledgements: ['config.ownership_adoption:platform_settings:general'],
    };
    readFile.mockResolvedValue(JSON.stringify(payload));
    apply.mockResolvedValue({ canonicalHash: 'preview-hash' });

    await expect(runConfigBundleBootstrap()).resolves.toMatchObject({ status: 'applied' });

    expect(preview).toHaveBeenCalledWith(
      { bundle: payload.bundle, files: payload.files },
      expect.any(Object),
    );
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ acknowledgements: payload.acknowledgements }),
      expect.any(Object),
    );
  });

  it('rejects unbounded startup acknowledgements before preview or apply', async () => {
    config.configExpectedTenantScope = 'platform';
    readFile.mockResolvedValue(JSON.stringify({
      bundle: {}, files: {}, acknowledgements: ['x'.repeat(501)],
    }));

    await expect(runConfigBundleBootstrap()).rejects.toThrow('Configuration bundle could not be read');
    expect(preview).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('rejects a mounted bundle when its image-bound hash does not match', async () => {
    config.configExpectedSha256 = 'a'.repeat(64);
    readFile.mockResolvedValue(Buffer.from('{"bundle":{},"files":{}}'));

    await expect(runConfigBundleBootstrap()).rejects.toThrow('Configuration bundle hash verification failed');

    expect(preview).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(getConfigBootstrapStatus()).toMatchObject({ status: 'failed', issueCode: 'hash_mismatch' });
  });

  it('fails closed when a mounted bundle contains malformed JSON', async () => {
    config.configExpectedTenantScope = 'tenant-a';
    readFile.mockResolvedValue('{');

    await expect(runConfigBundleBootstrap()).rejects.toThrow('Configuration bundle could not be read');

    expect(preview).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(getConfigBootstrapStatus()).toMatchObject({ status: 'failed', issueCode: 'bundle_read_failed' });
  });

  it('rejects an invalid mounted bundle before apply and keeps its diagnostics safe', async () => {
    config.configExpectedTenantScope = 'tenant-a';
    preview.mockReturnValue({ valid: false, canonicalHash: undefined, errors: [{ message: 'invalid' }] });

    await expect(runConfigBundleBootstrap()).rejects.toThrow('Configuration bundle validation failed');

    expect(apply).not.toHaveBeenCalled();
    expect(getConfigBootstrapStatus()).toMatchObject({ status: 'failed', issueCode: 'validation_failed', hash: expect.any(String) });
  });

  it('reuses the same bootstrap idempotency key after a mounted-bundle restart', async () => {
    config.configExpectedTenantScope = 'tenant-a';
    apply.mockResolvedValue({ canonicalHash: 'preview-hash' });

    await expect(runConfigBundleBootstrap()).resolves.toMatchObject({ status: 'applied' });
    await expect(runConfigBundleBootstrap()).resolves.toMatchObject({ status: 'applied' });

    const idempotencyKeys = apply.mock.calls.map(([input]) => input.idempotencyKey);
    expect(idempotencyKeys).toHaveLength(2);
    expect(idempotencyKeys[0]).toMatch(/^bootstrap:[a-f0-9]{64}$/);
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
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

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ expectedSecretPreflightHash: 'secret-preflight-hash' }),
      expect.objectContaining({ credentiallessCustomerSidecarsEnabled: false }),
    );
  });

  it('drains durable identity replay continuation before reporting bootstrap ready', async () => {
    config.configExpectedTenantScope = 'tenant-a';
    apply.mockResolvedValue({
      canonicalHash: 'preview-hash',
      applyRunId: 'apply-run-1',
      reconciliation: { identitySnapshot: { status: 'truncated' } },
    });

    await expect(runConfigBundleBootstrap()).resolves.toMatchObject({
      status: 'applied',
      reconciliation: 'completed',
    });
    expect(drainApplyRun).toHaveBeenCalledWith({ applyRunId: 'apply-run-1', maxPages: 100, pageLimit: 500 });
    const receiptUpdate = updateApplyRun.mock.calls[updateApplyRun.mock.calls.length - 1]?.[1];
    expect(JSON.parse(receiptUpdate.resultJson)).toMatchObject({
      canonicalHash: 'preview-hash',
      bootstrap: { mode: 'apply', status: 'applied', reconciliation: 'completed', issueCode: null },
    });
  });

  it('fails readiness when durable identity replay remains pending after bounded startup work', async () => {
    config.configExpectedTenantScope = 'tenant-a';
    apply.mockResolvedValue({
      canonicalHash: 'preview-hash',
      applyRunId: 'apply-run-1',
      reconciliation: { identitySnapshot: { status: 'truncated' } },
    });
    drainApplyRun.mockResolvedValue({ status: 'pending', pagesProcessed: 100, taskCount: 1, activeTaskCount: 1, failedTaskCount: 0 });

    await expect(runConfigBundleBootstrap()).rejects.toThrow('Configuration bundle identity reconciliation failed');
    expect(getConfigBootstrapStatus()).toMatchObject({ status: 'failed', reconciliation: 'pending', issueCode: 'identity_reconciliation_failed' });
    const metrics = getConfigBootstrapMetrics();
    expect(metrics).toContain('enterpriseglue_config_bootstrap_ready 0');
    expect(metrics).toContain('issue_code="identity_reconciliation_failed"');
    expect(metrics).not.toContain(getConfigBootstrapStatus().hash || 'preview-hash');
    expect(bootstrapLogger.error).toHaveBeenCalledWith('Configuration bootstrap failed', expect.objectContaining({ issueCode: 'identity_reconciliation_failed' }));
  });

  it('fails bootstrap when the initial identity reconciliation page fails', async () => {
    config.configExpectedTenantScope = 'tenant-a';
    apply.mockResolvedValue({
      canonicalHash: 'preview-hash',
      applyRunId: 'apply-run-1',
      reconciliation: { identitySnapshot: { status: 'failed' } },
    });

    await expect(runConfigBundleBootstrap()).rejects.toThrow('identity reconciliation failed');
    expect(drainApplyRun).not.toHaveBeenCalled();
  });

  it('drains queued runtime reconciliation before reporting bootstrap ready', async () => {
    config.configExpectedTenantScope = 'tenant-a';
    apply.mockResolvedValue({
      canonicalHash: 'preview-hash',
      applyRunId: 'apply-run-1',
      reconciliation: { identitySnapshot: { status: 'completed' }, runtimeReconciliation: { status: 'queued' } },
    });

    await expect(runConfigBundleBootstrap()).resolves.toMatchObject({ status: 'applied', reconciliation: 'completed' });
    expect(drainRuntimeApplyRun).toHaveBeenCalledWith({ applyRunId: 'apply-run-1', maxTasks: 100 });
  });
});
