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
const profile = process.env.OIDC_REHEARSAL_PROFILE || 'keycloak';
const realEntra = profile === 'entra-id';
const adminEmail = process.env.OIDC_REHEARSAL_ADMIN_EMAIL || process.env.LOCAL_OIDC_ADMIN_EMAIL;
const adminPassword = process.env.OIDC_REHEARSAL_ADMIN_PASSWORD || process.env.LOCAL_OIDC_ADMIN_PASSWORD;
const enabled = (process.env.LOCAL_OIDC_AUTHORIZATION_REHEARSAL === 'true' || process.env.OIDC_REHEARSAL_ENABLED === 'true')
  && (isLocalUrl(baseUrl) || (realEntra && process.env.ENTRA_ID_REHEARSAL_TEST_TENANT === 'true'))
  && Boolean(adminEmail)
  && Boolean(adminPassword);
const issuerUrl = process.env.OIDC_REHEARSAL_ISSUER_URL || process.env.LOCAL_OIDC_ISSUER_URL || 'https://localhost:8180/realms/enterpriseglue-local';
const clientId = process.env.OIDC_REHEARSAL_CLIENT_ID || process.env.LOCAL_OIDC_CLIENT_ID || 'enterpriseglue-local';
const clientSecretRef = process.env.OIDC_REHEARSAL_CLIENT_SECRET_REF || '';
const directoryTenantId = process.env.OIDC_REHEARSAL_DIRECTORY_TENANT_ID || process.env.LOCAL_OIDC_DIRECTORY_TENANT_ID || '';
const oidcScopes = process.env.OIDC_REHEARSAL_SCOPES || 'openid profile email';
const providerUsername = process.env.OIDC_REHEARSAL_USERNAME || process.env.LOCAL_OIDC_TEST_USERNAME || 'oidc-operator';
const providerPassword = process.env.OIDC_REHEARSAL_PASSWORD || process.env.LOCAL_OIDC_TEST_PASSWORD || 'local-oidc-operator';
const externalEntitlementType = process.env.OIDC_REHEARSAL_ENTITLEMENT_TYPE || process.env.LOCAL_OIDC_ENTITLEMENT_TYPE || 'group';
const externalEntitlementId = process.env.OIDC_REHEARSAL_ENTITLEMENT_ID || process.env.LOCAL_OIDC_ENTITLEMENT_ID || 'operators';
const testEngineBaseUrl = process.env.OIDC_REHEARSAL_ENGINE_BASE_URL || 'http://camunda-mock:9080/engine-rest';
const testEngineType = process.env.OIDC_REHEARSAL_ENGINE_TYPE || 'camunda7';
// The local Keycloak realm gives this fixture user a stable UUID. The recovery
// journey uses the same upstream subject that the real OIDC callback persisted,
// rather than an implementation-only database lookup.
const localOidcOperatorSubjectId = process.env.LOCAL_OIDC_TEST_SUBJECT_ID || '11111111-aaaa-4aaa-8aaa-111111111111';
const runsLocalIdentityRecovery = !realEntra && clientId === 'enterpriseglue-local';

type Engine = { id: string; name: string };
type Mapping = { id: string; providerKey: string; isActive: boolean };
type SessionUser = { id: string };

async function captureConfiguredMappingScreenshot(page: Page): Promise<void> {
  const screenshotDirectory = process.env.OIDC_REHEARSAL_SCREENSHOT_DIR || process.env.LOCAL_OIDC_SCREENSHOT_DIR;
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
  await page.getByLabel(/email/i).fill(adminEmail!);
  await page.getByLabel(/password/i).fill(adminPassword!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
}

async function createEngine(page: Page, csrf: string, name: string): Promise<Engine> {
  const result = await requestJson<Engine>(page, '/engines-api/engines', {
    method: 'POST',
    csrf,
    data: {
      name,
      baseUrl: testEngineBaseUrl,
      type: testEngineType,
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
  await page.getByLabel('Client ID').fill(clientId);
  if (clientSecretRef) await page.getByLabel('Client secret reference (optional)').fill(clientSecretRef);
  if (directoryTenantId) await page.getByLabel('Directory tenant ID (optional)').fill(directoryTenantId);
  await page.getByLabel('Callback URL').fill(`${baseUrl.replace(/\/$/, '')}/api/auth/identity/callback`);
  await page.getByLabel('Scopes').fill(oidcScopes);
  await page.getByLabel('Group claim (optional)').fill('groups');
  await page.getByLabel('Expected audience (optional)').fill(clientId);
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
  if (externalEntitlementType !== 'group') {
    await page.locator('#identity-mapping-type').selectOption(externalEntitlementType);
  }
  await page.getByRole('textbox', { name: 'External ID' }).fill(externalEntitlementId);
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

async function signInWithProvider(context: BrowserContext, providerKey: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/api/auth/identity/${encodeURIComponent(providerKey)}/start`);
  if (realEntra) {
    await page.locator('input[name="loginfmt"], input[type="email"]').first().fill(providerUsername);
    await page.getByRole('button', { name: /next/i }).click();
    await page.locator('input[name="passwd"], input[type="password"]').first().fill(providerPassword);
    await page.getByRole('button', { name: /sign in/i }).click();
    const staySignedInNo = page.locator('#idBtn_Back');
    if (await staySignedInNo.isVisible().catch(() => false)) await staySignedInNo.click();
  } else {
    await page.locator('input[name="username"]').fill(providerUsername);
    await page.locator('input[name="password"]').fill(providerPassword);
    await page.getByRole('button', { name: /sign in/i }).click();
  }
  await expect(page).toHaveURL(new RegExp(`${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(?:$|[?#])`));
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  return page;
}

test.describe('Local OIDC mapping authorization rehearsal', () => {
  // This exercises browser administration, a real Keycloak redirect, and
  // fresh engine authorization decisions against Docker services.
  test.setTimeout(120_000);
  test.skip(!enabled, 'Enable the configured OIDC rehearsal and provide its EnterpriseGlue administrator credentials.');

  test(`creates a ${profile} provider and atomic mapping through the UI, then proves scoped access and immediate revocation @local-oidc-live @identity-authorization-live`, async ({ browser }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const providerKey = `local-oidc-authz-${suffix}`;
    const groupKey = `group.local-oidc-authz-${suffix}`;
    const groupName = `Local OIDC authorization ${suffix}`;
    const adminContext = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: baseUrl });
    const operatorContext = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: baseUrl });
    const admin = await adminContext.newPage();
    const createdEngines: Engine[] = [];
    let recoveredOperatorContext: BrowserContext | null = null;

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

      const operator = await signInWithProvider(operatorContext, providerKey);
      const inventory = await requestJson<Engine[]>(operator, '/engines-api/engines');
      expect(inventory.status, JSON.stringify(inventory.body)).toBe(200);
      expect(inventory.body?.map((engine) => engine.id)).toEqual([allowedEngine.id]);

      const allowed = await requestJson<Engine>(operator, `/engines-api/engines/${allowedEngine.id}`);
      expect(allowed.status).toBe(200);
      const sibling = await requestJson(operator, `/engines-api/engines/${siblingEngine.id}`);
      expect([403, 404]).toContain(sibling.status);

      // Keycloak's deterministic fixture user lets this use the real recovery
      // UI and backend data instead of a browser-only identity mock. Entra's
      // local profile has a separate subject and retains its focused
      // provider/mapping authorization coverage above.
      let recoveredOperator: Page | null = null;
      if (runsLocalIdentityRecovery) {
        const session = await requestJson<SessionUser>(operator, '/api/auth/me');
        expect(session.status, JSON.stringify(session.body)).toBe(200);
        expect(session.body?.id).toBeTruthy();

        await admin.goto('/admin/settings');
        await admin.getByRole('tab', { name: 'Identity Providers', exact: true }).click();
        const providerRow = admin.getByRole('row').filter({ hasText: providerKey });
        await providerRow.getByRole('button', { name: 'Provider actions' }).click();
        await admin.getByRole('menuitem', { name: 'Resolve external identity conflict' }).click();
        const conflictDialog = admin.getByRole('dialog', { name: 'Resolve external identity conflict' });
        await conflictDialog.getByLabel('External provider subject ID').fill(localOidcOperatorSubjectId);
        await conflictDialog.getByLabel('Currently linked account ID').fill(session.body!.id);
        await conflictDialog.getByRole('button', { name: /Unlink external identity/ }).click();
        await expect(admin.getByText(`External identity unlinked: ${providerKey}`, { exact: true })).toBeVisible();

        const unlinkedSession = await requestJson(operator, `/engines-api/engines/${allowedEngine.id}`);
        expect([401, 403, 404]).toContain(unlinkedSession.status);

        recoveredOperatorContext = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: baseUrl });
        recoveredOperator = await signInWithProvider(recoveredOperatorContext, providerKey);
        const recoveredAccess = await requestJson<Engine>(recoveredOperator, `/engines-api/engines/${allowedEngine.id}`);
        expect(recoveredAccess.status, JSON.stringify(recoveredAccess.body)).toBe(200);
      }

      const revoke = await requestJson<Mapping>(admin, `/api/identity/mappings/${mapping!.id}`, {
        method: 'PUT', csrf, data: { isActive: false },
      });
      expect(revoke.status, JSON.stringify(revoke.body)).toBe(200);
      expect(revoke.body).toMatchObject({ id: mapping!.id, isActive: false });

      const immediatelyRevoked = await requestJson(recoveredOperator || operator, `/engines-api/engines/${allowedEngine.id}`);
      expect([403, 404]).toContain(immediatelyRevoked.status);

      if (runsLocalIdentityRecovery) {
        await admin.goto('/admin/settings');
        await admin.getByRole('tab', { name: 'Identity Providers', exact: true }).click();
        const providerRow = admin.getByRole('row').filter({ hasText: providerKey });
        await providerRow.getByRole('button', { name: 'Provider actions' }).click();
        await admin.getByRole('menuitem', { name: 'Archive' }).click();
        const archiveDialog = admin.getByRole('dialog', { name: 'Archive identity provider' });
        await expect(archiveDialog).toContainText('Provider-managed group memberships are removed');
        await archiveDialog.getByRole('button', { name: /Archive/ }).click();
        await expect(providerRow).toContainText('Archived');

        const chooser = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: baseUrl });
        const chooserPage = await chooser.newPage();
        await chooserPage.goto('/login');
        await expect(chooserPage.getByRole('button', { name: `Sign in with ${providerKey}`, exact: true })).toHaveCount(0);
        await chooser.close();
      }
    } finally {
      const csrf = await csrfToken(admin).catch(() => null);
      const mappings = await requestJson<Mapping[]>(admin, '/api/identity/mappings').catch(() => ({ status: 0, body: null }));
      const mapping = mappings.body?.find((candidate) => candidate.providerKey === providerKey);
      if (csrf && mapping) await requestJson(admin, `/api/identity/mappings/${mapping.id}`, { method: 'DELETE', csrf }).catch(() => undefined);
      if (csrf) await requestJson(admin, `/api/identity/providers/${encodeURIComponent(providerKey)}`, { method: 'DELETE', csrf }).catch(() => undefined);
      for (const engine of createdEngines) {
        if (csrf) await requestJson(admin, `/engines-api/engines/${engine.id}`, { method: 'DELETE', csrf }).catch(() => undefined);
      }
      await recoveredOperatorContext?.close();
      await operatorContext.close();
      await adminContext.close();
    }
  });
});
