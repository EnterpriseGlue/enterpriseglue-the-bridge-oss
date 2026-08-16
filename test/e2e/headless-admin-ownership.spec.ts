import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { MockBrowserIdentityStack } from './utils/mockIdentityStack';

const json = (route: Route, body: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const ownership = (mode: 'config_locked' | 'config_warn', driftStatus: 'in_sync' | 'drifted') => ({
  configKey: mode === 'config_locked' ? 'locked' : 'review',
  sourceRef: 'config_bundle:headless.admin',
  ownershipMode: mode,
  driftStatus,
});

const ownershipTag = (row: Locator, label: string) => row
  .locator('.cds--tag__label')
  .filter({ hasText: new RegExp(`^${label}$`) });

async function installHeadlessAdminStack(page: Page) {
  const stack = new MockBrowserIdentityStack();
  await stack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');
  const now = Date.now();

  await page.route('**/api/authz/me/permissions', (route) => json(route, {
    userId: 'browser-admin-user',
    tenantId: null,
    platform: [
      'platform:dashboard:view', 'platform:settings:view', 'platform:settings:manage',
      'platform:git-provider:manage', 'platform:authz:roles:view', 'platform:authz:roles:manage',
      'platform:authz:permissions:view', 'platform:authz:assignments:view',
      'platform:authz:assignments:create', 'platform:authz:assignments:delete',
      'platform:authz:groups:view', 'platform:authz:groups:manage', 'platform:authz:check',
      'platform:authz:policies:view', 'platform:authz:policies:manage', 'platform:audit:view',
      'platform:api-clients:view', 'platform:api-clients:manage',
      'platform:service-accounts:view', 'platform:service-accounts:manage',
      'platform:engine-registration:manage',
    ],
    projects: [], engines: [], generatedAt: now, authorizationVersion: 'headless-admin-browser-v1',
  }));

  await page.route('**/api/admin/settings', (route) => json(route, {
    syncPushEnabled: true,
    syncPullEnabled: false,
    inviteAllowAllDomains: true,
    inviteAllowedDomains: [],
    localPasswordLoginMode: 'auto',
    ssoProviderSelectionMode: 'auto_redirect_single',
    sectionOwnership: [{
      section: 'git_sync', scopeKey: 'tenant-default', sourceRef: 'config_bundle:headless.admin',
      ownershipMode: 'config_locked', sourceHash: 'git-hash', lastAppliedAt: now,
      driftStatus: 'in_sync', generation: 1,
    }],
  }));
  await page.route('**/git-api/admin/providers', (route) => json(route, [
    {
      id: 'git-locked', tenantId: null, name: 'Managed GitLab', type: 'gitlab',
      baseUrl: 'https://gitlab.com', apiUrl: 'https://gitlab.com/api/v4', customBaseUrl: null,
      customApiUrl: null, supportsOAuth: true, supportsPAT: true, isActive: true, displayOrder: 1,
      createdAt: now, updatedAt: now, projectConnectionsCount: 0, gitConnectionsCount: 0,
      hasProjectConnections: false, hasGitConnections: false, ...ownership('config_locked', 'in_sync'),
    },
    {
      id: 'git-warn', tenantId: null, name: 'Review GitHub', type: 'github',
      baseUrl: 'https://github.com', apiUrl: 'https://api.github.com', customBaseUrl: null,
      customApiUrl: null, supportsOAuth: true, supportsPAT: true, isActive: true, displayOrder: 2,
      createdAt: now, updatedAt: now, projectConnectionsCount: 0, gitConnectionsCount: 0,
      hasProjectConnections: false, hasGitConnections: false, ...ownership('config_warn', 'drifted'),
    },
  ]));
  await page.route('**/api/admin/email-configs', (route) => json(route, [{
    id: 'email-locked', name: 'Release email', provider: 'smtp', fromName: 'EnterpriseGlue',
    fromEmail: 'release@example.test', enabled: true, isDefault: false, createdAt: now, updatedAt: now,
    ...ownership('config_locked', 'in_sync'),
  }]));
  await page.route('**/api/admin/email-platform-name', (route) => json(route, {
    emailPlatformName: 'EnterpriseGlue',
    ownership: { section: 'general', sourceRef: 'config_bundle:headless.admin', ownershipMode: 'config_locked', driftStatus: 'in_sync' },
  }));
  await page.route('**/api/admin/email-templates', (route) => json(route, [{
    id: 'template-warn', type: 'welcome', name: 'Welcome template', subject: 'Welcome',
    htmlTemplate: '<p>Welcome</p>', textTemplate: 'Welcome', variables: [], isActive: true,
    createdAt: now, updatedAt: now, ...ownership('config_warn', 'drifted'),
  }]));

  await page.route('**/api/authz/roles**', (route) => json(route, []));
  await page.route('**/api/authz/permissions**', (route) => json(route, []));
  await page.route('**/api/authz/role-assignments**', (route) => json(route, []));
  await page.route('**/api/authz/groups**', (route) => json(route, []));
  await page.route('**/api/authz/group-memberships**', (route) => json(route, []));
  await page.route('**/api/authz/engine-sets**', (route) => json(route, []));
  await page.route('**/api/authz/runtime-resources**', (route) => json(route, []));
  await page.route('**/api/authz/runtime-resource-sets**', (route) => json(route, []));
  await page.route('**/api/authz/project-engine-targets**', (route) => json(route, []));
  await page.route('**/api/authz/audit**', (route) => json(route, []));
  await page.route('**/api/identity/mappings', (route) => json(route, []));
  await page.route('**/engines-api/engines**', (route) => json(route, []));
  await page.route('**/api/admin/projects**', (route) => json(route, []));
  await page.route('**/api/admin/engines**', (route) => json(route, []));
  await page.route('**/api/authz/policies', (route) => json(route, [
    { id: 'policy-locked', name: 'Locked policy', effect: 'allow', priority: 10, conditions: {}, isActive: true, ...ownership('config_locked', 'in_sync') },
    { id: 'policy-warn', name: 'Review policy', effect: 'deny', priority: 20, conditions: {}, isActive: true, ...ownership('config_warn', 'drifted') },
  ]));
  await page.route('**/api/authz/api-clients', (route) => json(route, [{
    id: 'client-locked', name: 'Bundle client', tokenPrefix: 'eg_client', scopes: ['engine:register'],
    createdAt: now, lastUsedAt: null, isActive: true, ...ownership('config_locked', 'in_sync'),
  }]));
  await page.route('**/api/authz/service-accounts**', (route) => json(route, [{
    id: 'service-warn', name: 'Bundle service', description: null, tokenPrefix: 'eg_service',
    scopes: ['deployment:execute'], createdAt: now, lastUsedAt: null, isActive: true,
    ...ownership('config_warn', 'drifted'),
  }]));
  await page.route('**/api/authz/external-engine-systems**', (route) => json(route, [{
    id: 'system-locked', key: 'terraform', name: 'Terraform', description: null,
    defaultManagementMode: 'external_managed',
    defaultFieldOwnership: { connection: 'external', auth: 'external', display: 'manual' },
    isActive: true, ...ownership('config_locked', 'in_sync'),
  }]));
  await page.route('**/api/authz/external-engines**', (route) => json(route, []));
}

test('renders and enforces headless ownership across all administrator surfaces @headless-admin', async ({ page }) => {
  await installHeadlessAdminStack(page);

  await page.goto('/admin/settings/git');
  await expect(page.getByText('Git sync options are read-only', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Push (StarBase → Git)')).toBeDisabled();
  const lockedGit = page.getByText('Managed GitLab').locator('..');
  await expect(ownershipTag(lockedGit, 'Managed by configuration')).toBeVisible();
  await expect(lockedGit.getByRole('button', { name: 'Configure' })).toBeDisabled();
  const warnGit = page.getByText('Review GitHub').locator('..');
  await expect(ownershipTag(warnGit, 'Configuration-linked')).toBeVisible();
  await expect(ownershipTag(warnGit, 'Drifted')).toBeVisible();

  await page.goto('/admin/settings/email');
  const emailRow = page.getByText('Release email').locator('..');
  await expect(ownershipTag(emailRow, 'Managed by configuration')).toBeVisible();

  await page.goto('/admin/settings/email-templates');
  await expect(page.getByText('Email platform name is managed by configuration', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Email Platform Name')).toBeDisabled();
  const templateRow = page.getByText('Welcome template').locator('..');
  await expect(ownershipTag(templateRow, 'Configuration-linked')).toBeVisible();
  await expect(ownershipTag(templateRow, 'Drifted')).toBeVisible();

  await page.goto('/admin/access-control?tab=policies');
  const lockedPolicy = page.getByText('Locked policy').locator('..');
  await expect(ownershipTag(lockedPolicy, 'Managed by configuration')).toBeVisible();
  await lockedPolicy.getByRole('button', { name: 'Actions for Locked policy' }).click();
  await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeDisabled();
  const warnPolicy = page.getByText('Review policy').locator('..');
  await expect(ownershipTag(warnPolicy, 'Drifted')).toBeVisible();

  await page.goto('/admin/access-control?tab=external-registration');
  const clientRow = page.getByText('Bundle client').locator('..');
  await expect(ownershipTag(clientRow, 'Managed by configuration')).toBeVisible();
  await expect(clientRow.getByRole('button', { name: 'Rotate' })).toBeDisabled();
  await expect(clientRow.getByRole('button', { name: 'Revoke' })).toBeDisabled();
  const serviceRow = page.getByText('Bundle service').locator('..');
  await expect(ownershipTag(serviceRow, 'Configuration-linked')).toBeVisible();
  await expect(ownershipTag(serviceRow, 'Drifted')).toBeVisible();
  const systemRow = page.getByText('Terraform').locator('..');
  await expect(systemRow.getByRole('button', { name: 'Edit Terraform' })).toBeDisabled();
  await expect(systemRow.getByRole('button', { name: 'Archive Terraform' })).toBeDisabled();
});
