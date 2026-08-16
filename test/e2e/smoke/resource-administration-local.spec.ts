import { expect, test, type APIResponse, type Locator, type Page } from '@playwright/test';
import { captureManualScreenshot } from '../utils/manualScreenshots';
import {
  getE2ECredentials,
  getE2EFineGrainedFixture,
  hasE2ECredentials,
} from '../utils/credentials';

const shouldSkip = !hasE2ECredentials();

async function loginAsSeededAdministrator(page: Page) {
  const { email, password } = getE2ECredentials();
  if (!email || !password) throw new Error('Missing E2E credentials');

  await page.goto('/login?local=1');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const loginResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/auth/login',
  );
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  return { email };
}

async function responseJson<T>(response: APIResponse, operation: string): Promise<T> {
  const body = await response.json().catch(() => null);
  expect(response.ok(), `${operation} failed (${response.status()}): ${JSON.stringify(body)}`).toBe(true);
  return body as T;
}

async function csrfToken(page: Page): Promise<string> {
  const response = await page.request.get('/api/csrf-token');
  const body = await responseJson<{ csrfToken: string }>(response, 'obtain CSRF token');
  expect(body.csrfToken).toBeTruthy();
  return body.csrfToken;
}

async function createOwnedProject(page: Page, name: string): Promise<{ id: string; name: string }> {
  const token = await csrfToken(page);
  const response = await page.request.post('/starbase-api/projects', {
    headers: { 'X-CSRF-Token': token },
    data: { name },
  });
  return responseJson<{ id: string; name: string }>(response, 'create E2E project');
}

async function selectResourceSection(
  page: Page,
  name: 'Engine sets' | 'Runtime Resources' | 'Project Targets',
) {
  if ((page.viewportSize()?.width || 1440) < 672) {
    await page.getByRole('combobox', { name: 'Access Control section', exact: true }).click();
    await page.getByRole('option', { name, exact: true }).click();
  } else {
    await page.getByRole('link', { name, exact: true }).click();
  }
  if (name === 'Engine sets') {
    await expect(page.getByRole('button', { name: 'Create engine set', exact: true })).toBeVisible();
  } else if (name === 'Runtime Resources') {
    await expect(page.getByRole('heading', { name: 'Runtime resources', exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole('button', { name: 'Create target', exact: true })).toBeVisible();
  }
}

async function selectCarbonOption(page: Page, control: Locator, option: string) {
  await control.click();
  const visibleListbox = page.locator('[role="listbox"]:visible');
  await expect(visibleListbox).toHaveCount(1);
  await visibleListbox.getByRole('option', { name: option, exact: true }).click();
}

async function selectCarbonComboBox(page: Page, control: Locator, option: string) {
  await control.fill(option);
  const visibleListbox = page.locator('[role="listbox"]:visible');
  await expect(visibleListbox).toHaveCount(1);
  await visibleListbox.getByRole('option', { name: option, exact: true }).click();
}

async function clickOverflowAction(page: Page, itemName: string, actionName: string) {
  await page.getByRole('button', { name: `Actions for ${itemName}`, exact: true }).click();
  const action = page.locator('.cds--overflow-menu-options__option').filter({ hasText: actionName }).last();
  await expect(action).toBeVisible();
  await action.locator('button').click();
}

async function selectUser(page: Page, container: Locator, email: string) {
  const input = container.getByRole('textbox', { name: 'User', exact: true });
  await input.fill(email);
  const suggestion = container.getByRole('button').filter({ hasText: email }).first();
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await expect(input).toHaveValue(email);
}

async function captureMobile(page: Page, fileName: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  // Move focus away from Carbon controls before resetting the scrolling main
  // region. Otherwise the browser may scroll the focused dropdown back into
  // view while the screenshot is being captured.
  await page.locator('#main-content').focus();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
    if (document.scrollingElement) {
      document.scrollingElement.scrollTop = 0;
      document.scrollingElement.scrollLeft = 0;
    }
    document.querySelectorAll<HTMLElement>('main, [role="main"], .cds--content')
      .forEach((element) => {
        element.scrollTop = 0;
        element.scrollLeft = 0;
      });
  });
  await page.evaluate(() => new Promise<void>((resolveFrame) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolveFrame()));
  }));
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll<HTMLElement>('main, [role="main"], .cds--content')
      .forEach((element) => { element.scrollTop = 0; });
  });
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(documentWidth, `${fileName} must not overflow the mobile viewport`).toBeLessThanOrEqual(viewportWidth + 1);
  await captureManualScreenshot(page, fileName, { stabilize: false });
}

test.describe('Resource administration with the real local API', () => {
  test.skip(shouldSkip, 'E2E_USER/E2E_PASSWORD not set');

  test('creates, persists, refreshes, evaluates, and archives governed resources @resource-admin-e2e', async ({ page }) => {
    test.setTimeout(240_000);
    const fixture = getE2EFineGrainedFixture();
    expect(fixture.scopeAssignmentEngineId, 'seeded resource engine is required').toBeTruthy();
    expect(fixture.scopeAssignmentEngineName, 'seeded resource engine name is required').toBeTruthy();
    expect(fixture.scopeAssignmentRuntimeResourceEmail, 'seeded denied persona is required').toBeTruthy();

    const suffix = Date.now().toString(36);
    const engineSetKey = `e2e-resource-${suffix}`;
    const engineSetName = `E2E resource engines ${suffix}`;
    const updatedEngineSetName = `${engineSetName} updated`;
    const projectName = `e2e-resource-project-${suffix}`;
    const { email } = await loginAsSeededAdministrator(page);
    const project = await createOwnedProject(page, projectName);

    await page.goto('/t/default/admin/access-control');
    await expect(page.getByRole('heading', { name: 'Access Control' })).toBeVisible();

    // Engine Sets: preview the selector, create through the UI, verify the
    // authenticated API and reload state, inspect details, edit, and refresh.
    await selectResourceSection(page, 'Engine sets');
    await page.getByRole('button', { name: 'Create engine set', exact: true }).click();
    const engineSetWorkflow = page.getByRole('dialog', { name: 'Create engine set' });
    await engineSetWorkflow.getByLabel('Engine set key', { exact: true }).fill(engineSetKey);
    await engineSetWorkflow.getByLabel('Engine set name', { exact: true }).fill(engineSetName);
    await engineSetWorkflow.getByLabel('Description', { exact: true }).fill('Real-backend Resource administration verification.');
    await selectCarbonOption(page, engineSetWorkflow.getByRole('combobox', { name: 'Selector', exact: true }), 'Engine IDs');
    await engineSetWorkflow.getByLabel('Engine IDs', { exact: true }).fill(fixture.scopeAssignmentEngineId!);
    const selectorPreviewed = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/authz/engine-sets/preview',
    );
    await engineSetWorkflow.getByRole('button', { name: 'Preview Selector', exact: true }).click();
    expect((await selectorPreviewed).status()).toBe(200);
    await expect(engineSetWorkflow.getByText('1 engine match', { exact: true })).toBeVisible();
    await captureManualScreenshot(page, '240-resource-engine-set-preview-desktop.jpg');

    const engineSetCreated = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/authz/engine-sets',
    );
    await engineSetWorkflow.locator('footer').getByRole('button', { name: 'Create', exact: true }).click();
    const engineSetCreateResponse = await engineSetCreated;
    expect(engineSetCreateResponse.status()).toBe(201);
    const { id: engineSetId } = await engineSetCreateResponse.json() as { id: string };
    await expect(page.getByRole('row').filter({ hasText: engineSetName }).first()).toBeVisible();
    await page.reload();
    await selectResourceSection(page, 'Engine sets');
    await expect(page.getByRole('row').filter({ hasText: engineSetName }).first()).toBeVisible();
    const persistedEngineSet = await page.evaluate(async (id) => (await fetch(`/api/authz/engine-sets/${id}`)).json(), engineSetId);
    expect(persistedEngineSet).toMatchObject({
      id: engineSetId,
      key: engineSetKey,
      name: engineSetName,
      selector: { mode: 'engine_ids', engineIds: [fixture.scopeAssignmentEngineId] },
      materializedEngineCount: 1,
    });
    await clickOverflowAction(page, engineSetName, 'View details');
    await expect(page.getByText(`${engineSetName} matching engines`, { exact: true })).toBeVisible();
    await expect(
      page.getByRole('table', { name: `${engineSetName} matching engines`, exact: true })
        .getByRole('cell', { name: fixture.scopeAssignmentEngineName!, exact: true }),
    ).toBeVisible();
    await captureManualScreenshot(page, '241-resource-engine-set-persisted-desktop.jpg');

    await clickOverflowAction(page, engineSetName, 'Edit');
    const editEngineSetWorkflow = page.getByRole('dialog', { name: 'Edit engine set' });
    await editEngineSetWorkflow.getByLabel('Engine set name', { exact: true }).fill(updatedEngineSetName);
    const engineSetUpdated = page.waitForResponse((response) =>
      response.request().method() === 'PUT'
      && new URL(response.url()).pathname === `/api/authz/engine-sets/${engineSetId}`,
    );
    await editEngineSetWorkflow.locator('footer').getByRole('button', { name: 'Save', exact: true }).click();
    expect((await engineSetUpdated).status()).toBe(200);
    await expect(page.getByRole('row').filter({ hasText: updatedEngineSetName }).first()).toBeVisible();

    const engineSetRefreshed = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/authz/engine-sets/${engineSetId}/materialize`,
    );
    await clickOverflowAction(page, updatedEngineSetName, 'Refresh matching engines');
    expect((await engineSetRefreshed).status()).toBe(200);
    await expect(page.getByRole('status').filter({ hasText: 'Matching engines refreshed' })).toBeVisible();
    await expect(page.getByText(/1 engines matched; \d+ added, \d+ refreshed, \d+ removed/)).toBeVisible();
    await captureManualScreenshot(page, '242-resource-engine-set-refreshed-desktop.jpg');

    // Runtime Resources: prove seeded inventory is rendered from the API and
    // that live reconciliation reaches the Docker Camunda mock successfully.
    await selectResourceSection(page, 'Runtime Resources');
    const runtimeEngineControl = page.getByRole('combobox', { name: 'Engine', exact: true });
    await selectCarbonOption(page, runtimeEngineControl, fixture.scopeAssignmentEngineName!);
    await expect(page.getByRole('cell', { name: 'invoice-process', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'invoice-sequential-review', exact: true })).toBeVisible();
    await captureManualScreenshot(page, '243-resource-runtime-inventory-desktop.jpg');

    const inventoryRefreshed = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/authz/runtime-resources/${fixture.scopeAssignmentEngineId}/reconcile`,
    );
    await page.getByRole('button', { name: 'Refresh inventory', exact: true }).click();
    expect((await inventoryRefreshed).status()).toBe(200);
    await expect(page.getByText('Inventory refreshed', { exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'invoice-process', exact: true })).toBeVisible();
    await captureManualScreenshot(page, '244-resource-runtime-refreshed-desktop.jpg');

    // Project Targets: create from real catalog data, verify persistence and
    // edit behavior, then simulate both an allowed owner and a denied persona.
    await selectResourceSection(page, 'Project Targets');
    await page.getByRole('button', { name: 'Create target', exact: true }).click();
    const targetWorkflow = page.getByRole('dialog', { name: 'Create project target' });
    await selectCarbonComboBox(page, targetWorkflow.getByRole('combobox', { name: 'Project', exact: true }), project.name);
    await selectCarbonComboBox(page, targetWorkflow.getByRole('combobox', { name: 'Engine', exact: true }), fixture.scopeAssignmentEngineName!);
    await expect(targetWorkflow.getByRole('checkbox', { name: 'Manual deploy', exact: true })).toBeChecked();
    await targetWorkflow.getByText('CI deploy', { exact: true }).click();
    await expect(targetWorkflow.getByRole('checkbox', { name: 'CI deploy', exact: true })).toBeChecked();
    await targetWorkflow.getByText('Import', { exact: true }).click();
    await expect(targetWorkflow.getByRole('checkbox', { name: 'Import', exact: true })).toBeChecked();
    await captureManualScreenshot(page, '245-resource-project-target-create-desktop.jpg');

    const projectTargetCreated = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/authz/project-engine-targets',
    );
    await targetWorkflow.locator('footer').getByRole('button', { name: 'Create', exact: true }).click();
    const projectTargetCreateResponse = await projectTargetCreated;
    expect(projectTargetCreateResponse.status()).toBe(201);
    const { id: projectTargetId } = await projectTargetCreateResponse.json() as { id: string };
    await expect(page.getByRole('row').filter({ hasText: project.name }).first()).toBeVisible();
    await page.reload();
    await selectResourceSection(page, 'Project Targets');
    const persistedTargetRow = page.getByRole('row').filter({ hasText: project.name }).first();
    await expect(persistedTargetRow).toBeVisible();
    await expect(persistedTargetRow).toContainText('Manual, CI, Import');
    const persistedTargets = await page.evaluate(async () => (await fetch('/api/authz/project-engine-targets?status=all')).json());
    expect(persistedTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: projectTargetId,
        projectId: project.id,
        engineId: fixture.scopeAssignmentEngineId,
        allowManualDeploy: true,
        allowCiDeploy: true,
        allowImport: true,
      }),
    ]));
    await captureManualScreenshot(page, '246-resource-project-target-persisted-desktop.jpg');

    await clickOverflowAction(page, project.name, 'Edit');
    const editTargetWorkflow = page.getByRole('dialog', { name: 'Edit project target' });
    await editTargetWorkflow.getByText('API deploy', { exact: true }).click();
    const projectTargetUpdated = page.waitForResponse((response) =>
      response.request().method() === 'PUT'
      && new URL(response.url()).pathname === `/api/authz/project-engine-targets/${projectTargetId}`,
    );
    await editTargetWorkflow.locator('footer').getByRole('button', { name: 'Save', exact: true }).click();
    expect((await projectTargetUpdated).status()).toBe(200);
    await expect(page.getByRole('row').filter({ hasText: project.name }).first()).toContainText('Manual, CI, API, Import');

    const eligibilitySection = page.getByRole('heading', { name: 'Check deployment access', exact: true }).locator('..');
    await selectUser(page, eligibilitySection, email);
    await selectCarbonComboBox(page, eligibilitySection.getByRole('combobox', { name: 'Project', exact: true }), project.name);
    await selectCarbonComboBox(page, eligibilitySection.getByRole('combobox', { name: 'Engine', exact: true }), fixture.scopeAssignmentEngineName!);
    const allowedEvaluated = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/authz/project-engine-targets/evaluate',
    );
    await eligibilitySection.getByRole('button', { name: 'Check deployment access', exact: true }).click();
    expect((await allowedEvaluated).status()).toBe(200);
    await expect(page.getByText('Deployment eligibility allowed', { exact: true })).toBeVisible();
    await captureManualScreenshot(page, '247-resource-project-target-allowed-desktop.jpg');

    await selectUser(page, eligibilitySection, fixture.scopeAssignmentRuntimeResourceEmail!);
    const deniedEvaluated = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/authz/project-engine-targets/evaluate',
    );
    await eligibilitySection.getByRole('button', { name: 'Check deployment access', exact: true }).click();
    expect((await deniedEvaluated).status()).toBe(200);
    await expect(page.getByText('Deployment eligibility denied', { exact: true })).toBeVisible();
    await captureManualScreenshot(page, '248-resource-project-target-denied-desktop.jpg');

    // Responsive evidence reuses the same persisted real-backend state.
    await page.setViewportSize({ width: 390, height: 844 });
    await selectResourceSection(page, 'Engine sets');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Create engine set', exact: true })).toBeVisible();
    await captureMobile(page, '249-resource-engine-sets-mobile.jpg');
    await selectResourceSection(page, 'Runtime Resources');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Runtime resources', exact: true })).toBeVisible();
    await selectCarbonOption(page, page.getByRole('combobox', { name: 'Engine', exact: true }), fixture.scopeAssignmentEngineName!);
    await expect(page.getByRole('cell', { name: 'invoice-process', exact: true })).toBeVisible();
    await captureMobile(page, '250-resource-runtime-resources-mobile.jpg');
    await selectResourceSection(page, 'Project Targets');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Create target', exact: true })).toBeVisible();
    await captureMobile(page, '251-resource-project-targets-mobile.jpg');

    // Finish by validating the guarded destructive paths against the API.
    await page.setViewportSize({ width: 1440, height: 900 });
    await selectResourceSection(page, 'Engine sets');
    await page.getByRole('button', { name: `Actions for ${updatedEngineSetName}`, exact: true }).click();
    const archiveEngineSetAction = page.locator('.cds--overflow-menu-options__option').filter({ hasText: 'Archive' }).last();
    await expect(archiveEngineSetAction).toBeVisible();
    await archiveEngineSetAction.locator('button').click();
    const archiveEngineSetModal = page.locator('.cds--modal-container').filter({ hasText: 'Archive engine set' });
    await expect(archiveEngineSetModal).toBeVisible();
    await captureManualScreenshot(page, '252-resource-engine-set-archive-confirmation-desktop.jpg');
    const engineSetArchived = page.waitForResponse((response) =>
      response.request().method() === 'DELETE'
      && new URL(response.url()).pathname === `/api/authz/engine-sets/${engineSetId}`,
    );
    await archiveEngineSetModal.locator('.cds--btn--danger').click();
    expect((await engineSetArchived).status()).toBe(204);
    await expect(page.getByRole('row').filter({ hasText: updatedEngineSetName })).toHaveCount(0);

    await selectResourceSection(page, 'Project Targets');
    await page.getByRole('button', { name: `Actions for ${project.name}`, exact: true }).click();
    const archiveTargetAction = page.locator('.cds--overflow-menu-options__option').filter({ hasText: 'Archive' }).last();
    await expect(archiveTargetAction).toBeVisible();
    await archiveTargetAction.locator('button').click();
    const archiveTargetModal = page.locator('.cds--modal-container').filter({ hasText: 'Archive project target' });
    await expect(archiveTargetModal).toBeVisible();
    await captureManualScreenshot(page, '253-resource-project-target-archive-confirmation-desktop.jpg');
    const projectTargetArchived = page.waitForResponse((response) =>
      response.request().method() === 'DELETE'
      && new URL(response.url()).pathname === `/api/authz/project-engine-targets/${projectTargetId}`,
    );
    await archiveTargetModal.locator('.cds--btn--danger').click();
    expect((await projectTargetArchived).status()).toBe(204);
    await expect(page.getByRole('row').filter({ hasText: project.name }).first()).toContainText('Archived');
  });
});
