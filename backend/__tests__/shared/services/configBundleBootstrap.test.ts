import { beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { getPlatformDatabaseCapability } from '@enterpriseglue/shared/services/platform-database-context.js';

const config = vi.hoisted(() => ({
  configBundlePath: '/etc/enterpriseglue/config/bundle.json' as string | undefined,
  configBootstrapMode: 'apply' as 'apply' | 'validate' | 'disabled',
  configExpectedSha256: undefined as string | undefined,
  configExpectedTenantScope: undefined as string | undefined,
  configRequireSecretPreflight: false,
  configMaxBytes: 1024 * 1024,
  tenancyMode: 'single' as 'single' | 'pooled',
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
    config.tenancyMode = 'single';
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
    const bundle = { apiVersion: 'enterpriseglue.ai/v1alpha1', kind: 'EnterpriseGlueConfigBundle', metadata: { key: 'acme.authz', owner: 'platform' }, tenantKey: 'acme', mode: 'preview_only', settings: {}, imports: ['./groups.json'] };
    readFile.mockResolvedValue(Buffer.from(zipSync({
      'bundle.json': Buffer.from(JSON.stringify(bundle)),
      'groups.json': Buffer.from(JSON.stringify({ groups: [{ key: 'group.ops', name: 'Operations' }] })),
    })));
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

  function providerPayload(): any {
    return { bundle: { apiVersion: 'enterpriseglue.ai/v1beta1', kind: 'EnterpriseGlueConfigBundle',
      metadata: { key: 'platform.signup', owner: 'platform-team' }, tenantKey: 'platform', mode: 'additive', imports: ['./identity-providers.json'] },
    files: { './identity-providers.json': { identityProviders: [{ key: 'signup-oidc', type: 'oidc', authenticationMode: 'direct', enabled: true,
      oidc: { issuerUrl: 'https://issuer.example.com', clientId: 'client-id', clientSecretRef: 'env://EG_CONFIG_BUNDLE_SECRET',
        clientAuthentication: 'client_secret_post', callbackUrl: 'https://app.example.com/api/auth/identity/callback', scopes: ['openid', 'email', 'profile'] },
      sync: { triggers: ['login'], requiredForLogin: true, incompleteEntitlements: 'fail_closed', connectorCapability: 'claim_only', scheduled: false } }] } } };
  }

  function mountPooled(payload = providerPayload()) {
    config.tenancyMode = 'pooled';
    config.configExpectedTenantScope = 'platform';
    config.configRequireSecretPreflight = true;
    const bytes = JSON.stringify(payload);
    config.configExpectedSha256 = createHash('sha256').update(bytes).digest('hex');
    readFile.mockResolvedValue(bytes);
    return payload;
  }

  it('grants one verified provider-only lease for apply and receipt then revokes deferred work', async () => {
    mountPooled();
    const expected = { kind: 'config-bootstrap', bundleKey: 'platform.signup', providerKeys: ['signup-oidc'] };
    let resume!: () => void;
    let deferred!: Promise<unknown>;
    apply.mockImplementation(async () => {
      expect(getPlatformDatabaseCapability()).toEqual(expected);
      deferred = new Promise<void>(resolve => { resume = resolve; }).then(() => getPlatformDatabaseCapability());
      return { applyRunId: 'apply-run-1', reconciliation: { identitySnapshot: { status: 'not_needed' }, runtimeReconciliation: { status: 'not_needed' } } };
    });
    updateApplyRun.mockImplementation(async () => {
      expect(getPlatformDatabaseCapability()).toEqual(expected);
      return { affected: 1 };
    });
    preview.mockImplementation(() => {
      expect(getPlatformDatabaseCapability()).toBeUndefined();
      return { valid: true, canonicalHash: 'preview-hash' };
    });
    await expect(runConfigBundleBootstrap()).resolves.toMatchObject({ status: 'applied' });
    expect(getPlatformDatabaseCapability()).toBeUndefined();
    resume();
    await expect(deferred).resolves.toBeUndefined();
  });

  it.each([
    ['unknown facet', (p: any) => { p.bundle.extraAuthority = true; }],
    ['governance', (p: any) => { p.bundle.governance = {}; }],
    ['login', (p: any) => { p.bundle.login = {}; }],
    ['foreign scope', (p: any) => { p.bundle.tenantKey = 'other'; }],
    ['authoritative mode', (p: any) => { p.bundle.mode = 'authoritative'; }],
    ['group import', (p: any) => { p.bundle.imports.push('./groups.json'); p.files['./groups.json'] = { groups: [] }; }],
    ['unimported file', (p: any) => { p.files['./groups.json'] = { groups: [] }; }],
    ['empty owner', (p: any) => { p.bundle.metadata.owner = ''; }],
    ['ownership acknowledgement', (p: any) => { p.acknowledgements = ['config.ownership_adoption:platform_settings:general']; }],
    ['duplicate provider', (p: any) => { p.files['./identity-providers.json'].identityProviders.push(p.files['./identity-providers.json'].identityProviders[0]); }],
  ])('rejects pooled %s before importer authority', async (_, mutate) => {
    const payload = providerPayload(); mutate(payload); mountPooled(payload);
    await expect(runConfigBundleBootstrap()).rejects.toThrow('validation failed');
    expect(apply).not.toHaveBeenCalled();
    expect(getPlatformDatabaseCapability()).toBeUndefined();
  });

  it('validates pooled bundles without granting mutation authority', async () => {
    mountPooled(); config.configBootstrapMode = 'validate';
    await expect(runConfigBundleBootstrap()).resolves.toMatchObject({ status: 'validated' });
    expect(apply).not.toHaveBeenCalled();
    expect(updateApplyRun).not.toHaveBeenCalled();
    expect(getPlatformDatabaseCapability()).toBeUndefined();
  });

  it('fails unexpected global replay inside the same lease instead of treating invisible tasks as drained', async () => {
    mountPooled();
    apply.mockResolvedValue({ applyRunId: 'apply-run-1', reconciliation: { identitySnapshot: { status: 'truncated' } } });
    updateApplyRun.mockImplementation(async (_, change) => {
      expect(getPlatformDatabaseCapability()?.kind).toBe('config-bootstrap');
      expect(JSON.parse(change.resultJson).bootstrap.status).toBe('failed');
      return { affected: 1 };
    });
    await expect(runConfigBundleBootstrap()).rejects.toThrow('identity reconciliation failed');
    expect(drainApplyRun).not.toHaveBeenCalled();
    expect(drainRuntimeApplyRun).not.toHaveBeenCalled();
    expect(updateApplyRun).toHaveBeenCalledTimes(1);
    expect(getPlatformDatabaseCapability()).toBeUndefined();
  });

  it('does not report pooled readiness when the receipt is hidden or fails to update', async () => {
    mountPooled();
    apply.mockResolvedValue({ applyRunId: 'apply-run-1' });
    findApplyRun.mockResolvedValue(null);
    await expect(runConfigBundleBootstrap()).rejects.toThrow('apply failed');
    expect(getConfigBootstrapStatus().status).toBe('failed');
    expect(getPlatformDatabaseCapability()).toBeUndefined();
    findApplyRun.mockResolvedValue({ id: 'apply-run-1', resultJson: '{}' });
    updateApplyRun.mockResolvedValue({ affected: 0 });
    await expect(runConfigBundleBootstrap()).rejects.toThrow('apply failed');
    expect(getPlatformDatabaseCapability()).toBeUndefined();
  });

  it('requires hash, platform scope and secret preflight before pooled apply authority', async () => {
    mountPooled(); config.configExpectedSha256 = undefined;
    await expect(runConfigBundleBootstrap()).rejects.toThrow('validation failed');
    mountPooled(); config.configExpectedTenantScope = 'tenant-a';
    await expect(runConfigBundleBootstrap()).rejects.toThrow('validation failed');
    mountPooled(); config.configRequireSecretPreflight = false;
    await expect(runConfigBundleBootstrap()).rejects.toThrow('validation failed');
    expect(apply).not.toHaveBeenCalled();
    expect(getPlatformDatabaseCapability()).toBeUndefined();
  });

  it('revokes pooled capability after importer failure without exposing the raw error', async () => {
    mountPooled();
    apply.mockImplementation(async () => {
      expect(getPlatformDatabaseCapability()?.kind).toBe('config-bootstrap');
      throw new Error('private upstream credential diagnostic');
    });
    await expect(runConfigBundleBootstrap()).rejects.toThrow('Configuration bundle apply failed');
    expect(JSON.stringify(bootstrapLogger.error.mock.calls)).not.toContain('private upstream');
    expect(getPlatformDatabaseCapability()).toBeUndefined();
  });
});
