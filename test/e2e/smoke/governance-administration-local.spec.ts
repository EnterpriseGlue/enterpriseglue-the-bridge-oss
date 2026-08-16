import { expect, request as playwrightRequest, test, type APIResponse, type Locator, type Page } from '@playwright/test';
import { captureManualScreenshot } from '../utils/manualScreenshots';
import { getE2ECredentials, hasE2ECredentials } from '../utils/credentials';

const shouldSkip = !hasE2ECredentials();
const apiBaseUrl = process.env.E2E_API_BASE_URL || 'http://localhost:8787';

async function responseJson<T>(response: APIResponse, operation: string): Promise<T> {
  const body = await response.json().catch(() => null);
  expect(response.ok(), `${operation} failed (${response.status()}): ${JSON.stringify(body)}`).toBe(true);
  return body as T;
}

async function loginAsSeededAdministrator(page: Page) {
  page.setDefaultTimeout(15_000);
  const { email, password } = getE2ECredentials();
  if (!email || !password) throw new Error('Missing E2E credentials');
  await page.goto('/login?local=1');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  return { email };
}

async function csrfToken(page: Page) {
  const response = await page.request.get('/api/csrf-token');
  return (await responseJson<{ csrfToken: string }>(response, 'obtain CSRF token')).csrfToken;
}

function mutationOptions(token: string, data?: unknown) {
  return { headers: { 'X-CSRF-Token': token }, ...(data === undefined ? {} : { data }) };
}

async function selectSection(page: Page, name: string) {
  if ((page.viewportSize()?.width || 1440) < 672) {
    const selector = page.getByRole('combobox', { name: 'Access Control section', exact: true });
    await selector.click();
    await page.getByRole('option', { name, exact: true }).click();
    await expect(selector).toHaveValue(name);
  } else {
    const link = page.getByRole('link', { name, exact: true });
    await link.click();
    await expect(link).toHaveAttribute('aria-current', 'page');
  }
}

async function selectCarbonOption(page: Page, control: Locator, option: string) {
  await control.click();
  await page.locator('[role="listbox"]:visible').getByRole('option', { name: option, exact: true }).click();
}

async function selectUser(panel: Locator, email: string) {
  const input = panel.getByRole('textbox', { name: 'User', exact: true });
  await input.fill(email);
  const suggestion = panel.getByRole('button').filter({ hasText: email }).first();
  await expect(suggestion).toBeVisible();
  await suggestion.click();
}

async function clickVisibleOverflowMenuItem(page: Page, label: string) {
  const option = page.locator('.cds--overflow-menu-options__option').filter({ hasText: label }).last();
  await expect(option).toBeVisible();
  await option.locator('button').click();
}

async function acknowledgeCredential(page: Page, heading: RegExp) {
  const dialog = page.getByRole('dialog', { name: heading });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeVisible();
  await dialog.locator('label[for="machine-credential-stored"]').click();
  await expect(dialog.getByLabel('I have stored the bearer token in the approved secret manager')).toBeChecked();
  await dialog.getByRole('button', { name: "I've stored the credential" }).click();
  await expect(dialog).toBeHidden();
}

test.describe.serial('Governance administration with the real local API', () => {
  test.skip(shouldSkip, 'E2E_USER/E2E_PASSWORD not set');

  test('explores access, enforces a policy, and inspects exported audit evidence @governance-admin-e2e', async ({ page }) => {
    test.setTimeout(180_000);
    const suffix = Date.now().toString(36);
    const policyName = `E2E dashboard freeze ${suffix}`;
    const { email } = await loginAsSeededAdministrator(page);
    const mutationToken = await csrfToken(page);
    const stalePolicies = await responseJson<Array<{ id: string; name: string; ownershipMode?: string }>>(
      await page.request.get('/api/authz/policies'),
      'list policies before E2E policy lifecycle',
    );
    for (const policy of stalePolicies.filter((candidate) => candidate.name.startsWith('E2E dashboard freeze ') && candidate.ownershipMode !== 'config_locked')) {
      await page.request.delete(`/api/authz/policies/${policy.id}`, mutationOptions(mutationToken));
    }
    const session = await page.evaluate(async () => (await fetch('/api/auth/me')).json());
    const userId = session.user?.id || session.id;
    expect(userId).toBeTruthy();

    await page.goto('/t/default/admin/access-control');
    await selectSection(page, 'By Principal');
    await page.getByPlaceholder('Search principals').fill(email);
    const principalRow = page.getByRole('row').filter({ hasText: email }).first();
    await expect(principalRow).toBeVisible();
    await principalRow.getByRole('button', { name: /View principal/ }).click();
    await expect(page.getByRole('heading', { name: /^User:/ })).toBeVisible();
    await expect(page.getByText('Principal role assignments', { exact: true })).toBeVisible();
    await captureManualScreenshot(page, '250-access-explorer-by-principal-real-desktop.jpg');

    await selectSection(page, 'By Resource');
    await page.getByPlaceholder('Search resources').fill('Platform');
    await page.getByRole('button', { name: 'View resource Platform' }).click();
    await expect(page.getByRole('heading', { name: 'Platform: Platform' })).toBeVisible();
    await captureManualScreenshot(page, '251-access-explorer-by-resource-real-desktop.jpg');

    await selectSection(page, 'Policies');
    await page.getByRole('button', { name: 'Add policy', exact: true }).click();
    const workflow = page.getByRole('dialog', { name: 'Add policy' });
    await workflow.getByLabel('Policy name', { exact: true }).fill(policyName);
    await workflow.getByLabel('Description', { exact: true }).fill('Real browser policy lifecycle verification.');
    await selectCarbonOption(page, workflow.getByRole('combobox', { name: 'Effect' }), 'Deny');
    await workflow.getByLabel('Priority', { exact: true }).fill('1000');
    await selectCarbonOption(page, workflow.getByRole('combobox', { name: 'Resource type' }), 'Platform');
    const permission = workflow.getByRole('combobox', { name: 'Permission' });
    await permission.fill('platform:dashboard:view');
    await page.getByRole('option', { name: /platform:dashboard:view/ }).click();
    const createPolicyResponse = page.waitForResponse((response) => response.url().endsWith('/api/authz/policies') && response.request().method() === 'POST');
    await workflow.locator('footer').getByRole('button', { name: 'Create', exact: true }).click();
    const createdPolicy = await responseJson<{ id: string }>(await createPolicyResponse, 'create policy');
    const policyRow = page.getByRole('row').filter({ hasText: policyName }).first();
    await expect(policyRow).toContainText('Deny');
    await captureManualScreenshot(page, '252-authorization-policy-active-real-desktop.jpg');

    await selectSection(page, 'Effective Access');
    const effectivePanel = page.getByRole('tabpanel', { name: 'Effective Access' });
    await selectUser(effectivePanel, email);
    const effectivePermission = effectivePanel.getByRole('combobox', { name: 'Permission' });
    await effectivePermission.click();
    await page.getByRole('option', { name: /platform:dashboard:view/ }).click();
    await effectivePanel.getByRole('button', { name: 'Check access' }).click();
    await expect(effectivePanel.getByText('Access is denied')).toBeVisible();
    await expect(effectivePanel).toContainText(policyName);

    await selectSection(page, 'Audit');
    await page.getByLabel('User ID', { exact: true }).fill(userId);
    await page.getByLabel('Action', { exact: true }).fill('platform:dashboard:view');
    await selectCarbonOption(page, page.getByRole('combobox', { name: 'Decision' }), 'Denied only');
    const auditRow = page.getByRole('row').filter({ hasText: 'platform:dashboard:view' }).first();
    await expect(auditRow).toContainText('Deny');
    await auditRow.getByRole('button', { name: 'View details' }).click();
    const detail = page.getByRole('dialog', { name: 'Authorization event details' });
    await expect(detail).toContainText('Sensitive values are redacted');
    await captureManualScreenshot(page, '253-authorization-audit-event-details-real-desktop.jpg');
    await detail.getByRole('button', { name: 'Close' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export current view' }).click();
    expect((await download).suggestedFilename()).toMatch(/^authorization-audit-.+\.csv$/);

    await selectSection(page, 'Policies');
    await policyRow.getByRole('button', { name: `Actions for ${policyName}` }).click();
    await clickVisibleOverflowMenuItem(page, 'Disable');
    await expect(policyRow).toContainText('Inactive');
    await selectSection(page, 'Effective Access');
    await expect(effectivePanel.getByRole('textbox', { name: 'User', exact: true })).toHaveValue(email);
    await expect(effectivePanel.getByRole('combobox', { name: 'Permission' })).toContainText('platform:dashboard:view');
    await effectivePanel.getByRole('button', { name: 'Check access' }).click();
    await expect(effectivePanel.getByText('Access is allowed')).toBeVisible();

    await selectSection(page, 'Policies');
    await policyRow.getByRole('button', { name: `Actions for ${policyName}` }).click();
    await clickVisibleOverflowMenuItem(page, 'Delete');
    const deleteDialog = page.getByRole('dialog', { name: 'Delete authorization policy' });
    const deleted = page.waitForResponse((response) => response.url().endsWith(`/api/authz/policies/${createdPolicy.id}`) && response.request().method() === 'DELETE');
    await deleteDialog.getByRole('button', { name: /Delete$/ }).click();
    expect((await deleted).status()).toBe(204);
  });

  test('manages reveal-once machine identities and external registration lifecycle @governance-admin-e2e', async ({ page }) => {
    test.setTimeout(240_000);
    const suffix = Date.now().toString(36);
    const clientName = `E2E registrar ${suffix}`;
    const serviceAccountName = `E2E deployer ${suffix}`;
    const systemKey = `external-engine-system.e2e-${suffix}`;
    const systemName = `E2E control plane ${suffix}`;
    const engineName = `E2E external engine ${suffix}`;
    const token = await (async () => { await loginAsSeededAdministrator(page); return csrfToken(page); })();
    await page.goto('/t/default/admin/access-control');
    await selectSection(page, 'External Registration');

    await page.getByLabel('Client name', { exact: true }).fill(clientName);
    const clientCreated = page.waitForResponse((response) => response.url().endsWith('/api/authz/api-clients') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create Client', exact: true }).click();
    const apiClient = await responseJson<{ client: { id: string }; token: string }>(await clientCreated, 'create API client');
    await captureManualScreenshot(page, '254-api-client-reveal-once-guard-real-desktop.jpg');
    await acknowledgeCredential(page, /Copy the API client credential now/i);
    const clientRow = page.getByRole('row').filter({ hasText: clientName }).first();
    await expect(clientRow).toContainText('Active');

    const rotated = page.waitForResponse((response) => response.url().endsWith(`/api/authz/api-clients/${apiClient.client.id}/rotate`) && response.request().method() === 'POST');
    await clientRow.getByRole('button', { name: 'Rotate', exact: true }).click();
    const rotatedCredential = await responseJson<{ token: string }>(await rotated, 'rotate API client');
    expect(rotatedCredential.token).not.toBe(apiClient.token);
    await acknowledgeCredential(page, /Copy the API client credential now/i);

    await page.getByLabel('Service account name', { exact: true }).fill(serviceAccountName);
    await page.getByLabel('Service account description', { exact: true }).fill('Real browser deployment principal.');
    const serviceAccountCreated = page.waitForResponse((response) => response.url().endsWith('/api/authz/service-accounts') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create Service Account', exact: true }).click();
    const serviceAccount = await responseJson<{ account: { id: string }; token: string }>(await serviceAccountCreated, 'create service account');
    await acknowledgeCredential(page, /Copy the service account credential now/i);
    await expect(page.getByRole('row').filter({ hasText: serviceAccountName }).first()).toContainText('Active');

    await page.getByLabel('System key', { exact: true }).fill(systemKey);
    await page.getByLabel('System name', { exact: true }).fill(systemName);
    await page.getByLabel('System description', { exact: true }).fill('Real E2E external control plane.');
    const externalSystemCreated = page.waitForResponse((response) => response.url().endsWith('/api/authz/external-engine-systems') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create System', exact: true }).click();
    const externalSystem = await responseJson<{ id: string }>(await externalSystemCreated, 'create external engine system');
    await expect(page.getByRole('row').filter({ hasText: systemName }).first()).toContainText('Active');

    const externalApi = await playwrightRequest.newContext({
      baseURL: apiBaseUrl,
      extraHTTPHeaders: { Authorization: `Bearer ${rotatedCredential.token}`, 'Content-Type': 'application/json' },
    });
    const enginePayload = {
      name: engineName,
      baseUrl: 'http://camunda-mock.example.test:9080/engine-rest',
      externalId: `e2e/${suffix}`,
      externalSystemId: externalSystem.id,
      type: 'camunda7',
      connectionMode: 'direct',
      runtimeAccessScope: 'engine_wide',
      metadataDiscoveryEnabled: false,
      deploymentDiscoveryEnabled: false,
      fieldOwnership: { display: 'external' },
      tenancy: { mode: 'dedicated', tenantRef: { type: 'default' } },
    };
    const unauthorized = await externalApi.post('/engines-api/external/engines', { data: enginePayload });
    expect(unauthorized.status()).toBe(403);
    const assignment = await responseJson<{ id: string }>(await page.request.post('/api/authz/role-assignments', mutationOptions(token, {
      principalType: 'api_client', principalId: apiClient.client.id, roleId: 'system.api.engine_registrar', resourceType: 'platform', resourceId: null,
    })), 'assign API engine registrar');
    const registeredResponse = await externalApi.post('/engines-api/external/engines', { data: enginePayload });
    const registered = await responseJson<{ engine: { id: string } }>(registeredResponse, 'register external engine');
    expect(registeredResponse.status()).toBe(201);
    await externalApi.dispose();

    await page.reload();
    await selectSection(page, 'External Registration');
    const engineRow = page.getByRole('row').filter({ hasText: engineName }).first();
    await expect(engineRow).toContainText('external_api');
    await captureManualScreenshot(page, '255-machine-identities-and-external-registration-real-desktop.jpg');
    await engineRow.getByRole('button', { name: 'Decommission', exact: true }).click();
    await expect(engineRow).toContainText('Decommissioned');
    await engineRow.getByRole('button', { name: 'Reactivate', exact: true }).click();
    await expect(engineRow).toContainText('Active');
    await engineRow.getByRole('button', { name: 'View audit', exact: true }).click();
    const externalAuditHeading = page.getByRole('heading', { name: `${engineName} audit` });
    await expect(externalAuditHeading).toBeVisible();
    const reactivationAuditRow = page.getByRole('row').filter({ hasText: 'engine.external_registration.reactivate' }).first();
    await expect(reactivationAuditRow).toBeVisible();
    await reactivationAuditRow.scrollIntoViewIfNeeded();
    await captureManualScreenshot(page, '256-external-registration-audit-real-desktop.jpg', { stabilize: false });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await captureManualScreenshot(page, '257-external-registration-real-mobile.jpg', { stabilize: false });
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.request.post(`/api/authz/external-engines/${registered.engine.id}/decommission`, mutationOptions(token, {}));
    await page.request.delete(`/api/authz/role-assignments/${assignment.id}`, mutationOptions(token));
    await page.request.delete(`/api/authz/api-clients/${apiClient.client.id}`, mutationOptions(token));
    await page.request.delete(`/api/authz/service-accounts/${serviceAccount.account.id}`, mutationOptions(token));
    await page.request.delete(`/api/authz/external-engine-systems/${externalSystem.id}`, mutationOptions(token));
  });

  test('applies configuration ownership and proves locked portal controls @governance-admin-e2e', async ({ page }) => {
    test.setTimeout(240_000);
    const suffix = Date.now().toString(36);
    const bundleKey = `e2e.governance.ownership.${suffix}`;
    const policyName = `Configured policy ${suffix}`;
    const systemName = `Configured external system ${suffix}`;
    const bundle = {
      bundle: {
        apiVersion: 'enterpriseglue.ai/v1beta1', kind: 'EnterpriseGlueConfigBundle', metadata: { key: bundleKey, owner: 'platform-e2e' }, tenantKey: 'default', mode: 'additive',
        imports: ['./authorization-policies.json', './external-engine-systems.json'],
      },
      files: {
        './authorization-policies.json': { authorizationPolicies: [{
          key: `policy.e2e-${suffix}`, name: policyName, description: 'Configuration-owned E2E policy.', effect: 'deny', priority: 25,
          resourceType: 'platform', action: 'platform:dashboard:view', conditions: {}, active: false, ownershipMode: 'config_locked',
        }] },
        './external-engine-systems.json': { externalEngineSystems: [{
          key: `external-engine-system.e2e-config-${suffix}`, name: systemName, description: 'Configuration-owned E2E external system.',
          defaultManagementMode: 'external_managed', defaultFieldOwnership: { display: 'external' }, active: true, ownershipMode: 'config_locked',
        }] },
      },
    };
    await loginAsSeededAdministrator(page);
    await page.goto('/admin/settings/configuration');
    await page.getByLabel('Configuration bundle JSON').fill(JSON.stringify(bundle, null, 2));
    await page.getByRole('button', { name: 'Preview changes' }).click();
    await expect(page.getByText('Preview valid')).toBeVisible();
    await page.getByRole('button', { name: 'Apply exact preview' }).click();
    await expect(page.getByText('Configuration applied')).toBeVisible();
    await captureManualScreenshot(page, '258-platform-configuration-applied-real-desktop.jpg');

    await page.goto('/t/default/admin/access-control');
    await selectSection(page, 'Policies');
    const policyRow = page.getByRole('row').filter({ hasText: policyName }).first();
    await expect(policyRow).toContainText('Managed by configuration');
    await policyRow.getByRole('button', { name: `Actions for ${policyName}` }).click();
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await captureManualScreenshot(page, '259-configuration-owned-policy-locked-real-desktop.jpg');

    await selectSection(page, 'External Registration');
    const systemRow = page.getByRole('row').filter({ hasText: systemName }).first();
    await expect(systemRow).toContainText('Managed by configuration');
    await expect(systemRow.getByRole('button', { name: `Edit ${systemName}` })).toBeDisabled();
    await expect(systemRow.getByRole('button', { name: `Archive ${systemName}` })).toBeDisabled();
    await captureManualScreenshot(page, '260-configuration-owned-external-system-locked-real-desktop.jpg');
  });

  test('loads, navigates, recovers, and reflows the real dashboard @governance-admin-e2e', async ({ page }) => {
    test.setTimeout(180_000);
    const suffix = Date.now().toString(36);
    await loginAsSeededAdministrator(page);
    const token = await csrfToken(page);
    const project = await responseJson<{ id: string; name: string }>(await page.request.post('/starbase-api/projects', mutationOptions(token, {
      name: `E2E dashboard project ${suffix}`,
    })), 'create dashboard project');

    await page.goto('/t/default');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    const projectsKpi = page.locator('.eg-dashboard-kpi').filter({ hasText: 'Projects' });
    const enginesKpi = page.locator('.eg-dashboard-kpi').filter({ hasText: 'Engines' });
    await expect(projectsKpi).toBeVisible();
    await expect(enginesKpi).toBeVisible();
    await captureManualScreenshot(page, '261-dashboard-real-populated-desktop.jpg');

    await projectsKpi.click();
    await expect(page).toHaveURL(/\/t\/default\/starbase/);
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await captureManualScreenshot(page, '262-dashboard-real-mobile.jpg', { stabilize: false });

    await page.setViewportSize({ width: 1440, height: 900 });
    let failContext = true;
    await page.route('**/api/dashboard/context', async (route) => {
      if (failContext) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'controlled E2E outage' }) });
      } else {
        await route.continue();
      }
    });
    await page.reload();
    await expect(page.getByText('Dashboard context could not be loaded')).toBeVisible();
    await captureManualScreenshot(page, '263-dashboard-controlled-error-desktop.jpg');
    failContext = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(page.getByText('Dashboard context could not be loaded')).toHaveCount(0);
    await page.unroute('**/api/dashboard/context');

    const removed = await page.request.delete(`/starbase-api/projects/${project.id}`, mutationOptions(token));
    expect(removed.status()).toBe(204);
  });
});
