import { expect, test, type Page, type Route } from '@playwright/test';
import { MockBrowserIdentityStack } from './utils/mockIdentityStack';
import { captureManualScreenshot } from './utils/manualScreenshots';

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const permissions = [
  { key: 'engine:instance:view', scope: 'engine', category: 'Runtime', label: 'View instances', description: 'View runtime state.', tenantSafe: true },
  { key: 'engine:instance:retry', scope: 'engine', category: 'Runtime', label: 'Retry instances', description: 'Retry failed instances.', tenantSafe: true },
  { key: 'engine:members:manage', scope: 'engine', category: 'Access', label: 'Manage members', description: 'Change membership.', tenantSafe: false },
];
const roles = [
  { id: 'system.engine.runtime_viewer', key: 'system.engine.runtime_viewer', name: 'Runtime Viewer', description: 'Read runtime state.', scope: 'engine', kind: 'system', isAssignable: true, isEditable: false, isArchived: false, permissionCount: 1 },
  { id: 'custom.runtime', key: 'custom.runtime', name: 'Custom Runtime', description: 'Custom runtime role.', scope: 'engine', kind: 'custom', isAssignable: true, isEditable: true, isArchived: false, permissionCount: 1 },
];

async function fixture(page: Page) {
  await new MockBrowserIdentityStack().install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');
  const mutations: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  const policies: Array<Record<string, unknown>> = [];
  let failSave = false;
  const lists: Record<string, unknown> = {
    '/api/authz/roles': roles, '/api/authz/permissions': permissions,
    '/api/authz/role-assignments': [], '/api/authz/groups': [], '/api/authz/group-memberships': [],
    '/api/authz/api-clients': [], '/api/authz/service-accounts': [], '/api/authz/external-engines': [],
    '/api/authz/external-engine-systems': [], '/api/authz/engine-sets': [],
    '/api/authz/project-engine-targets': [], '/api/identity/mappings': [],
    '/api/admin/engines': [{ id: 'central-prod', name: 'Central PROD', lifecycleStatus: 'active' }],
    '/engines-api/engines': [{ id: 'central-prod', name: 'Central PROD', lifecycleStatus: 'active' }],
    '/api/admin/projects': [{ id: 'payments', name: 'Payments' }],
  };
  for (const [path, body] of Object.entries(lists)) await page.route(url => url.pathname === path, async route => {
    if (route.request().method() !== 'GET') {
      mutations.push({ method: route.request().method(), path, body: route.request().postDataJSON() });
      return json(route, { id: 'created-fixture' }, 201);
    }
    return json(route, body);
  });
  await page.route(url => url.pathname.startsWith('/api/authz/roles/'), async route => {
    const role = roles.find(item => route.request().url().endsWith('/' + item.id)) || roles[0];
    if (route.request().method() === 'GET') return json(route, { ...role, permissions: ['engine:instance:view'] });
    mutations.push({ method: route.request().method(), path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    return json(route, { success: true });
  });
  await page.route(url => url.pathname === '/api/authz/policies', async route => {
    if (route.request().method() === 'GET') return json(route, policies);
    const body = route.request().postDataJSON();
    mutations.push({ method: 'POST', path: '/api/authz/policies', body });
    if (failSave) { failSave = false; return json(route, { error: 'The fixture rejected this save.' }, 500); }
    const policy = { id: 'policy-' + mutations.length, ...body, isActive: true, ownershipMode: 'manual' };
    policies.push(policy);
    return json(route, { id: policy.id }, 201);
  });
  return { mutations, failNextSave: () => { failSave = true; } };
}

async function select(page: Page, name: string, option: string) {
  await page.getByRole('combobox', { name, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.describe('Access Control form workflows @access-control-layout', () => {
const forms = [
  { section: 'roles', button: 'Create role', title: 'Create custom role', field: 'Role name' },
  { section: 'permissions', button: 'Add permission', title: 'Create custom permission', field: 'Permission key' },
  { section: 'engine-sets', button: 'Create engine set', title: 'Create engine set', field: 'Engine set name' },
  { section: 'project-targets', button: 'Create target', title: 'Create project target', field: null },
  { section: 'policies', button: 'Add policy', title: 'Add policy', field: 'Policy name' },
];

for (const form of forms) test(`${form.title} keeps page context and guards local navigation`, async ({ page }) => {
  await fixture(page); await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin/access-control?tab=' + form.section);
  await page.getByRole('button', { name: form.button, exact: true }).click();
  const workflow = page.getByRole('region', { name: form.title, exact: true });
  await expect(workflow).toBeVisible();
  await expect(workflow.getByRole('heading', { name: form.title, exact: true })).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Access Control sections', exact: true })).toBeVisible();
  expect(await workflow.evaluate(element => getComputedStyle(element).position)).not.toBe('fixed');
  const geometry = await workflow.boundingBox();
  expect(geometry!.x).toBeGreaterThan(200);
  expect(geometry!.x + geometry!.width).toBeLessThanOrEqual(1440);
  if (form.field) await workflow.getByRole('textbox', { name: form.field, exact: true }).fill('Unsaved fixture');
  else {
    await workflow.locator('label[for="project-target-allow-ci"]').click();
    await expect(workflow.getByLabel('CI deploy', { exact: true })).toBeChecked();
  }
  await captureManualScreenshot(page, 'workflow-' + form.section + '.jpg');
  await page.getByRole('link', { name: 'Groups', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Leave without saving?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Keep editing', exact: true }).click();
  if (form.field) await expect(workflow.getByRole('textbox', { name: form.field, exact: true })).toHaveValue('Unsaved fixture');
  await workflow.getByRole('button', { name: 'Cancel', exact: true }).click();
  await confirmation.locator('button.cds--btn--danger', { hasText: 'Leave' }).click();
  await expect(workflow).toBeHidden();
  // Cancelling the first navigation must not leave a stale pending destination.
  await expect(page).toHaveURL(new RegExp('tab=' + form.section + '$'));
});

test('policy errors keep the draft and a successful retry returns to the saved list', async ({ page }) => {
  const api = await fixture(page); api.failNextSave();
  await page.goto('/admin/policies');
  await page.getByRole('button', { name: 'Add policy', exact: true }).click();
  const workflow = page.getByRole('region', { name: 'Add policy', exact: true });
  await workflow.getByRole('textbox', { name: 'Policy name', exact: true }).fill('Scoped runtime read');
  await select(page, 'Effect', 'Allow'); await select(page, 'Resource type', 'Runtime resource');
  await select(page, 'Permission', 'View instances (engine:instance:view)');
  await workflow.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(workflow.getByText('Changes not saved', { exact: true })).toBeVisible();
  await expect(workflow.getByRole('textbox', { name: 'Policy name', exact: true })).toHaveValue('Scoped runtime read');
  await workflow.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(workflow).toBeHidden();
  await expect(page.getByRole('cell', { name: 'Scoped runtime read', exact: true })).toBeVisible();
  expect(api.mutations.map(mutation => mutation.body)).toEqual([
    expect.objectContaining({ name: 'Scoped runtime read', resourceType: 'engine_runtime_resource', action: 'engine:instance:view', conditions: {} }),
    expect.objectContaining({ name: 'Scoped runtime read', resourceType: 'engine_runtime_resource', action: 'engine:instance:view', conditions: {} }),
  ]);
});

test('Role Library creation, export and editing share the bounded workflow', async ({ page }) => {
  const api = await fixture(page);
  await page.goto('/admin/settings/role-library');
  await page.getByRole('button', { name: 'Create role', exact: true }).click();
  const create = page.getByRole('region', { name: 'Create custom role', exact: true });
  await expect(create).toBeVisible();
  await expect(create.getByRole('combobox', { name: 'Role scope', exact: true })).toContainText('Tenant');
  await create.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Export config role', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Export configuration role', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: /Custom Runtime custom engine/ }).click();
  await page.getByRole('button', { name: 'Edit role', exact: true }).click();
  const edit = page.getByRole('region', { name: 'Edit custom role', exact: true });
  await expect(edit).toBeVisible();
  await edit.getByRole('textbox', { name: 'Role name', exact: true }).fill('Renamed runtime');
  await captureManualScreenshot(page, 'workflow-role-library.jpg');
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(edit).toBeHidden();
  expect(api.mutations.at(-1)).toMatchObject({ method: 'PUT', path: '/api/authz/roles/custom.runtime', body: { name: 'Renamed runtime', permissionIds: ['engine:instance:view'], isAssignable: true } });
});

test('policy fields and actions remain usable at narrow width and 200% zoom', async ({ page }) => {
  await fixture(page); await page.goto('/admin/access-control?tab=policies');
  await page.getByRole('button', { name: 'Add policy', exact: true }).click();
  const workflow = page.getByRole('region', { name: 'Add policy', exact: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(zoom => { document.documentElement.style.zoom = zoom; }, viewport.width === 1440 ? '2' : '1');
    await expect(workflow.getByRole('textbox', { name: 'Policy name', exact: true })).toBeVisible();
    await workflow.getByRole('textbox', { name: 'Policy name', exact: true }).fill('Responsive policy');
    await workflow.getByRole('button', { name: 'Cancel', exact: true }).scrollIntoViewIfNeeded();
    await expect(workflow.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(await workflow.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
});

test('retains the compact group dialog and existing Access Control role scopes', async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin/access-control?tab=groups');
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  const group = page.getByRole('dialog', { name: 'Create group', exact: true });
  await expect(group).toBeVisible();
  await expect(page.locator('.eg-admin-form-workflow')).toHaveCount(0);
  await captureManualScreenshot(page, 'restored-group-dialog.jpg');
  await group.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('link', { name: 'Roles', exact: true }).click();
  await page.getByRole('button', { name: 'Create role', exact: true }).click();
  const role = page.getByRole('region', { name: 'Create custom role', exact: true });
  await role.getByRole('combobox', { name: 'Role scope', exact: true }).click();
  await expect(page.getByRole('option')).toHaveText(['Platform', 'Project', 'Engine']);
  await page.keyboard.press('Escape');
  await expect(role).toBeVisible();
});

});
