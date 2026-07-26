import { expect, test, type Page, type Route } from '@playwright/test';
import { MockBrowserIdentityStack } from './utils/mockIdentityStack';

const engine = { id: 'grant-engine', name: 'Grant target engine', lifecycleStatus: 'active' };
const engineSet = {
  id: 'grant-engine-set', tenantId: 'default', key: 'production', name: 'Production engines', description: null,
  selector: { mode: 'engine_ids' as const, engineIds: [engine.id] }, selectorFingerprint: 'grant-engine-set-fingerprint',
  source: 'manual' as const, sourceRef: null, ownershipMode: 'manual' as const, isArchived: false,
  createdAt: Date.now(), updatedAt: Date.now(),
};
const runtimeResource = { id: 'grant-runtime-resource', engineId: engine.id, resourceKey: 'invoice-process', resourceKind: 'process_definition', isActive: true };
const runtimeResourceSet = { id: 'grant-runtime-resource-set', engineId: engine.id, key: 'invoices', name: 'Invoice resources', resourceKind: 'process_definition', isArchived: false };
const roles = [
  { id: 'grant-platform-viewer', key: 'platform-viewer', name: 'Platform Viewer', scope: 'platform', kind: 'system', isAssignable: true, isArchived: false },
  { id: 'grant-tenant-viewer', key: 'tenant-viewer', name: 'Tenant Viewer', scope: 'tenant', kind: 'system', isAssignable: true, isArchived: false },
  { id: 'grant-project-viewer', key: 'project-viewer', name: 'Project Viewer', scope: 'project', kind: 'system', isAssignable: true, isArchived: false },
  { id: 'grant-engine-viewer', key: 'engine-viewer', name: 'Engine Viewer', scope: 'engine', kind: 'system', isAssignable: true, isArchived: false },
  { id: 'system.engine.operator', key: 'engine-operator', name: 'Engine Operator', scope: 'engine', kind: 'system', isAssignable: true, isArchived: false },
];
const group = { id: 'grant-group', key: 'grant-operators', name: 'Grant operators', isArchived: false };
const apiClient = { id: 'grant-api-client', name: 'Grant API client', isActive: true };
const serviceAccount = { id: 'grant-service-account', name: 'Grant service account', isActive: true };
type CreatedPolicy = Record<string, unknown> & { id: string; name: string; isActive: boolean };

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function openAssignments(page: Page): Promise<Array<Record<string, unknown>>> {
  const identityStack = new MockBrowserIdentityStack();
  await identityStack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');
  const created: Array<Record<string, unknown>> = [];
  await page.route('**/api/authz/roles', (route) => json(route, roles));
  await page.route('**/api/authz/permissions', (route) => json(route, []));
  await page.route('**/api/authz/groups', (route) => json(route, [group]));
  await page.route('**/api/authz/group-memberships', (route) => json(route, []));
  await page.route('**/api/authz/api-clients', (route) => json(route, [apiClient]));
  await page.route('**/api/authz/service-accounts**', (route) => json(route, [serviceAccount]));
  await page.route('**/api/authz/external-engines', (route) => json(route, []));
  await page.route('**/api/authz/external-engine-systems', (route) => json(route, []));
  await page.route('**/api/authz/engine-sets**', (route) => json(route, [engineSet]));
  await page.route('**/api/authz/project-engine-targets**', (route) => json(route, []));
  await page.route('**/api/authz/policies', (route) => json(route, []));
  await page.route('**/api/identity/mappings', (route) => json(route, []));
  await page.route('**/api/authz/runtime-resources**', (route) => json(route, [runtimeResource]));
  await page.route('**/api/authz/runtime-resource-sets**', (route) => json(route, [runtimeResourceSet]));
  await page.route('**/engines-api/engines', (route) => json(route, [engine]));
  await page.route('**/api/authz/role-assignments', async (route) => {
    if (route.request().method() === 'POST') {
      const request = route.request().postDataJSON() as Record<string, unknown>;
      created.push(request);
      return json(route, { id: `assignment-${created.length}`, ...request }, 201);
    }
    return json(route, created.map((assignment, index) => ({ id: `assignment-${index + 1}`, ...assignment, createdAt: Date.now() })));
  });

  await page.goto('/admin/access-control');
  await expect(page.getByRole('heading', { name: 'Access Control' })).toBeVisible();
  await page.getByRole('tab', { name: 'Assignments', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Assign Role', exact: true })).toBeVisible();
  return created;
}

async function selectOption(page: Page, name: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function chooseEngineScopeTarget(page: Page, type: 'engine' | 'engine_set' | 'engine_runtime_resource' | 'engine_runtime_resource_set', roleName = 'Engine Viewer'): Promise<void> {
  const label = {
    engine: 'Engine',
    engine_set: 'Engine Set',
    engine_runtime_resource: 'Runtime resource',
    engine_runtime_resource_set: 'Runtime resource set',
  }[type];
  await selectOption(page, 'Scope', label);
  if (type === 'engine') {
    await page.getByRole('textbox', { name: 'Resource ID', exact: true }).fill(engine.id);
  } else if (type === 'engine_set') {
    await selectOption(page, 'Engine Set', `${engineSet.name} (${engineSet.key})`);
  } else {
    await selectOption(page, 'Engine', engine.name);
    if (type === 'engine_runtime_resource') await selectOption(page, 'Runtime resource', 'invoice-process (process)');
    else await selectOption(page, 'Runtime resource set', 'Invoice resources (process_definition)');
  }
  await selectOption(page, 'Role', roleName);
}

test.describe('Access Control direct resource grants', () => {
  test('creates direct user grants for engine, Engine Set, runtime resource, and runtime-resource-set scopes', async ({ page }) => {
    const created = await openAssignments(page);
    await page.getByRole('textbox', { name: 'User ID', exact: true }).fill('grant-user');

    for (const type of ['engine', 'engine_set', 'engine_runtime_resource', 'engine_runtime_resource_set'] as const) {
      await chooseEngineScopeTarget(page, type);
      await page.getByRole('button', { name: 'Assign Role', exact: true }).click();
      await expect.poll(() => created.length).toBe(['engine', 'engine_set', 'engine_runtime_resource', 'engine_runtime_resource_set'].indexOf(type) + 1);
      expect(created.at(-1)).toEqual(expect.objectContaining({
        principalType: 'user', principalId: 'grant-user', roleId: 'grant-engine-viewer', resourceType: type,
        resourceId: type === 'engine' ? engine.id : type === 'engine_set' ? engineSet.id : type === 'engine_runtime_resource' ? runtimeResource.id : runtimeResourceSet.id,
      }));
    }
  });

  test('keeps the Engine Set grant available for group, API client, and service-account principals', async ({ page }) => {
    const created = await openAssignments(page);
    for (const principal of [
      { type: 'Group', select: () => selectOption(page, 'Group', group.name), id: group.id },
      { type: 'API client', select: () => selectOption(page, 'API client', apiClient.name), id: apiClient.id },
      { type: 'Service account', select: () => selectOption(page, 'Service account', serviceAccount.name), id: serviceAccount.id },
    ]) {
      await selectOption(page, 'Principal', principal.type);
      await principal.select();
      await chooseEngineScopeTarget(page, 'engine_set', principal.type === 'Group' ? 'Engine Viewer' : 'Engine Operator');
      await page.getByRole('button', { name: 'Assign Role', exact: true }).click();
      await expect.poll(() => created.length).toBeGreaterThan(0);
      expect(created.at(-1)).toEqual(expect.objectContaining({ principalId: principal.id, resourceType: 'engine_set', resourceId: engineSet.id }));
    }
  });
});

test.describe('Access Control resource-type policies', () => {
  test('creates allow and deny policies for the supported resource types with validated JSON conditions', async ({ page }) => {
    const identityStack = new MockBrowserIdentityStack();
    await identityStack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');
    const created: CreatedPolicy[] = [];
    await page.route('**/api/authz/roles', (route) => json(route, roles));
    await page.route('**/api/authz/permissions', (route) => json(route, []));
    await page.route('**/api/authz/groups', (route) => json(route, []));
    await page.route('**/api/authz/group-memberships', (route) => json(route, []));
    await page.route('**/api/authz/api-clients', (route) => json(route, []));
    await page.route('**/api/authz/service-accounts**', (route) => json(route, []));
    await page.route('**/api/authz/external-engines', (route) => json(route, []));
    await page.route('**/api/authz/external-engine-systems', (route) => json(route, []));
    await page.route('**/api/authz/engine-sets**', (route) => json(route, [engineSet]));
    await page.route('**/api/authz/project-engine-targets**', (route) => json(route, []));
    await page.route('**/api/identity/mappings', (route) => json(route, []));
    await page.route('**/api/authz/runtime-resources**', (route) => json(route, [runtimeResource]));
    await page.route('**/api/authz/runtime-resource-sets**', (route) => json(route, [runtimeResourceSet]));
    await page.route('**/engines-api/engines', (route) => json(route, [engine]));
    await page.route('**/api/authz/role-assignments', (route) => json(route, []));
    await page.route('**/api/authz/policies', async (route) => {
      if (route.request().method() === 'POST') {
        const request = route.request().postDataJSON() as Record<string, unknown>;
        const policy = { id: `policy-${created.length + 1}`, ...request, isActive: true } as CreatedPolicy;
        created.push(policy);
        return json(route, { id: policy.id }, 201);
      }
      return json(route, created);
    });

    await page.goto('/admin/access-control');
    await expect(page.getByRole('heading', { name: 'Access Control' })).toBeVisible();
    await page.getByRole('tab', { name: 'Policies', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add Policy', exact: true })).toBeVisible();

    const scenarios = [
      { name: 'Allow production engine set', effect: 'Allow', resource: 'Engine Set', resourceType: 'engine_set', action: 'engine:instance:view', conditions: { tenantId: 'default', engineSetKey: 'production' } },
      { name: 'Deny payroll runtime resource', effect: 'Deny', resource: 'Runtime resource', resourceType: 'engine_runtime_resource', action: 'engine:instance:view', conditions: { resourceKey: 'payroll' } },
      { name: 'Allow current tenant administration', effect: 'Allow', resource: 'Current tenant', resourceType: 'tenant', action: 'tenant:read', conditions: { tenantId: 'default' } },
      { name: 'Deny runtime resource set suspension', effect: 'Deny', resource: 'Runtime resource set', resourceType: 'engine_runtime_resource_set', action: 'engine:instance:suspend', conditions: { resourceSetKey: 'sensitive' } },
      { name: 'Allow external engine system audit', effect: 'Allow', resource: 'External engine system', resourceType: 'external_engine_system', action: 'engine:audit:view', conditions: { systemKey: 'customer-sidecar' } },
    ];

    for (const scenario of scenarios) {
      await page.getByRole('button', { name: 'Add Policy', exact: true }).click();
      await page.getByRole('textbox', { name: 'Policy name', exact: true }).fill(scenario.name);
      await selectOption(page, 'Effect', scenario.effect);
      await selectOption(page, 'Resource', scenario.resource);
      await page.getByRole('textbox', { name: 'Action or permission', exact: true }).fill(scenario.action);
      await page.getByRole('textbox', { name: 'Conditions JSON', exact: true }).fill(JSON.stringify(scenario.conditions));
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await expect.poll(() => created.length).toBe(scenarios.indexOf(scenario) + 1);
      expect(created.at(-1)).toEqual(expect.objectContaining({
        name: scenario.name,
        effect: scenario.effect.toLowerCase(),
        resourceType: scenario.resourceType,
        action: scenario.action,
        conditions: scenario.conditions,
      }));
    }

    await page.getByRole('button', { name: 'Add Policy', exact: true }).click();
    await page.getByRole('textbox', { name: 'Policy name', exact: true }).fill('Invalid condition guard');
    await page.getByRole('textbox', { name: 'Conditions JSON', exact: true }).fill('{not-valid-json');
    const create = page.getByRole('button', { name: 'Create', exact: true });
    await expect(create).toBeDisabled();
    await expect(page.getByText('Conditions must be valid JSON.', { exact: true })).toBeVisible();
  });

  test('keeps the Policies panel paired with its tab when a preceding panel is unavailable', async ({ page }) => {
    const identityStack = new MockBrowserIdentityStack();
    await identityStack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');
    await page.route('**/api/authz/me/permissions', (route) => json(route, {
      userId: 'browser-admin-user',
      tenantId: null,
      platform: [
        'platform:authz:roles:view', 'platform:authz:roles:manage', 'platform:authz:check',
        'platform:engine-sets:view',
      ],
      projects: [], engines: [], generatedAt: Date.now(), authorizationVersion: 'policy-tab-regression',
    }));
    await page.route('**/api/authz/policies', (route) => json(route, []));

    await page.goto('/admin/access-control');
    await expect(page.getByRole('tab', { name: 'Project Targets', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Policies', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Policies', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add Policy', exact: true })).toBeVisible();
    await expect(page.getByText('No authorization policies are configured.', { exact: true })).toBeVisible();
  });
});
