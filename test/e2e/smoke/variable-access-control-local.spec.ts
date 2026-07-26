import { expect, test, type Page } from '@playwright/test';
import { getE2EVariableAccessFixture } from '../utils/credentials';

const fixture = getE2EVariableAccessFixture();
const shouldSkip = !fixture.engineId
  || !fixture.processInstanceId
  || !fixture.deniedProcessInstanceId
  || !fixture.metadataEmail
  || !fixture.metadataPassword
  || !fixture.valueEmail
  || !fixture.valuePassword
  || !fixture.editorEmail
  || !fixture.editorPassword;

const secretValue = 'ACME-42';
const browserVariableName = 'e2eBrowserVariable';
const browserVariableValue = 'visible-after-authorized-browser-edit';

// The browser lane exercises these guarded server actions through a real local
// Docker stack and the synthetic Camunda engine, including their denial paths.
const coveredActions = [
  'engine.runtime.process-instances.variables.read',
  'engine.runtime.process-instances.variables.update',
  'engine.runtime.history.variables.read',
] as const;

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/login?local=1');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
}

async function request(page: Page, path: string, init?: RequestInit) {
  return page.evaluate(async ({ path, init }) => {
    // A variable response is deliberately non-cacheable. Explicitly bypass
    // any prior browser entry here so this assertion proves the next request
    // reaches the backend and then the engine, rather than React Query's UI
    // cache or a browser's same-URL cache.
    const response = await fetch(path, { cache: 'no-store', ...init });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { path, init });
}

async function backendRequest(page: Page, path: string) {
  // The request context shares the authenticated browser cookies while
  // bypassing UI and React Query caches.  Resolve the configured local API
  // target instead of the runner's loopback address: Firefox/WebKit execute
  // inside an isolated container where localhost is the runner, not the app.
  const apiBaseUrl = process.env.E2E_API_BASE_URL || 'http://localhost:8787';
  const response = await page.context().request.get(new URL(path, apiBaseUrl).toString(), {
    headers: { 'Cache-Control': 'no-store' },
  });
  return { status: response.status(), body: await response.json().catch(() => null) };
}

async function openInstance(page: Page) {
  await page.evaluate((engineId) => {
    window.localStorage.setItem('engine-selector', JSON.stringify({ state: { selectedEngineId: engineId }, version: 0 }));
    window.localStorage.setItem('mission-control-show-instance-counts', '1');
  }, fixture.engineId);
  await page.goto(`/mission-control/processes/instances/${fixture.processInstanceId}`);
  await expect(page.getByText('Variables', { exact: true })).toBeVisible();
}

test.describe('Smoke: browser variable data authorization', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(shouldSkip, 'Variable-access E2E fixture is unavailable');

  test.beforeAll(() => {
    expect(coveredActions).toHaveLength(3);
  });

  test('metadata-only access redacts runtime and historic values before they reach the browser', async ({ page }) => {
    await loginAs(page, fixture.metadataEmail!, fixture.metadataPassword!);

    const variables = await request(page, `/mission-control-api/process-instances/${fixture.processInstanceId}/variables?engineId=${fixture.engineId}`);
    expect(variables.status, JSON.stringify(variables.body)).toBe(200);
    expect(variables.body.customerId).toMatchObject({ type: 'String', value: null, valueRedacted: true });
    expect(JSON.stringify(variables.body)).not.toContain(secretValue);

    const siblingVariables = await request(page, `/mission-control-api/process-instances/${fixture.deniedProcessInstanceId}/variables?engineId=${fixture.engineId}`);
    expect([403, 404]).toContain(siblingVariables.status);

    const historic = await request(page, `/mission-control-api/history/variable-instances?engineId=${fixture.engineId}&processInstanceId=${fixture.processInstanceId}`);
    expect(historic.status, JSON.stringify(historic.body)).toBe(200);
    expect(historic.body.length).toBeGreaterThan(0);
    expect(historic.body.every((entry: { value: unknown; valueRedacted?: boolean }) => entry.value === null && entry.valueRedacted === true)).toBe(true);
    expect(JSON.stringify(historic.body)).not.toContain(secretValue);

    const valueFilter = await request(page, `/mission-control-api/history/variables?engineId=${fixture.engineId}&variableValue=${encodeURIComponent(secretValue)}`);
    expect(valueFilter.status).toBe(403);

    const mutation = await request(page, `/mission-control-api/process-instances/${fixture.processInstanceId}/variables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engineId: fixture.engineId, modifications: { denied: { type: 'String', value: 'must-not-reach-engine' } } }),
    });
    expect(mutation.status).toBe(403);

    await openInstance(page);
    await expect(page.getByText('customerId', { exact: true })).toBeVisible();
    await expect(page.getByText('Restricted', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(secretValue, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add variable +' })).toBeDisabled();
  });

  test('a value reader receives values but still cannot modify them', async ({ page }) => {
    await loginAs(page, fixture.valueEmail!, fixture.valuePassword!);

    const variables = await request(page, `/mission-control-api/process-instances/${fixture.processInstanceId}/variables?engineId=${fixture.engineId}`);
    expect(variables.status, JSON.stringify(variables.body)).toBe(200);
    expect(variables.body.customerId).toMatchObject({ type: 'String', value: secretValue });
    expect(variables.body.customerId.valueRedacted).not.toBe(true);

    const historic = await request(page, `/mission-control-api/history/variable-instances?engineId=${fixture.engineId}&processInstanceId=${fixture.processInstanceId}`);
    expect(historic.status, JSON.stringify(historic.body)).toBe(200);
    expect(historic.body.some((entry: { value: unknown }) => entry.value === secretValue)).toBe(true);

    const mutation = await request(page, `/mission-control-api/process-instances/${fixture.processInstanceId}/variables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engineId: fixture.engineId, modifications: { denied: { type: 'String', value: 'must-not-reach-engine' } } }),
    });
    expect(mutation.status).toBe(403);

    await openInstance(page);
    await expect(page.getByText(secretValue, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add variable +' })).toBeDisabled();
  });

  test('an editor can add a value through the browser and the next backend read returns it', async ({ page }) => {
    await loginAs(page, fixture.editorEmail!, fixture.editorPassword!);
    await openInstance(page);

    const addButton = page.getByRole('button', { name: 'Add variable +' });
    await expect(addButton).toBeEnabled();
    await addButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Name', { exact: true }).fill(browserVariableName);
    await dialog.getByLabel('Value', { exact: true }).fill(browserVariableValue);
    await dialog.getByRole('button', { name: 'Add variable', exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText(browserVariableName, { exact: true })).toBeVisible();
    await expect(page.getByText(browserVariableValue, { exact: true })).toBeVisible();

    await expect.poll(async () => {
      const variables = await backendRequest(page, `/mission-control-api/process-instances/${fixture.processInstanceId}/variables?engineId=${fixture.engineId}`);
      expect(variables.status, JSON.stringify(variables.body)).toBe(200);
      return variables.body?.[browserVariableName]?.value;
    }, {
      message: 'the engine-backed variable read should converge after the accepted browser write',
      timeout: 10_000,
    }).toBe(browserVariableValue);
  });
});
