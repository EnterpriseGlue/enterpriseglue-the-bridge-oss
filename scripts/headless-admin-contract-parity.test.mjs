import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const families = [
  ['./git-providers.json', 'git_provider', 'gitProviders', 'GitProvidersSettings.tsx'],
  ['./email-configurations.json', 'email_configuration', 'emailConfigurations', 'EmailConfigurations.tsx'],
  ['./email-templates.json', 'email_template', 'emailTemplates', 'EmailTemplates.tsx'],
  ['./permissions.json', 'permission', 'permissions', 'PoliciesPanel.tsx'],
  ['./authorization-policies.json', 'authorization_policy', 'authorizationPolicies', 'PoliciesPanel.tsx'],
  ['./machine-principals.json', 'api_client', 'machinePrincipals', 'MachineIdentityPanel.tsx'],
  ['./machine-principals.json', 'service_account', 'machinePrincipals', 'MachineIdentityPanel.tsx'],
  ['./external-engine-systems.json', 'external_engine_system', 'externalEngineSystems', 'MachineIdentityPanel.tsx'],
];

test('every headless administrator catalog family is schema, diff, apply, export, API, portal, and documentation visible', async () => {
  const [schema, diff, apply, exportService, ownership, docs, openApi] = await Promise.all([
    read('packages/shared/src/schemas/platform-admin/config-bundle.ts'),
    read('packages/shared/src/services/platform-admin/ConfigBundleDiffService.ts'),
    read('packages/shared/src/services/platform-admin/ConfigBundleApplyService.ts'),
    read('packages/shared/src/services/platform-admin/ConfigBundleExportService.ts'),
    read('packages/shared/src/infrastructure/persistence/entities/AdminConfigObjectOwnership.ts'),
    read('docs/reference/access-governance-and-headless-api.md'),
    read('packages/shared/src/schemas/openapi.ts'),
  ]);

  for (const [path, objectType, property, portalFile] of families) {
    assert.match(schema, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(schema, new RegExp(`\\b${property}\\b`));
    assert.match(diff, new RegExp(`['\"]${objectType}['\"]`));
    assert.match(apply, new RegExp(`['\"]${objectType}['\"]`));
    assert.match(exportService, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(ownership, new RegExp(`['\"]${objectType}['\"]`));
    assert.match(docs, new RegExp(path.slice(2).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(await read(`packages/frontend-host/src/${portalFile.includes('Settings') ? 'features/platform-admin/components' : 'features/platform-admin/pages/access-control'}/${portalFile}`).catch(async () => {
      if (portalFile === 'EmailConfigurations.tsx' || portalFile === 'EmailTemplates.tsx') return read(`packages/frontend-host/src/pages/admin/${portalFile}`);
      return read(`packages/frontend-host/src/features/platform-admin/pages/access-control/${portalFile}`);
    }), /ownershipMode/);
  }

  assert.doesNotMatch(openApi.slice(openApi.indexOf('// Email configs'), openApi.indexOf('// Authorization (Authz) API')), /z\.unknown\(\)/);
  assert.match(openApi, /EmailTestRequestSchema/);
  assert.match(openApi, /UpdateEmailPlatformNameRequestSchema/);
});

test('platform settings and environments retain section or object provenance across API and portal contracts', async () => {
  const [platformSchema, environmentSchema, settingsPage, environmentsPage, brandingPage] = await Promise.all([
    read('packages/shared/src/schemas/platform-admin/platform-settings.ts'),
    read('packages/shared/src/schemas/platform-admin/environment-tag.ts'),
    read('packages/frontend-host/src/features/platform-admin/pages/PlatformSettingsPage.tsx'),
    read('packages/frontend-host/src/features/platform-admin/components/EnginesSettingsSection.tsx'),
    read('packages/frontend-host/src/features/platform-admin/components/BrandingSettingsTab.tsx'),
  ]);
  assert.match(platformSchema, /sectionOwnership/);
  assert.match(environmentSchema, /ownershipMode/);
  for (const section of ['git_sync', 'deployment', 'invitations', 'pii', 'login']) {
    assert.match(settingsPage, new RegExp(`canManageSettingsSection\\('${section}'\\)`));
  }
  assert.match(environmentsPage, /Environment ordering is managed by configuration/);
  assert.match(brandingPage, /brandingConfigLocked/);
});
