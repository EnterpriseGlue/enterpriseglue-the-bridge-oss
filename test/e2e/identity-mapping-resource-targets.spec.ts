import { expect, test, type Page, type Route } from '@playwright/test';
import { MockBrowserIdentityStack } from './utils/mockIdentityStack';
import { captureManualScreenshot, manualScreenshotDirectory } from './utils/manualScreenshots';

const providerKey = 'identity.oidc.browser-mock';
const engine = { id: 'scope-engine', name: 'Scoped operations engine', lifecycleStatus: 'active' };
const engineSet = { id: 'scope-engine-set', key: 'operations', name: 'Operations engines', isArchived: false };
const runtimeResource = { id: 'scope-runtime-resource', engineId: engine.id, resourceKey: 'invoice-process', resourceKind: 'process_definition', isActive: true };
const runtimeResourceSet = { id: 'scope-runtime-resource-set', engineId: engine.id, key: 'invoices', name: 'Invoice resources', resourceKind: 'process_definition', isArchived: false };
const engineRole = { id: 'scope-engine-viewer', key: 'engine-viewer', name: 'Engine Viewer', scope: 'engine', isAssignable: true, isArchived: false };
const browserOperatorsGroup = {
  id: 'browser-operators-group',
  tenantId: null,
  key: 'group.browser-operators',
  name: 'Browser operators',
  description: null,
  source: 'manual',
  sourceRef: null,
  ownershipMode: 'manual',
  sourceHash: null,
  lastAppliedAt: null,
  driftStatus: null,
  isSystem: false,
  isArchived: false,
  createdById: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
type TargetCase = {
  resourceType: 'engine' | 'engine_set' | 'engine_runtime_resource' | 'engine_runtime_resource_set';
  resourceId: string;
  resourceTypeLabel: string;
  resourceName: string;
  selectTarget: (page: Page) => Promise<void>;
};

const json = (route: Route, body: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function startScopedMapping(page: Page, suffix: string, captureInitialState = false): Promise<void> {
  const slug = suffix.replaceAll('_', '-');
  await page.getByRole('button', { name: 'Add mapping', exact: true }).click();
  if (captureInitialState) await captureManualScreenshot(page, '23-identity-mapping-wizard-step-1.jpg');
  await page.getByRole('combobox', { name: 'Identity provider' }).click();
  await page.getByRole('option', { name: `Browser identity provider (${providerKey})`, exact: true }).click();
  await page.getByRole('textbox', { name: 'External group, role, or attribute value' }).fill(`operators-${slug}`);
  if (captureInitialState) await captureManualScreenshot(page, '24-identity-mapping-wizard-configured-step-1.jpg');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('group', { name: 'EnterpriseGlue group', exact: true })
    .getByText('Create a new group', { exact: true })
    .click();
  await page.getByLabel('New EnterpriseGlue group name').fill(`Scope coverage ${slug}`);
  await page.getByLabel('New group key').fill(`group.scope-coverage-${slug}`);
  await expect(page.getByRole('heading', { name: 'Engine access', exact: true })).toBeVisible();
  await expect(page.getByText(
    'Choose whether matching people join only the EnterpriseGlue group or also receive one engine role.',
    { exact: true },
  )).toBeVisible();
  if (captureInitialState) await captureManualScreenshot(page, '26-identity-mapping-wizard-step-2-group.jpg');
  const provisionAccess = page.getByRole('radio', { name: 'Also grant engine access', exact: true });
  await expect(provisionAccess).not.toBeChecked();
  await page.getByRole('group', { name: 'Access provisioning', exact: true })
    .getByText('Also grant engine access', { exact: true })
    .click();
  await expect(provisionAccess).toBeChecked();
  if (captureInitialState) await captureManualScreenshot(page, '32-identity-mapping-group-and-access-layout.jpg');
  await page.locator('#identity-mapping-provision-role').click();
  await page.getByRole('option', { name: engineRole.name, exact: true }).click();
}

async function chooseEngine(page: Page): Promise<void> {
  await page.locator('#identity-mapping-provision-engine').click();
  await page.getByRole('option', { name: engine.name, exact: true }).click();
}

async function chooseEngineSet(page: Page): Promise<void> {
  await page.getByRole('combobox', { name: 'Engine set', exact: true }).click();
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
  { resourceType: 'engine', resourceId: engine.id, resourceTypeLabel: 'Engine', resourceName: engine.name, selectTarget: chooseEngine },
  { resourceType: 'engine_set', resourceId: engineSet.id, resourceTypeLabel: 'Engine set', resourceName: engineSet.name, selectTarget: chooseEngineSet },
  { resourceType: 'engine_runtime_resource', resourceId: runtimeResource.id, resourceTypeLabel: 'Runtime resource', resourceName: runtimeResource.resourceKey, selectTarget: chooseRuntimeResource },
  { resourceType: 'engine_runtime_resource_set', resourceId: runtimeResourceSet.id, resourceTypeLabel: 'Runtime resource set', resourceName: runtimeResourceSet.name, selectTarget: chooseRuntimeResourceSet },
];

async function openScopedMappingPage(page: Page): Promise<Record<string, unknown>[]> {
  const stack = new MockBrowserIdentityStack();
  await stack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');
  const persistedMappings: Record<string, unknown>[] = [];
  const persistedGroups: Record<string, unknown>[] = [browserOperatorsGroup];
  const provisionRequests: Record<string, unknown>[] = [];

  await page.route('**/api/authz/roles', (route) => json(route, [engineRole]));
  await page.route('**/api/authz/groups**', (route) => json(route, persistedGroups));
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
    const requestedGroup = request.newGroup as { key: string; name: string };
    const createdGroup = {
      ...browserOperatorsGroup,
      id: `scope-group-${persistedGroups.length}`,
      key: requestedGroup.key,
      name: requestedGroup.name,
    };
    persistedGroups.push(createdGroup);
    await json(route, { mapping, assignment: { id: 'scope-assignment', warnings: [] }, createdGroup }, 201);
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

      if (index === 0) await captureManualScreenshot(page, '22-identity-mappings-list.jpg');
      await startScopedMapping(page, suffix, index === 0);
      await page.locator('#identity-mapping-provision-scope').selectOption(target.resourceType);
      await target.selectTarget(page);
      if (manualScreenshotDirectory) {
        await captureManualScreenshot(page, [
          '34-identity-mapping-engine.jpg',
          '35-identity-mapping-engine-set.jpg',
          '36-identity-mapping-runtime-resource.jpg',
          '37-identity-mapping-runtime-resource-set.jpg',
        ][index]);
      }
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      const review = page.getByLabel('Identity mapping review');
      await expect(review).toContainText(target.resourceTypeLabel);
      await expect(review).toContainText(target.resourceName);
      if (index === 0) {
        await captureManualScreenshot(page, '28-identity-mapping-wizard-step-3-review.jpg');
      }
      await page.getByRole('button', { name: 'Create mapping', exact: true }).click();
      await expect(page.getByRole('table').getByText(`Scope coverage ${slug}`, { exact: true })).toBeVisible();
      await expect(page.getByRole('table').getByText(`group.scope-coverage-${slug}`, { exact: true })).toBeVisible();
      if (index === 0) {
        await captureManualScreenshot(page, '41-identity-mapping-live-oidc-scoped.jpg');
      }

      expect(provisionRequests).toEqual([expect.objectContaining({
        providerKey,
        roleId: engineRole.id,
        resourceType: target.resourceType,
        resourceId: target.resourceId,
        newGroup: expect.objectContaining({ key: `group.scope-coverage-${slug}` }),
      })]);
    });
  }

  test('selects an existing group before deciding whether to grant engine access @identity-mapping-scopes', async ({ page }) => {
    await openScopedMappingPage(page);
    await page.getByRole('button', { name: 'Add mapping', exact: true }).click();
    await page.getByRole('combobox', { name: 'Identity provider' }).click();
    await page.getByRole('option', { name: `Browser identity provider (${providerKey})`, exact: true }).click();
    await page.getByRole('textbox', { name: 'External group, role, or attribute value' }).fill('operators-existing-group');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('combobox', { name: 'Existing EnterpriseGlue group' }).click();
    await page.getByRole('option', { name: 'Browser operators (group.browser-operators)', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Create group membership only', exact: true })).toBeChecked();
    await captureManualScreenshot(page, '27-identity-mapping-wizard-step-2-selected-group.jpg');
  });
});
