import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const migrationTestEnv = (name: string, fallback: string): string =>
  process.env[`MIGRATION_TEST_${name}`] || process.env[name] || fallback;

const schema = `headless_config_${Date.now()}`;
let bundleDirectory = '';
let bundlePath = '';
const baseEnv = {
  POSTGRES_HOST: migrationTestEnv('POSTGRES_HOST', 'localhost'),
  POSTGRES_PORT: migrationTestEnv('POSTGRES_PORT', '5432'),
  POSTGRES_USER: migrationTestEnv('POSTGRES_USER', 'postgres'),
  POSTGRES_PASSWORD: migrationTestEnv('POSTGRES_PASSWORD', 'postgres'),
  POSTGRES_DATABASE: migrationTestEnv('POSTGRES_DATABASE', 'postgres'),
};

function applyEnvironment(): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_TYPE = 'postgres';
  process.env.POSTGRES_HOST = baseEnv.POSTGRES_HOST;
  process.env.POSTGRES_PORT = baseEnv.POSTGRES_PORT;
  process.env.POSTGRES_USER = baseEnv.POSTGRES_USER;
  process.env.POSTGRES_PASSWORD = baseEnv.POSTGRES_PASSWORD;
  process.env.POSTGRES_DATABASE = baseEnv.POSTGRES_DATABASE;
  process.env.POSTGRES_SCHEMA = schema;
  process.env.POSTGRES_SSL = 'false';
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.HEADLESS_GIT_OAUTH_SECRET = 'headless-git-oauth-secret';
  process.env.HEADLESS_EMAIL_CREDENTIAL = 'headless-email-credential';
  process.env.HEADLESS_API_CLIENT_TOKEN = 'egac_00000000-0000-4000-8000-000000000101_headless-api-client-secret-value';
  process.env.HEADLESS_SERVICE_ACCOUNT_TOKEN = 'egsa_00000000-0000-4000-8000-000000000102_headless-service-account-secret';
  process.env.EG_CONFIG_BUNDLE_PATH = bundlePath;
  process.env.EG_CONFIG_BOOTSTRAP_MODE = 'apply';
  process.env.EG_CONFIG_EXPECTED_TENANT_SCOPE = 'platform';
  process.env.EG_CONFIG_REQUIRE_SECRET_PREFLIGHT = 'true';
  process.env.EG_CONFIG_FAIL_CLOSED = 'true';
}

async function createPool() {
  const pgModule = await import('pg');
  const Pool = (pgModule.default?.Pool || pgModule.Pool) as typeof import('pg').Pool;
  return new Pool({
    host: baseEnv.POSTGRES_HOST,
    port: Number(baseEnv.POSTGRES_PORT),
    user: baseEnv.POSTGRES_USER,
    password: baseEnv.POSTGRES_PASSWORD,
    database: baseEnv.POSTGRES_DATABASE,
    ssl: false,
  });
}

async function dropSchema(): Promise<void> {
  const pool = await createPool();
  try {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema.replace(/"/g, '""')}" CASCADE`);
  } finally {
    await pool.end();
  }
}

const bundle = {
  apiVersion: 'enterpriseglue.ai/v1beta1',
  kind: 'EnterpriseGlueConfigBundle',
  metadata: { key: 'platform.headless-e2e', owner: 'platform-operations' },
  tenantKey: 'tenant.platform',
  mode: 'authoritative',
  imports: [
    './environment-tags.json', './platform-settings.json', './git-providers.json',
    './email-configurations.json', './email-templates.json', './permissions.json',
    './roles.json', './assignments.json',
    './authorization-policies.json', './machine-principals.json', './external-engine-systems.json',
  ],
  governance: {
    engineMembershipAuthority: 'manual',
    projectMembershipAuthority: 'manual',
    engineRegistrationPolicy: 'manual_allowed',
    projectEngineTargetPolicy: 'manual_allowed',
    runtimeAuthorizationAuthority: 'enterpriseglue_authoritative',
    governanceSettingsOwnership: 'config_locked',
  },
};

const files = {
  './git-providers.json': {
    gitProviders: [{
      key: 'git-provider.headless-e2e', name: 'Headless GitLab', type: 'gitlab',
      baseUrl: 'https://git.example.com', apiUrl: 'https://git.example.com/api/v4',
      oauth: {
        clientId: 'headless-client', clientSecretRef: 'env://HEADLESS_GIT_OAUTH_SECRET',
        scopes: 'api,read_user', authorizationUrl: 'https://git.example.com/oauth/authorize',
        tokenUrl: 'https://git.example.com/oauth/token',
      },
      supportsPat: true, active: true, displayOrder: 10, ownershipMode: 'config_locked',
    }],
  },
  './email-configurations.json': {
    emailConfigurations: [{
      key: 'email-config.headless-e2e', name: 'Headless mail', provider: 'resend',
      credentialRef: 'env://HEADLESS_EMAIL_CREDENTIAL', fromName: 'EnterpriseGlue',
      fromEmail: 'noreply@example.com', replyTo: 'support@example.com', smtp: null,
      enabled: true, isDefault: true, ownershipMode: 'config_locked',
    }],
  },
  './email-templates.json': {
    emailTemplates: [{
      key: 'email-template.headless-welcome', type: 'headless_welcome', name: 'Headless welcome',
      subject: 'Welcome to {{platformName}}', htmlTemplate: '<p>Welcome {{userName}}</p>',
      textTemplate: 'Welcome {{userName}}', variables: ['platformName', 'userName'],
      active: true, ownershipMode: 'config_locked',
    }],
  },
  './permissions.json': {
    permissions: [{
      key: 'platform:custom:headless-audit', scope: 'platform', category: 'Headless',
      label: 'Read headless audit', description: 'Allows reading the headless audit view.',
      ownershipMode: 'config_locked',
    }],
  },
  './roles.json': {
    roles: [{
      key: 'custom.headless-auditor', name: 'Headless auditor',
      description: 'Role assembled entirely from headless configuration.', scope: 'platform',
      permissions: ['platform:config-bundles:preview', 'platform:custom:headless-audit'], ownershipMode: 'config_locked',
    }],
  },
  './assignments.json': {
    assignments: [
      {
        principal: { type: 'api_client', key: 'api-client.headless-e2e' },
        roleKey: 'custom.headless-auditor', scope: { type: 'platform' }, ownershipMode: 'config_locked',
      },
      {
        principal: { type: 'service_account', key: 'service-account.headless-e2e' },
        roleKey: 'custom.headless-auditor', scope: { type: 'platform' }, ownershipMode: 'config_locked',
      },
    ],
  },
  './authorization-policies.json': {
    authorizationPolicies: [{
      key: 'policy.headless-e2e', name: 'Headless audit policy', description: 'Config-owned policy',
      effect: 'allow', priority: 100, resourceType: 'platform', action: 'platform:custom:headless-audit',
      conditions: { environment: { requireMfa: true } }, active: true, ownershipMode: 'config_locked',
    }],
  },
  './machine-principals.json': {
    machinePrincipals: [
      {
        kind: 'api_client', key: 'api-client.headless-e2e', name: 'Headless config client',
        tokenRef: 'env://HEADLESS_API_CLIENT_TOKEN', scopes: ['config:bundle:manage'],
        active: true, ownershipMode: 'config_locked',
      },
      {
        kind: 'service_account', key: 'service-account.headless-e2e', name: 'Headless deployment account',
        description: 'Config-owned deployment principal', tokenRef: 'env://HEADLESS_SERVICE_ACCOUNT_TOKEN',
        scopes: ['deployment:execute'], active: true, ownershipMode: 'config_locked',
      },
    ],
  },
  './external-engine-systems.json': {
    externalEngineSystems: [{
      key: 'external-engine-system.headless-e2e', name: 'Headless provisioner',
      description: 'Config-owned external engine source', defaultManagementMode: 'external_managed',
      defaultFieldOwnership: { name: 'external', baseUrl: 'external' }, active: true,
      ownershipMode: 'config_locked',
    }],
  },
  './environment-tags.json': {
    environmentTags: [{
      key: 'environment.headless-e2e',
      name: 'Headless E2E',
      color: '#0F62FE',
      manualDeployAllowed: false,
      sortOrder: 20,
      isDefault: true,
      ownershipMode: 'config_locked',
    }],
  },
  './platform-settings.json': {
    platformSettings: {
      ownershipMode: 'config_locked',
      general: {
        defaultEnvironmentTagKey: 'environment.headless-e2e',
        emailPlatformName: 'Headless EnterpriseGlue',
      },
      gitSync: {
        pushEnabled: true,
        pullEnabled: true,
        bothEnabled: true,
        projectTokenSharingEnabled: false,
      },
      deployment: {
        defaultDeployRoles: ['owner', 'operator'],
        credentiallessCustomerSidecarsEnabled: false,
      },
      invitations: {
        allowAllDomains: false,
        allowedDomains: ['example.com'],
      },
      pii: {
        regexEnabled: true,
        externalProviderEnabled: false,
        externalProviderType: null,
        externalProviderEndpoint: null,
        externalProviderAuthHeader: null,
        externalProviderAuthTokenRef: null,
        externalProviderProjectId: null,
        externalProviderRegion: null,
        redactionStyle: '[REDACTED]',
        scopes: ['processDetails', 'audit'],
        maxPayloadSizeBytes: 131072,
      },
      branding: {
        logoUrl: 'https://assets.example.com/logo.svg',
        loginLogoUrl: 'https://assets.example.com/login.svg',
        loginTitleVerticalOffset: 4,
        loginTitleColor: '#161616',
        logoTitle: 'Headless EnterpriseGlue',
        logoScale: 115,
        titleFontUrl: null,
        titleFontWeight: '600',
        titleFontSize: 16,
        titleVerticalOffset: 2,
        menuAccentColor: '#0F62FE',
        faviconUrl: 'https://assets.example.com/favicon.ico',
      },
    },
  },
};

describe('headless platform configuration persistence', () => {
  beforeAll(async () => {
    bundleDirectory = await mkdtemp(join(tmpdir(), 'enterpriseglue-headless-config-'));
    bundlePath = join(bundleDirectory, 'bundle.json');
    await writeFile(bundlePath, `${JSON.stringify({ bundle, files })}\n`, { mode: 0o600 });
    applyEnvironment();
    vi.resetModules();
    await dropSchema();
  });

  afterAll(async () => {
    try {
      const { closeDataSource } = await import('@enterpriseglue/shared/db/data-source.js');
      await closeDataSource();
    } finally {
      await dropSchema();
      if (bundleDirectory) await rm(bundleDirectory, { recursive: true, force: true });
    }
  });

  it('applies without an administrator, survives a datasource restart, exports, and reapplies as a no-op', async () => {
    const { initializeDatabase } = await import('@enterpriseglue/shared/db/run-migrations.js');
    const { configBundlePreviewService } = await import('@enterpriseglue/shared/services/platform-admin/ConfigBundlePreviewService.js');
    const { closeDataSource } = await import('@enterpriseglue/shared/db/data-source.js');
    const { runConfigBundleBootstrap } = await import('../../../packages/backend-host/src/services/configBundleBootstrap.js');

    await initializeDatabase();
    await expect(runConfigBundleBootstrap()).resolves.toMatchObject({
      mode: 'apply',
      status: 'applied',
      reconciliation: 'completed',
      secretPreflight: 'passed',
      issueCode: null,
    });

    // This is the same lifecycle boundary used by a backend/container restart.
    await closeDataSource();
    vi.resetModules();
    applyEnvironment();

    const { runConfigBundleBootstrap: runRestartedConfigBundleBootstrap } = await import('../../../packages/backend-host/src/services/configBundleBootstrap.js');
    await expect(runRestartedConfigBundleBootstrap()).resolves.toMatchObject({
      mode: 'apply',
      status: 'applied',
      reconciliation: 'completed',
      secretPreflight: 'passed',
      issueCode: null,
    });

    const { platformSettingsService } = await import('@enterpriseglue/shared/services/platform-admin/PlatformSettingsService.js');
    const { platformBrandingService } = await import('@enterpriseglue/shared/services/platform-admin/PlatformBrandingService.js');
    const { environmentTagService } = await import('@enterpriseglue/shared/services/platform-admin/EnvironmentTagService.js');
    const { configBundleExportService } = await import('@enterpriseglue/shared/services/platform-admin/ConfigBundleExportService.js');
    const { configBundleDiffService } = await import('@enterpriseglue/shared/services/platform-admin/ConfigBundleDiffService.js');
    const { configBundleApplyService: restartedApplyService } = await import('@enterpriseglue/shared/services/platform-admin/ConfigBundleApplyService.js');
    const { apiClientService, ApiClientScopes } = await import('@enterpriseglue/shared/services/platform-admin/ApiClientService.js');
    const { serviceAccountService, ServiceAccountScopes } = await import('@enterpriseglue/shared/services/platform-admin/ServiceAccountService.js');
    const { permissionService } = await import('@enterpriseglue/shared/services/platform-admin/permissions.js');
    const { emailConfigService } = await import('@enterpriseglue/shared/services/admin/EmailConfigService.js');
    const { getDataSource } = await import('@enterpriseglue/shared/db/data-source.js');
    const { GitProvider } = await import('@enterpriseglue/shared/infrastructure/persistence/entities/GitProvider.js');
    const { EmailTemplate } = await import('@enterpriseglue/shared/infrastructure/persistence/entities/EmailTemplate.js');
    const { RbacPermission } = await import('@enterpriseglue/shared/infrastructure/persistence/entities/RbacPermission.js');
    const { RbacRole } = await import('@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js');
    const { RbacRolePermission } = await import('@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js');
    const { AuthzPolicy } = await import('@enterpriseglue/shared/infrastructure/persistence/entities/AuthzPolicy.js');
    const { ExternalEngineSystem } = await import('@enterpriseglue/shared/infrastructure/persistence/entities/ExternalEngineSystem.js');
    const { AdminConfigObjectOwnership } = await import('@enterpriseglue/shared/infrastructure/persistence/entities/AdminConfigObjectOwnership.js');

    const [settings, branding, tags, exported] = await Promise.all([
      platformSettingsService.get(),
      platformBrandingService.get(),
      environmentTagService.getAll(),
      configBundleExportService.exportBundle({ bundleKey: 'platform.headless-e2e', tenantKey: 'tenant.platform' }),
    ]);

    const configuredTag = tags.find((tag) => tag.configKey === 'environment.headless-e2e');
    expect(configuredTag).toMatchObject({
      name: 'Headless E2E',
      isDefault: true,
      sourceRef: 'config_bundle:platform.headless-e2e',
      ownershipMode: 'config_locked',
      driftStatus: 'in_sync',
    });
    expect(settings).toMatchObject({
      defaultEnvironmentTagId: configuredTag?.id,
      emailPlatformName: 'Headless EnterpriseGlue',
      syncPushEnabled: true,
      syncPullEnabled: true,
      syncBothEnabled: true,
      defaultDeployRoles: ['owner', 'operator'],
      inviteAllowAllDomains: false,
      inviteAllowedDomains: ['example.com'],
      piiRegexEnabled: true,
      piiRedactionStyle: '[REDACTED]',
      piiScopes: ['processDetails', 'audit'],
    });
    expect(settings.sectionOwnership).toEqual(expect.arrayContaining([
      expect.objectContaining({ section: 'general', ownershipMode: 'config_locked', driftStatus: 'in_sync' }),
      expect.objectContaining({ section: 'pii', ownershipMode: 'config_locked', driftStatus: 'in_sync' }),
      expect.objectContaining({ section: 'branding', ownershipMode: 'config_locked', driftStatus: 'in_sync' }),
    ]));
    expect(branding).toMatchObject({
      logoTitle: 'Headless EnterpriseGlue',
      menuAccentColor: '#0F62FE',
      ownership: expect.objectContaining({ ownershipMode: 'config_locked', driftStatus: 'in_sync' }),
    });
    const restartedDataSource = await getDataSource();
    const [gitProvider, emailTemplates, permissions, roles, policies, externalSystems, ownership] = await Promise.all([
      restartedDataSource.getRepository(GitProvider).findOneBy({ name: 'Headless GitLab' }),
      restartedDataSource.getRepository(EmailTemplate).findBy({ type: 'headless_welcome' }),
      restartedDataSource.getRepository(RbacPermission).findBy({ key: 'platform:custom:headless-audit' }),
      restartedDataSource.getRepository(RbacRole).findBy({ key: 'custom.headless-auditor' }),
      restartedDataSource.getRepository(AuthzPolicy).findBy({ name: 'Headless audit policy' }),
      restartedDataSource.getRepository(ExternalEngineSystem).findBy({ key: 'external-engine-system.headless-e2e' }),
      restartedDataSource.getRepository(AdminConfigObjectOwnership).findBy({ sourceRef: 'config_bundle:platform.headless-e2e', active: true }),
    ]);
    expect(gitProvider).toMatchObject({ oauthClientSecret: 'ref:env://HEADLESS_GIT_OAUTH_SECRET', isActive: true });
    expect(emailTemplates).toHaveLength(1);
    expect(permissions).toHaveLength(1);
    expect(roles).toEqual([expect.objectContaining({ source: 'config', sourceRef: 'config_bundle:platform.headless-e2e', isArchived: false })]);
    expect(await restartedDataSource.getRepository(RbacRolePermission).findBy({
      roleId: roles[0]!.id,
      permissionId: 'platform:custom:headless-audit',
    })).toHaveLength(1);
    expect(policies).toEqual([expect.objectContaining({ action: 'platform:custom:headless-audit', isActive: true })]);
    expect(externalSystems).toHaveLength(1);
    expect(ownership).toHaveLength(8);
    expect(ownership.every((entry) => entry.ownershipMode === 'config_locked' && entry.driftStatus === 'in_sync')).toBe(true);

    const emailConfiguration = (await emailConfigService.list()).find((configuration) => configuration.name === 'Headless mail');
    expect(emailConfiguration).toBeTruthy();
    await expect(emailConfigService.getDecryptedConfig(emailConfiguration!.id)).resolves.toMatchObject({ apiKey: 'headless-email-credential' });
    await expect(apiClientService.authenticateToken(process.env.HEADLESS_API_CLIENT_TOKEN!, ApiClientScopes.CONFIG_BUNDLE_MANAGE))
      .resolves.toMatchObject({ id: '00000000-0000-4000-8000-000000000101', name: 'Headless config client' });
    await expect(serviceAccountService.authenticateToken(process.env.HEADLESS_SERVICE_ACCOUNT_TOKEN!, ServiceAccountScopes.DEPLOYMENT_EXECUTE))
      .resolves.toMatchObject({ id: '00000000-0000-4000-8000-000000000102', name: 'Headless deployment account' });
    await expect(permissionService.hasPermission('platform:config-bundles:preview', {
      principalType: 'api_client', principalId: '00000000-0000-4000-8000-000000000101',
      tenantId: null, resourceType: 'platform',
    })).resolves.toBe(true);
    await expect(permissionService.hasPermission('platform:config-bundles:preview', {
      principalType: 'service_account', principalId: '00000000-0000-4000-8000-000000000102',
      tenantId: null, resourceType: 'platform',
    })).resolves.toBe(true);

    await expect(emailConfigService.update(emailConfiguration!.id, { name: 'UI override', userId: 'admin-not-required' }))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(apiClientService.rotateClient('00000000-0000-4000-8000-000000000101'))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(exported.files).toMatchObject({
      './environment-tags.json': files['./environment-tags.json'],
      './platform-settings.json': files['./platform-settings.json'],
      './git-providers.json': files['./git-providers.json'],
      './assignments.json': files['./assignments.json'],
      './email-configurations.json': files['./email-configurations.json'],
      './email-templates.json': files['./email-templates.json'],
      './permissions.json': files['./permissions.json'],
      './roles.json': files['./roles.json'],
      './authorization-policies.json': files['./authorization-policies.json'],
      './machine-principals.json': files['./machine-principals.json'],
      './external-engine-systems.json': files['./external-engine-systems.json'],
    });

    const exportedPreview = configBundlePreviewService.compile({ bundle: exported.bundle, files: exported.files });
    expect(exportedPreview.preview.valid).toBe(true);
    const diff = await configBundleDiffService.diff({ bundle: exported.bundle, files: exported.files });
    expect(diff.valid).toBe(true);
    expect(diff.changes.every((change) => change.operation === 'noop')).toBe(true);

    const reducedFiles = {
      ...exported.files,
      './git-providers.json': { gitProviders: [] },
      './email-configurations.json': { emailConfigurations: [] },
      './email-templates.json': { emailTemplates: [] },
      './permissions.json': { permissions: [] },
      './roles.json': { roles: [] },
      './assignments.json': { assignments: [] },
      './authorization-policies.json': { authorizationPolicies: [] },
      './machine-principals.json': { machinePrincipals: [] },
      './external-engine-systems.json': { externalEngineSystems: [] },
    };
    const removalPreview = configBundlePreviewService.compile({ bundle: exported.bundle, files: reducedFiles });
    expect(removalPreview.preview.valid).toBe(true);
    const removalDiff = await configBundleDiffService.diff({ bundle: exported.bundle, files: reducedFiles });
    expect(removalDiff.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'git_provider', key: 'git-provider.headless-e2e', operation: 'archive' }),
      expect.objectContaining({ objectType: 'email_configuration', key: 'email-config.headless-e2e', operation: 'archive' }),
      expect.objectContaining({ objectType: 'email_template', key: 'email-template.headless-welcome', operation: 'archive' }),
      expect.objectContaining({ objectType: 'permission', key: 'platform:custom:headless-audit', operation: 'archive' }),
      expect.objectContaining({ objectType: 'role', key: 'custom.headless-auditor', operation: 'archive' }),
      expect.objectContaining({ objectType: 'authorization_policy', key: 'policy.headless-e2e', operation: 'archive' }),
      expect.objectContaining({ objectType: 'api_client', key: 'api-client.headless-e2e', operation: 'archive' }),
      expect.objectContaining({ objectType: 'service_account', key: 'service-account.headless-e2e', operation: 'archive' }),
      expect.objectContaining({ objectType: 'external_engine_system', key: 'external-engine-system.headless-e2e', operation: 'archive' }),
    ]));
    await restartedApplyService.apply({
      bundle: exported.bundle,
      files: reducedFiles,
      expectedPreviewHash: removalPreview.preview.canonicalHash!,
      expectedTenantScope: 'platform',
      identityReconciliationMode: 'none',
      actorId: 'system:config-bootstrap',
      acknowledgements: removalDiff.requiredAcknowledgements,
    });
    expect(await restartedDataSource.getRepository(GitProvider).findOneBy({ name: 'Headless GitLab' })).toMatchObject({ isActive: false });
    expect((await emailConfigService.list()).find((configuration) => configuration.name === 'Headless mail')).toMatchObject({ enabled: false });
    expect(await restartedDataSource.getRepository(EmailTemplate).findOneBy({ type: 'headless_welcome' })).toMatchObject({ isActive: false });
    expect(await restartedDataSource.getRepository(RbacPermission).findOneBy({ key: 'platform:custom:headless-audit' })).toMatchObject({ isArchived: true });
    expect(await restartedDataSource.getRepository(RbacRole).findOneBy({ key: 'custom.headless-auditor' })).toMatchObject({ isArchived: true });
    expect(await restartedDataSource.getRepository(AuthzPolicy).findOneBy({ name: 'Headless audit policy' })).toMatchObject({ isActive: false });
    await expect(apiClientService.authenticateToken(process.env.HEADLESS_API_CLIENT_TOKEN!, ApiClientScopes.CONFIG_BUNDLE_MANAGE))
      .rejects.toMatchObject({ statusCode: 401 });
    await expect(serviceAccountService.authenticateToken(process.env.HEADLESS_SERVICE_ACCOUNT_TOKEN!, ServiceAccountScopes.DEPLOYMENT_EXECUTE))
      .rejects.toMatchObject({ statusCode: 401 });
    expect(await restartedDataSource.getRepository(ExternalEngineSystem).findOneBy({ key: 'external-engine-system.headless-e2e' })).toMatchObject({ isActive: false });
    const retiredOwnership = await restartedDataSource.getRepository(AdminConfigObjectOwnership).findBy({
      sourceRef: 'config_bundle:platform.headless-e2e',
    });
    expect(retiredOwnership).toHaveLength(8);
    expect(retiredOwnership.every((entry) => !entry.active)).toBe(true);
    const reducedExport = await configBundleExportService.exportBundle({
      bundleKey: 'platform.headless-e2e',
      tenantKey: 'tenant.platform',
    });
    expect(reducedExport.files['./git-providers.json']).toEqual({ gitProviders: [] });
    expect(reducedExport.files['./email-configurations.json']).toEqual({ emailConfigurations: [] });
    expect(reducedExport.files['./email-templates.json']).toEqual({ emailTemplates: [] });
    expect(reducedExport.files['./permissions.json']).toEqual({ permissions: [] });
    expect(reducedExport.files['./authorization-policies.json']).toEqual({ authorizationPolicies: [] });
    expect(reducedExport.files['./machine-principals.json']).toEqual({ machinePrincipals: [] });
    expect(reducedExport.files['./external-engine-systems.json']).toEqual({ externalEngineSystems: [] });

    const restorePreview = configBundlePreviewService.compile({ bundle: exported.bundle, files: exported.files });
    expect(restorePreview.preview.valid).toBe(true);
    const restoreDiff = await configBundleDiffService.diff({ bundle: exported.bundle, files: exported.files });
    expect(restoreDiff.valid).toBe(true);
    expect(restoreDiff.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'git_provider', operation: 'update' }),
      expect.objectContaining({ objectType: 'email_configuration', operation: 'update' }),
      expect.objectContaining({ objectType: 'email_template', operation: 'update' }),
      expect.objectContaining({ objectType: 'permission', operation: 'update' }),
      expect.objectContaining({ objectType: 'authorization_policy', operation: 'update' }),
      expect.objectContaining({ objectType: 'api_client', operation: 'update' }),
      expect.objectContaining({ objectType: 'service_account', operation: 'update' }),
      expect.objectContaining({ objectType: 'external_engine_system', operation: 'update' }),
    ]));
    await restartedApplyService.apply({
      bundle: exported.bundle,
      files: exported.files,
      expectedPreviewHash: restorePreview.preview.canonicalHash!,
      expectedTenantScope: 'platform',
      identityReconciliationMode: 'none',
      actorId: 'system:config-bootstrap',
      acknowledgements: restoreDiff.requiredAcknowledgements,
    });
    const restoredDiff = await configBundleDiffService.diff({ bundle: exported.bundle, files: exported.files });
    expect(restoredDiff.changes.every((change) => change.operation === 'noop')).toBe(true);
    expect(await restartedDataSource.getRepository(RbacPermission).findOneBy({ key: 'platform:custom:headless-audit' })).toMatchObject({ isArchived: false });
    expect(await restartedDataSource.getRepository(RbacRole).findOneBy({ key: 'custom.headless-auditor' })).toMatchObject({ isArchived: false });
    expect((await restartedDataSource.getRepository(AdminConfigObjectOwnership).findBy({
      sourceRef: 'config_bundle:platform.headless-e2e', active: true,
    }))).toHaveLength(8);
  }, 120_000);
});
