import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

function isLocalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname) || url.hostname.endsWith('.local');
  } catch {
    return false;
  }
}

const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'https://localhost:5443';
const enabled = process.env.LOCAL_OIDC_AUTHORIZATION_REHEARSAL === 'true'
  && isLocalUrl(baseUrl)
  && Boolean(process.env.LOCAL_OIDC_ADMIN_EMAIL)
  && Boolean(process.env.LOCAL_OIDC_ADMIN_PASSWORD);
const issuerUrl = process.env.LOCAL_OIDC_ISSUER_URL || 'https://localhost:8180/realms/enterpriseglue-local';
const keycloakUsername = process.env.LOCAL_OIDC_TEST_USERNAME || 'oidc-operator';
const keycloakPassword = process.env.LOCAL_OIDC_TEST_PASSWORD || 'local-oidc-operator';

type Engine = { id: string; name: string };
type Mapping = { id: string; providerKey: string; isActive: boolean };

async function captureConfiguredMappingScreenshot(page: Page): Promise<void> {
  const screenshotDirectory = process.env.LOCAL_OIDC_SCREENSHOT_DIR;
  if (!screenshotDirectory) return;

  await mkdir(screenshotDirectory, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: resolve(screenshotDirectory, '41-identity-mapping-live-oidc-scoped.png'),
    fullPage: false,
  });
}

async function csrfToken(page: Page): Promise<string> {
  const response = await page.request.get('/api/csrf-token');
  expect(response.status()).toBe(200);
  const token = response.headers()['x-csrf-token'];
  expect(token).toBeTruthy();
  return token;
}

async function requestJson<T>(page: Page, path: string, options: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; data?: unknown; csrf?: string } = {}): Promise<{ status: number; body: T | null }> {
  const response = await page.request.fetch(path, {
    method: options.method || 'GET',
    headers: {
      ...(options.csrf ? { 'X-CSRF-Token': options.csrf } : {}),
    },
    ...(options.data === undefined ? {} : { data: options.data }),
  });
  return { status: response.status(), body: await response.json().catch(() => null) as T | null };
}

async function loginLocalAdministrator(page: Page): Promise<void> {
  await page.goto('/login?local=1');
  await page.getByLabel(/email/i).fill(process.env.LOCAL_OIDC_ADMIN_EMAIL!);
  await page.getByLabel(/password/i).fill(process.env.LOCAL_OIDC_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
}

async function createEngine(page: Page, csrf: string, name: string): Promise<Engine> {
  const result = await requestJson<Engine>(page, '/engines-api/engines', {
    method: 'POST',
    csrf,
    data: {
      name,
      baseUrl: 'http://camunda-mock:9080/engine-rest',
      type: 'camunda7',
      deploymentDiscoveryEnabled: false,
    },
  });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  expect(result.body).toMatchObject({ name });
  return result.body!;
}

async function createProviderThroughUi(page: Page, providerKey: string): Promise<void> {
  await page.goto('/admin/settings');
  await page.getByRole('tab', { name: 'Identity Providers', exact: true }).click();
  await page.getByRole('button', { name: 'Add provider', exact: true }).click();
  await page.getByLabel('Provider key').fill(providerKey);
  await page.getByLabel('Authentication mode').selectOption('direct');
  const emailLinkingToggle = page.getByLabel('Allow verified email account linking');
  if (await emailLinkingToggle.getAttribute('aria-checked') !== 'true') await emailLinkingToggle.press('Space');
  await expect(emailLinkingToggle).toHaveAttribute('aria-checked', 'true');
  await page.getByLabel('Issuer URL').fill(issuerUrl);
  await page.getByLabel('Client ID').fill('enterpriseglue-local');
  await page.getByLabel('Callback URL').fill(`${baseUrl.replace(/\/$/, '')}/api/auth/identity/callback`);
  await page.getByLabel('Group claim (optional)').fill('groups');
  await page.getByLabel('Expected audience (optional)').fill('enterpriseglue-local');
  // Carbon renders this toggle as a button with role=switch, not a native
  // checkbox. Keyboard activation avoids modal scrolling/overlay geometry and
  // exercises the accessible switch interaction a keyboard user receives.
  const enabledToggle = page.getByLabel('Enable provider');
  if (await enabledToggle.getAttribute('aria-checked') !== 'true') await enabledToggle.press('Space');
  await expect(enabledToggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(providerKey, { exact: true })).toBeVisible();

  const providerRow = page.getByRole('row').filter({ hasText: providerKey });
  await providerRow.getByRole('button', { name: 'Provider actions' }).click();
  await page.getByRole('menuitem', { name: 'Test connection' }).click();
  await expect(page.getByText(`Connection test: ${providerKey}`, { exact: true })).toBeVisible();
}

async function createMappingThroughUi(page: Page, providerKey: string, groupKey: string, groupName: string, engine: Engine): Promise<void> {
  await page.getByRole('tab', { name: 'Identity Mappings', exact: true }).click();
  await page.getByRole('button', { name: 'Add mapping', exact: true }).click();
  await page.getByRole('combobox', { name: 'Identity provider' }).click();
  await page.getByRole('option', { name: providerKey, exact: true }).click();
  await page.getByRole('textbox', { name: 'External ID' }).fill('operators');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  await page.getByRole('button', { name: 'Create a new group', exact: true }).click();
  await page.getByLabel('New EnterpriseGlue group name').fill(groupName);
  await page.getByLabel('New group key').fill(groupKey);
  await page.getByRole('checkbox', { name: 'Grant scoped engine access now', exact: true }).press('Space');
  await page.getByRole('combobox', { name: 'Engine role' }).click();
  await page.getByRole('option', { name: /engine operator/i }).click();
  await page.locator('#identity-mapping-provision-scope').selectOption('engine');
  await page.locator('#identity-mapping-provision-engine').click();
  await page.getByRole('option', { name: engine.name, exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Ready to create atomically', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create mapping', exact: true }).click();
  await expect(page.getByRole('table').filter({ hasText: providerKey }).getByText(groupKey, { exact: true })).toBeVisible();
}

async function signInWithKeycloak(context: BrowserContext, providerKey: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/api/auth/identity/${encodeURIComponent(providerKey)}/start`);
  await page.locator('input[name="username"]').fill(keycloakUsername);
  await page.locator('input[name="password"]').fill(keycloakPassword);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(new RegExp(`${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(?:$|[?#])`));
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  return page;
}

test.describe('Local OIDC mapping authorization rehearsal', () => {
  // This exercises browser administration, a real Keycloak redirect, and
  // fresh engine authorization decisions against Docker services.
  test.setTimeout(120_000);
  test.skip(!enabled, 'Set LOCAL_OIDC_AUTHORIZATION_REHEARSAL=true with localhost and local administrator credentials.');

  test('creates a provider and atomic mapping through the UI, then proves scoped access and immediate revocation @local-oidc-live @identity-authorization-live', async ({ browser }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const providerKey = `local-oidc-authz-${suffix}`;
    const groupKey = `group.local-oidc-authz-${suffix}`;
    const groupName = `Local OIDC authorization ${suffix}`;
    const adminContext = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: baseUrl });
    const operatorContext = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: baseUrl });
    const admin = await adminContext.newPage();
    const createdEngines: Engine[] = [];

    try {
      await loginLocalAdministrator(admin);
      const csrf = await csrfToken(admin);
      const allowedEngine = await createEngine(admin, csrf, `OIDC mapped allowed ${suffix}`);
      const siblingEngine = await createEngine(admin, csrf, `OIDC mapped sibling ${suffix}`);
      createdEngines.push(allowedEngine, siblingEngine);

      await createProviderThroughUi(admin, providerKey);
      await createMappingThroughUi(admin, providerKey, groupKey, groupName, allowedEngine);

      const mappings = await requestJson<Mapping[]>(admin, '/api/identity/mappings');
      expect(mappings.status).toBe(200);
      const mapping = mappings.body?.find((candidate) => candidate.providerKey === providerKey);
      expect(mapping).toMatchObject({ isActive: true });
      await expect(admin.getByRole('dialog', { name: 'Add identity mapping' })).toBeHidden();
      await captureConfiguredMappingScreenshot(admin);

      const operator = await signInWithKeycloak(operatorContext, providerKey);
      const inventory = await requestJson<Engine[]>(operator, '/engines-api/engines');
      expect(inventory.status, JSON.stringify(inventory.body)).toBe(200);
      expect(inventory.body?.map((engine) => engine.id)).toEqual([allowedEngine.id]);

      const allowed = await requestJson<Engine>(operator, `/engines-api/engines/${allowedEngine.id}`);
      expect(allowed.status).toBe(200);
      const sibling = await requestJson(operator, `/engines-api/engines/${siblingEngine.id}`);
      expect([403, 404]).toContain(sibling.status);

      const revoke = await requestJson<Mapping>(admin, `/api/identity/mappings/${mapping!.id}`, {
        method: 'PUT', csrf, data: { isActive: false },
      });
      expect(revoke.status, JSON.stringify(revoke.body)).toBe(200);
      expect(revoke.body).toMatchObject({ id: mapping!.id, isActive: false });

      const immediatelyRevoked = await requestJson(operator, `/engines-api/engines/${allowedEngine.id}`);
      expect([403, 404]).toContain(immediatelyRevoked.status);
    } finally {
      const csrf = await csrfToken(admin).catch(() => null);
      const mappings = await requestJson<Mapping[]>(admin, '/api/identity/mappings').catch(() => ({ status: 0, body: null }));
      const mapping = mappings.body?.find((candidate) => candidate.providerKey === providerKey);
      if (csrf && mapping) await requestJson(admin, `/api/identity/mappings/${mapping.id}`, { method: 'DELETE', csrf }).catch(() => undefined);
      if (csrf) await requestJson(admin, `/api/identity/providers/${encodeURIComponent(providerKey)}`, { method: 'DELETE', csrf }).catch(() => undefined);
      for (const engine of createdEngines) {
        if (csrf) await requestJson(admin, `/engines-api/engines/${engine.id}`, { method: 'DELETE', csrf }).catch(() => undefined);
      }
      await operatorContext.close();
      await adminContext.close();
    }
  });
});
