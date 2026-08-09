import { expect, test, type Page, type Route } from '@playwright/test';
import { MockBrowserIdentityStack } from './utils/mockIdentityStack';
import { captureManualScreenshot } from './utils/manualScreenshots';

const now = Date.UTC(2026, 6, 30, 8, 0, 0);
const user = {
  id: '00000000-0000-4000-8000-000000000020',
  email: 'operator@example.test',
  firstName: 'Operations',
  lastName: 'User',
};
const engine = {
  id: 'engine-operaton-production',
  name: 'Production Operaton',
  baseUrl: 'https://operaton.example.test/engine-rest',
  type: 'operaton',
  lifecycleStatus: 'active',
};
const engineSet = {
  id: 'engine-set-production',
  tenantId: 'default',
  key: 'production',
  name: 'Production engines',
  description: 'Customer-facing workflow engines',
  selector: { mode: 'engine_ids', engineIds: [engine.id] },
  selectorFingerprint: 'gallery-production',
  source: 'manual',
  sourceRef: null,
  ownershipMode: 'manual',
  isArchived: false,
  createdAt: now,
  updatedAt: now,
};
const roles = [
  {
    id: 'system.tenant.viewer',
    key: 'system.tenant.viewer',
    name: 'Tenant Viewer',
    description: 'Read tenant and engine information.',
    scope: 'engine',
    kind: 'system',
    isEditable: false,
    isAssignable: true,
    isArchived: false,
    permissionCount: 6,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'custom.engine.operator',
    key: 'custom.engine.operator',
    name: 'Workflow Operator',
    description: 'Operate assigned workflow engines.',
    scope: 'engine',
    kind: 'custom',
    isEditable: true,
    isAssignable: true,
    isArchived: false,
    permissionCount: 3,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'system.platform.viewer',
    key: 'system.platform.viewer',
    name: 'Platform Viewer',
    description: 'Read platform information.',
    scope: 'platform',
    kind: 'system',
    isEditable: false,
    isAssignable: true,
    isArchived: false,
    permissionCount: 3,
    createdAt: now,
    updatedAt: now,
  },
];
const permissions = [
  {
    key: 'engine:instance:view',
    label: 'View process instances',
    description: 'View process instances without changing runtime state.',
    scope: 'engine',
    category: 'Mission Control',
    kind: 'system',
  },
  {
    key: 'engine:variables:view',
    label: 'View process variable values',
    description: 'View non-sensitive process variable values.',
    scope: 'engine',
    category: 'Mission Control variables',
    kind: 'system',
  },
  {
    key: 'engine:variables:edit',
    label: 'Edit process variable values',
    description: 'Change process variable values for an assigned engine.',
    scope: 'engine',
    category: 'Mission Control variables',
    kind: 'system',
  },
  {
    key: 'platform:settings:view',
    label: 'View platform settings',
    description: 'View global platform settings.',
    scope: 'platform',
    category: 'Platform administration',
    kind: 'system',
  },
];
const groups = [
  {
    id: 'group-platform-administrators',
    key: 'platform-administrators',
    name: 'Platform administrators',
    description: 'Canonical platform administrator membership.',
    source: 'system',
    sourceRef: 'bootstrap',
    ownershipMode: 'config_locked',
    sourceHash: null,
    lastAppliedAt: now,
    driftStatus: null,
    isSystem: true,
    isArchived: false,
    createdById: null,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'group-operations',
    key: 'operations',
    name: 'Operations',
    description: 'Manually managed operations users.',
    source: 'manual',
    sourceRef: null,
    ownershipMode: 'manual',
    sourceHash: null,
    lastAppliedAt: null,
    driftStatus: null,
    isSystem: false,
    isArchived: false,
    createdById: 'browser-admin-user',
    createdAt: now,
    updatedAt: now,
  },
];
const memberships = [
  {
    id: 'membership-bootstrap',
    groupId: groups[0].id,
    groupKey: groups[0].key,
    groupName: groups[0].name,
    userId: user.id,
    userDisplayName: 'Operations User',
    userEmail: user.email,
    source: 'system',
    sourceRef: 'bootstrap:initial-admin',
    expiresAt: null,
    createdById: null,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'membership-manual',
    groupId: groups[0].id,
    groupKey: groups[0].key,
    groupName: groups[0].name,
    userId: user.id,
    userDisplayName: 'Operations User',
    userEmail: user.email,
    source: 'manual',
    sourceRef: 'admin:break-glass-review',
    expiresAt: null,
    createdById: 'browser-admin-user',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'membership-operations-manual',
    groupId: groups[1].id,
    groupKey: groups[1].key,
    groupName: groups[1].name,
    userId: user.id,
    userDisplayName: 'Operations User',
    userEmail: user.email,
    source: 'manual',
    sourceRef: 'admin:operations',
    expiresAt: null,
    createdById: 'browser-admin-user',
    createdAt: now,
    updatedAt: now,
  },
];
const projectTarget = {
  id: 'project-target-payments',
  projectId: 'project-payments',
  projectName: 'Payments automation',
  engineId: engine.id,
  engineName: engine.name,
  environmentId: 'production',
  environment: { id: 'production', name: 'Production' },
  status: 'active',
  source: 'manual',
  sourceRef: null,
  ownershipMode: 'manual',
  driftStatus: null,
  allowManualDeploy: true,
  allowCiDeploy: true,
  allowApiDeploy: false,
  allowImport: false,
  approvalStatus: 'approved',
  policyTags: ['production'],
  createdAt: now,
  updatedAt: now,
};

const json = (route: Route, body: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function installGalleryStack(page: Page): Promise<void> {
  const stack = new MockBrowserIdentityStack();
  await stack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');
  await page.route('**/api/authz/me/permissions', (route) => json(route, {
    userId: 'browser-admin-user',
    tenantId: null,
    platform: [
      'platform:dashboard:view',
      'platform:settings:view',
      'platform:settings:manage',
      'platform:user:manage',
      'platform:user:view',
      'platform:users:view',
      'platform:users:create',
      'platform:users:update',
      'platform:users:deactivate',
      'platform:users:delete',
      'platform:users:permanent-delete',
      'platform:users:unlock',
      'platform:authz:roles:view',
      'platform:authz:roles:manage',
      'platform:authz:permissions:view',
      'platform:authz:assignments:view',
      'platform:authz:assignments:create',
      'platform:authz:assignments:delete',
      'platform:authz:groups:view',
      'platform:authz:groups:manage',
      'platform:authz:check',
      'platform:authz:policies:view',
      'platform:authz:policies:manage',
      'platform:engine-sets:view',
      'platform:engine-sets:manage',
      'platform:project-engine-targets:view',
      'platform:project-engine-targets:manage',
      'platform:audit:view',
      'platform:sso-providers:view',
      'platform:sso-providers:manage',
      'platform:sso-assignments:view',
      'platform:sso-assignments:manage',
    ],
    projects: [],
    engines: [{
      resourceId: engine.id,
      permissions: ['engine:instance:view'],
      runtimePermissions: [],
    }],
    generatedAt: now,
    authorizationVersion: 'carbon-gallery-v1',
  }));
  await page.route('**/api/authz/roles', (route) => json(route, roles));
  await page.route('**/api/authz/permissions', (route) => json(route, permissions));
  await page.route('**/api/authz/role-assignments**', (route) => json(route, [{
    id: 'assignment-operator',
    principalType: 'user',
    principalId: user.id,
    userId: user.id,
    principalDisplayName: 'Operations User',
    principalSecondary: `${user.email} · ${user.id}`,
    roleId: roles[1].id,
    roleKey: roles[1].key,
    roleName: roles[1].name,
    resourceType: 'engine_set',
    resourceId: engineSet.id,
    resourceDisplayName: engineSet.name,
    resourceSecondary: `${engineSet.key} · ${engineSet.id}`,
    source: 'sso',
    sourceRef: 'identity.oidc.browser-mock/operators',
    expiresAt: null,
    createdAt: now,
  }]));
  await page.route('**/api/authz/groups**', (route) => json(route, [groups[1], groups[0]]));
  await page.route('**/api/authz/group-memberships**', (route) => json(route, memberships));
  await page.route('**/api/authz/engine-sets**', (route) => json(route, [engineSet]));
  await page.route('**/api/authz/project-engine-targets**', (route) => json(route, [projectTarget]));
  await page.route('**/api/authz/runtime-resources**', (route) => json(route, []));
  await page.route('**/api/authz/runtime-resource-sets**', (route) => json(route, []));
  await page.route('**/api/authz/policies', (route) => json(route, []));
  await page.route('**/api/authz/audit**', (route) => json(route, []));
  await page.route('**/api/authz/api-clients', (route) => json(route, []));
  await page.route('**/api/authz/service-accounts**', (route) => json(route, []));
  await page.route('**/api/authz/external-engines**', (route) => json(route, []));
  await page.route('**/api/authz/external-engine-systems**', (route) => json(route, []));
  await page.route('**/api/identity/mappings', (route) => json(route, []));
  await page.route('**/engines-api/engines', (route) => json(route, [engine]));
  await page.route('**/engines-api/saved-filters**', (route) => json(route, []));
  await page.route('**/mission-control-api/process-definitions**', (route) => json(route, []));
  await page.route('**/mission-control-api/process-instances**', (route) => json(route, []));
  await page.route('**/api/admin/projects**', (route) => json(route, [{
    id: projectTarget.projectId,
    name: projectTarget.projectName,
  }]));
  await page.route('**/api/admin/users/search**', (route) => json(route, [user]));
}

test.describe('Carbon UX screenshot gallery', () => {
  test.setTimeout(90_000);

  test('captures user access ownership without the dashboard @carbon-gallery', async ({ page }) => {
    await installGalleryStack(page);
    await page.route('**/api/users', (route) => json(route, [
      {
        ...user,
        platformRole: 'user',
        authProvider: 'oidc',
        isActive: true,
        isEmailVerified: true,
        adminStatus: 'active',
        createdAt: now,
      },
      {
        id: 'browser-admin-user',
        email: 'browser.admin@example.test',
        firstName: 'Browser',
        lastName: 'Admin',
        platformRole: 'admin',
        authProvider: 'local',
        isActive: true,
        isEmailVerified: true,
        adminStatus: 'active',
        createdAt: now,
      },
    ]));
    await page.route('**/api/t/default/invitations/capabilities', (route) => json(route, {
      ssoRequired: true,
      emailConfigured: true,
    }));

    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Access source' })).toBeVisible();
    await expect(page.getByText('SSO-managed', { exact: true })).toBeVisible();
    await captureManualScreenshot(page, '02-user-management-platform-role.jpg');
  });

  test('captures human-readable role, permission, assignment, group, and scope flows @carbon-gallery', async ({ page }) => {
    await installGalleryStack(page);
    let evaluationCount = 0;
    await page.route('**/api/authz/evaluate', async (route) => {
      evaluationCount += 1;
      const allowed = evaluationCount === 1;
      await json(route, {
        allowed,
        reason: allowed
          ? 'Allowed by the Workflow Operator assignment for Production engines.'
          : 'Denied because no active assignment grants this permission.',
        sources: allowed ? [{
          type: 'role_assignment',
          assignmentId: 'assignment-operator',
          roleId: roles[1].id,
          roleName: roles[1].name,
          principalType: 'user',
          principalId: user.id,
          resourceType: 'engine_set',
          resourceId: engineSet.id,
          permission: permissions[0].key,
          source: 'sso',
          sourceRef: 'identity.oidc.browser-mock/operators',
        }] : [],
      });
    });

    await page.goto('/admin/access-control');
    await expect(page.getByRole('heading', { name: 'Access Control' })).toBeVisible();

    const roleSearch = page.getByPlaceholder('Search roles');
    await roleSearch.fill('Tenant Viewer');
    await expect(page.getByRole('cell', { name: 'Tenant Viewer', exact: true })).toBeVisible();
    await captureManualScreenshot(page, '03-role-catalog-system.jpg');

    await page.getByRole('button', { name: 'Create role', exact: true }).click();
    await page.getByLabel('Role name', { exact: true }).fill('Production workflow reviewer');
    await page.getByRole('textbox', { name: /^Permissions/ }).fill('process');
    await captureManualScreenshot(page, '04-custom-role-editor-engine-permissions.jpg');
    await page.getByRole('combobox', { name: 'Role scope', exact: true }).click();
    await expect(page.getByRole('option', { name: 'Platform', exact: true })).toBeVisible();
    await captureManualScreenshot(page, '05-custom-role-scope-selector.jpg');
    await page.getByRole('option', { name: 'Platform', exact: true }).click();
    await captureManualScreenshot(page, '06-custom-role-editor-platform-permissions.jpg');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.getByRole('tab', { name: 'Permissions', exact: true }).click();
    const permissionSearch = page.getByRole('searchbox', { name: 'Filter table' });
    await permissionSearch.fill('variable');
    await expect(page.getByText('View process variable values', { exact: true }).first()).toBeVisible();
    await captureManualScreenshot(page, '07-permission-catalog-variable-view.jpg');
    await permissionSearch.fill('Edit process variable values');
    await expect(page.getByText('Edit process variable values', { exact: true }).first()).toBeVisible();
    await captureManualScreenshot(page, '08-permission-catalog-variable-edit.jpg');

    await page.getByRole('tab', { name: 'Assignments', exact: true }).click();
    await page.getByRole('textbox', { name: 'User', exact: true }).fill('operator');
    await page.getByRole('button', { name: /Operations User.*operator@example\.test/ }).click();
    await page.getByRole('combobox', { name: 'Access target', exact: true }).click();
    await page.getByRole('option', { name: 'Engine set', exact: true }).click();
    await page.getByRole('combobox', { name: 'Engine set', exact: true }).click();
    await page.getByRole('option', { name: 'Production engines (production)', exact: true }).click();
    await page.getByRole('combobox', { name: 'Role', exact: true }).click();
    await page.getByRole('option', { name: 'Workflow Operator', exact: true }).click();
    await captureManualScreenshot(page, '09-role-assignments.jpg');

    await page.getByRole('tab', { name: 'Effective Access', exact: true }).click();
    await page.getByRole('textbox', { name: 'User', exact: true }).fill('operator');
    await page.getByRole('button', { name: /Operations User.*operator@example\.test/ }).click();
    await page.getByRole('combobox', { name: 'Resource type', exact: true }).click();
    await page.getByRole('option', { name: 'Engine set', exact: true }).click();
    await page.getByRole('combobox', { name: 'Engine set', exact: true }).click();
    await page.getByRole('option', { name: 'Production engines (production)', exact: true }).click();
    await page.getByRole('combobox', { name: 'Permission', exact: true }).click();
    await page.getByRole('option', { name: /View process instances/ }).click();
    await page.getByRole('button', { name: 'Check access', exact: true }).click();
    await expect(page.getByText('Access is allowed', { exact: true })).toBeVisible();
    await expect(page.getByText('The Workflow Operator assignment grants access to Production engines.', { exact: true })).toBeVisible();
    await captureManualScreenshot(page, '10-effective-access-platform-allow.jpg');
    await page.getByRole('button', { name: 'Check access', exact: true }).click();
    await expect(page.getByText('Access is denied', { exact: true })).toBeVisible();
    await expect(page.getByText('No active assignment grants this permission.', { exact: true })).toBeVisible();
    await expect(page.getByText(/Denied because no active assignment/)).toHaveCount(0);
    await captureManualScreenshot(page, '11-effective-access-platform-deny.jpg');
    await page.getByRole('combobox', { name: 'Resource type', exact: true }).click();
    await page.getByRole('option', { name: 'Tenant', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Permission', exact: true })).toBeDisabled();
    await expect(page.getByText('No compatible permissions', { exact: true })).toBeVisible();
    await expect(page.getByText('No permissions available for Tenant', { exact: true })).toBeVisible();
    await expect(page.getByText('Access is denied', { exact: true })).toHaveCount(0);
    await captureManualScreenshot(page, '82-effective-access-no-compatible-permissions.jpg');

    await page.getByRole('tab', { name: 'Groups', exact: true }).click();
    await expect(page.getByText('Operations members', { exact: true })).toBeVisible();
    await captureManualScreenshot(page, '12-authorization-groups.jpg');
    await page.getByRole('button', { name: 'Actions for Platform administrators', exact: true }).click();
    await page.getByRole('menuitem', { name: 'View members', exact: true }).click();
    await expect(page.getByText('Platform administrators members', { exact: true })).toBeVisible();
    await expect(page.getByText('Membership is managed elsewhere', { exact: true })).toBeVisible();
    await expect(page.getByText('Initial platform administrator', { exact: true })).toBeVisible();
    await expect(page.getByText('Administrator recovery review', { exact: true })).toBeVisible();
    await captureManualScreenshot(page, '13-group-membership-platform-administrators.jpg');
    await page.getByRole('button', { name: 'Actions for Operations', exact: true }).click();
    await page.getByRole('menuitem', { name: 'View members', exact: true }).click();
    await page.getByRole('button', { name: 'Remove group member', exact: true }).click();
    const removeMemberDialog = page.getByRole('dialog', { name: 'Remove manual group member' });
    await expect(removeMemberDialog).toContainText('Operations User');
    await expect(removeMemberDialog).toContainText('operator@example.test');
    await expect(removeMemberDialog).toContainText(user.id);
    await captureManualScreenshot(page, '83-group-member-removal-human-labels.jpg');
    await removeMemberDialog.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('tab', { name: 'Runtime Resources', exact: true }).click();
    await expect(page.getByText('No runtime resources recorded', { exact: true })).toBeVisible();
    await captureManualScreenshot(page, '14-runtime-resource-controls-empty-state.jpg');

    await page.getByRole('tab', { name: 'Engine sets', exact: true }).click();
    await page.getByRole('button', { name: 'Create engine set', exact: true }).click();
    await page.getByLabel('Engine set name', { exact: true }).fill('Regulated production engines');
    await page.getByLabel('Label key', { exact: true }).fill('environment');
    await page.getByLabel('Label value', { exact: true }).fill('production');
    await page.getByRole('dialog', { name: 'Create engine set', exact: true })
      .locator('.cds--modal-content')
      .evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(page.getByRole('combobox', { name: 'Label match', exact: true })).toBeVisible();
    await captureManualScreenshot(page, '15-engine-set-editor.jpg');
    await page.keyboard.press('Escape');

    await page.getByRole('tab', { name: 'Project Targets', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'Payments automation', exact: true })).toBeVisible();
    await captureManualScreenshot(page, '16-project-target-controls.jpg');
  });

  test('captures the separated engine-governance modes and focused custom-role editor @carbon-gallery', async ({ page }) => {
    await installGalleryStack(page);
    let gallerySettings = {
      defaultEnvironmentTagId: 'environment-production',
      syncPushEnabled: true,
      syncPullEnabled: true,
      gitProjectTokenSharingEnabled: false,
      defaultDeployRoles: ['owner', 'delegate'],
      engineOnboardingMode: 'hybrid',
      projectEngineTargetMode: 'manual_allowed',
      engineAccessAuthority: 'transition_to_sso',
      projectAccessAuthority: 'manual',
      engineRuntimeAuthorizationMode: 'mirrored_engine_backstop',
      accessGovernanceSourceRef: null,
      accessGovernanceOwnershipMode: 'manual',
      accessGovernanceSourceHash: null,
      accessGovernanceLastAppliedAt: null,
      accessGovernanceDriftStatus: null,
      governanceBehavior: {
        manualEngineAccessMutationsAllowed: true,
        manualProjectAccessMutationsAllowed: true,
        manualEngineRegistrationAllowed: true,
        manualProjectEngineTargetMutationsAllowed: true,
        governanceSettingsMutations: 'allowed',
      },
      credentiallessCustomerSidecarsEnabled: true,
      inviteAllowAllDomains: true,
      inviteAllowedDomains: [],
      ssoAllEnginesAssignmentMappingsEnabled: false,
      ssoEngineOwnerAssignmentMappingsEnabled: false,
      ssoEngineDelegateAssignmentMappingsEnabled: false,
      ssoRegexClaimMappingsEnabled: false,
      ssoBroadEntitlementMappingsEnabled: false,
      ssoSecretViewMappingsEnabled: false,
      ssoUnredactedAuditMappingsEnabled: false,
      ssoPermanentDeleteMappingsEnabled: false,
      piiRegexEnabled: true,
      piiExternalProviderEnabled: false,
      piiExternalProviderType: null,
      piiExternalProviderEndpoint: null,
      piiExternalProviderAuthHeader: null,
      piiExternalProviderAuthToken: null,
      piiExternalProviderProjectId: null,
      piiExternalProviderRegion: null,
      piiRedactionStyle: 'mask',
      piiScopes: ['processDetails', 'history'],
      piiMaxPayloadSizeBytes: 1_000_000,
    };
    await page.route('**/api/admin/settings', async (route) => {
      if (route.request().method() === 'PUT') {
        gallerySettings = { ...gallerySettings, ...route.request().postDataJSON() };
        return json(route, { success: true });
      }
      return json(route, gallerySettings);
    });
    await page.route('**/api/admin/engines**', (route) => json(route, [{
      id: engine.id,
      name: engine.name,
      type: engine.type,
      ownerEmail: null,
      ownerName: null,
      delegateEmail: null,
      delegateName: null,
      createdAt: now,
    }]));
    await page.route('**/api/admin/environments', (route) => json(route, [{
      id: 'environment-production',
      name: 'Production',
      color: '#0F62FE',
      manualDeployAllowed: false,
      sortOrder: 1,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    }]));
    await page.route('**/api/authz/roles/custom.engine.operator', (route) => json(route, {
      ...roles[1],
      source: 'manual',
      sourceRef: null,
      ownershipMode: 'manual',
      sourceHash: null,
      lastAppliedAt: null,
      driftStatus: null,
      permissions: [
        'engine:instance:view',
        'engine:variables:view',
        'engine:variables:edit',
      ],
    }));

    await page.goto('/admin/settings');
    await page.getByRole('tab', { name: 'Engines', exact: true }).click();
    await expect(page.getByText('Changes save automatically.', { exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Hybrid ownership/ })).toBeChecked();
    await captureManualScreenshot(page, '29-engine-onboarding-and-authorization-modes.jpg');

    const runtimeEnforcement = page.getByRole('heading', { name: 'Runtime enforcement', exact: true });
    await runtimeEnforcement.scrollIntoViewIfNeeded();
    await expect(page.getByRole('radio', { name: /EnterpriseGlue with engine read-access backup/ })).toBeChecked();
    await page.locator('#engine-runtime-authorization-mode-enterpriseglue_authoritative')
      .evaluate((element: HTMLInputElement) => element.click());
    await expect(page.getByRole('radio', { name: /EnterpriseGlue only/ })).toBeChecked();
    await expect(page.getByText('EnterpriseGlue checks every request', { exact: true })).toBeVisible();
    await captureManualScreenshot(page, '30-runtime-authorization-mode-options.jpg');

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);
    await captureManualScreenshot(page, '74-engine-governance-modes-200-percent-zoom.jpg', { stabilize: false });

    await page.evaluate(() => { document.documentElement.style.zoom = '1'; });
    await page.setViewportSize({ width: 768, height: 900 });
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);
    await captureManualScreenshot(page, '75-engine-governance-modes-narrow.jpg', { stabilize: false });
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.getByRole('tab', { name: 'Role Library', exact: true }).click();
    await page.getByRole('button', { name: /Workflow Operator/ }).click();
    await expect(page.locator('#role-library-edit-name')).toHaveValue('Workflow Operator');
    await expect(page.getByText('3 selected', { exact: true }).first()).toBeVisible();
    await captureManualScreenshot(page, '31-role-library-custom-role-editor.jpg');

    await page.goto('/mission-control/processes');
    const engineSelector = page.getByRole('combobox', { name: 'Engine', exact: true });
    await expect(engineSelector).toContainText('Production Operaton');
    await engineSelector.click();
    await expect(page.getByRole('option', { name: /Production Operaton.*engine-operaton-production/ })).toBeVisible();
    await captureManualScreenshot(page, '40-mission-control-scoped-runtime-picker.jpg');
  });
});
