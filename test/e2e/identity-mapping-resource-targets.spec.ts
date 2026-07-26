import { expect, test, type Page, type Route } from '@playwright/test';
import { MockBrowserIdentityStack } from './utils/mockIdentityStack';

const providerKey = 'identity.oidc.browser-mock';
const engine = { id: 'scope-engine', name: 'Scoped operations engine', lifecycleStatus: 'active' };
const engineSet = { id: 'scope-engine-set', key: 'operations', name: 'Operations engines', isArchived: false };
const runtimeResource = { id: 'scope-runtime-resource', engineId: engine.id, resourceKey: 'invoice-process', resourceKind: 'process_definition', isActive: true };
const runtimeResourceSet = { id: 'scope-runtime-resource-set', engineId: engine.id, key: 'invoices', name: 'Invoice resources', resourceKind: 'process_definition', isArchived: false };
const engineRole = { id: 'scope-engine-viewer', key: 'engine-viewer', name: 'Engine Viewer', scope: 'engine', isAssignable: true, isArchived: false };

type TargetCase = {
  resourceType: 'engine' | 'engine_set' | 'engine_runtime_resource' | 'engine_runtime_resource_set';
  resourceId: string;
  selectTarget: (page: Page) => Promise<void>;
};

const json = (route: Route, body: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function startScopedMapping(page: Page, suffix: string): Promise<void> {
  const slug = suffix.replaceAll('_', '-');
  await page.getByRole('button', { name: 'Add mapping', exact: true }).click();
  await page.getByRole('combobox', { name: 'Identity provider' }).click();
  await page.getByRole('option', { name: providerKey, exact: true }).click();
  await page.getByRole('textbox', { name: 'External ID' }).fill(`operators-${slug}`);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Create a new group', exact: true }).click();
  await page.getByLabel('New EnterpriseGlue group name').fill(`Scope coverage ${slug}`);
  await page.getByLabel('New group key').fill(`group.scope-coverage-${slug}`);
  await page.getByRole('button', { name: 'Add engine access with this mapping', exact: true }).click();
  await page.locator('#identity-mapping-provision-role').click();
  await page.getByRole('option', { name: engineRole.name, exact: true }).click();
}

async function chooseEngine(page: Page): Promise<void> {
  await page.locator('#identity-mapping-provision-engine').click();
  await page.getByRole('option', { name: engine.name, exact: true }).click();
}

async function chooseEngineSet(page: Page): Promise<void> {
  await page.getByRole('combobox', { name: 'Engine Set', exact: true }).click();
  await page.getByRole('option', { name: `${engineSet.name} (${engineSet.key})`, exact: true }).click();
}

async function chooseRuntimeResource(page: Page): Promise<void> {
  await page.locator('#identity-mapping-provision-runtime-engine').click();
  await page.getByRole('option', { name: engine.name, exact: true }).click();
  await expect(page.locator('#identity-mapping-provision-runtime-resource')).toBeEnabled();
  await page.locator('#identity-mapping-provision-runtime-resource').click();
  await page.getByRole('option', { name: 'invoice-process (process)', exact: true }).click();
}

async function chooseRuntimeResourceSet(page: Page): Promise<void> {
  await page.locator('#identity-mapping-provision-runtime-engine').click();
  await page.getByRole('option', { name: engine.name, exact: true }).click();
  await expect(page.locator('#identity-mapping-provision-runtime-resource-set')).toBeEnabled();
  await page.locator('#identity-mapping-provision-runtime-resource-set').click();
  await page.getByRole('option', { name: `${runtimeResourceSet.name} (${runtimeResourceSet.key})`, exact: true }).click();
}

const targetCases: TargetCase[] = [
  { resourceType: 'engine', resourceId: engine.id, selectTarget: chooseEngine },
  { resourceType: 'engine_set', resourceId: engineSet.id, selectTarget: chooseEngineSet },
  { resourceType: 'engine_runtime_resource', resourceId: runtimeResource.id, selectTarget: chooseRuntimeResource },
  { resourceType: 'engine_runtime_resource_set', resourceId: runtimeResourceSet.id, selectTarget: chooseRuntimeResourceSet },
];

async function openScopedMappingPage(page: Page): Promise<Record<string, unknown>[]> {
  const stack = new MockBrowserIdentityStack();
  await stack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');
  const persistedMappings: Record<string, unknown>[] = [];
  const provisionRequests: Record<string, unknown>[] = [];

  await page.route('**/api/authz/roles', (route) => json(route, [engineRole]));
  await page.route('**/api/authz/engine-sets', (route) => json(route, [engineSet]));
  await page.route('**/engines-api/engines', (route) => json(route, [engine]));
  await page.route('**/api/authz/runtime-resources**', (route) => json(route, [runtimeResource]));
  await page.route('**/api/authz/runtime-resource-sets**', (route) => json(route, [runtimeResourceSet]));
  await page.route('**/api/identity/mappings/provision-access', async (route) => {
    const request = route.request().postDataJSON() as Record<string, unknown>;
    provisionRequests.push(request);
    const mapping = {
      id: 'scope-mapping',
      providerId: 'browser-oidc-provider',
      providerKey: request.providerKey,
      targetGroupId: 'scope-group',
      targetGroupKey: (request.newGroup as { key: string }).key,
      entitlementType: request.entitlementType,
      externalId: request.externalId,
      matchOperator: request.matchOperator,
      syncMode: request.syncMode,
      isActive: true,
      configKey: null,
      sourceRef: null,
      ownershipMode: 'manual',
    };
    persistedMappings.push(mapping);
    await json(route, { mapping, assignment: { id: 'scope-assignment', warnings: [] }, createdGroup: { id: 'scope-group' } }, 201);
  });
  await page.route('**/api/identity/mappings', (route) => json(route, persistedMappings));

  await page.goto('/admin/settings');
  await page.getByRole('tab', { name: 'Identity Mappings', exact: true }).click();
  return provisionRequests;
}

test.describe('Identity mapping scoped access', () => {
  test.setTimeout(60_000);

  for (const [index, target] of targetCases.entries()) {
    test(`provisions ${target.resourceType} access atomically through the mapping wizard @identity-mapping-scopes`, async ({ page }) => {
      const provisionRequests = await openScopedMappingPage(page);
      const suffix = `${index + 1}-${target.resourceType}`;
      const slug = suffix.replaceAll('_', '-');

      await startScopedMapping(page, suffix);
      await page.locator('#identity-mapping-provision-scope').selectOption(target.resourceType);
      await target.selectTarget(page);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      const review = page.getByLabel('Identity mapping review');
      await expect(review).toContainText(target.resourceType.replaceAll('_', ' '));
      await expect(review).toContainText(target.resourceId);
      await page.getByRole('button', { name: 'Create mapping', exact: true }).click();
      await expect(page.getByRole('table').getByText(`group.scope-coverage-${slug}`, { exact: true })).toBeVisible();

      expect(provisionRequests).toEqual([expect.objectContaining({
        providerKey,
        roleId: engineRole.id,
        resourceType: target.resourceType,
        resourceId: target.resourceId,
        newGroup: expect.objectContaining({ key: `group.scope-coverage-${slug}` }),
      })]);
    });
  }
});
