import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getE2EFineGrainedFixture, getE2ESeedData } from './utils/credentials';

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
const configuredAdminEmail = process.env.OIDC_REHEARSAL_ADMIN_EMAIL || process.env.LOCAL_OIDC_ADMIN_EMAIL;
const configuredAdminPassword = process.env.OIDC_REHEARSAL_ADMIN_PASSWORD || process.env.LOCAL_OIDC_ADMIN_PASSWORD;
const usesSeededAdministrator = process.env.E2E_SEED_USER !== 'false';
const requireCrossTenantEvidence = process.env.OIDC_REHEARSAL_REQUIRE_CROSS_TENANT === 'true';
const enabled = (process.env.LOCAL_OIDC_AUTHORIZATION_REHEARSAL === 'true' || process.env.OIDC_REHEARSAL_ENABLED === 'true')
  && (isLocalUrl(baseUrl) || (realEntra && process.env.ENTRA_ID_REHEARSAL_TEST_TENANT === 'true'))
  && (usesSeededAdministrator || (Boolean(configuredAdminEmail) && Boolean(configuredAdminPassword)));
const issuerUrl = process.env.OIDC_REHEARSAL_ISSUER_URL || process.env.LOCAL_OIDC_ISSUER_URL || 'https://localhost:8180/realms/enterpriseglue-local';
const clientId = process.env.OIDC_REHEARSAL_CLIENT_ID || process.env.LOCAL_OIDC_CLIENT_ID || 'enterpriseglue-local';
const clientSecretRef = process.env.OIDC_REHEARSAL_CLIENT_SECRET_REF || '';
const directoryTenantId = process.env.OIDC_REHEARSAL_DIRECTORY_TENANT_ID || process.env.LOCAL_OIDC_DIRECTORY_TENANT_ID || '';
const oidcScopes = process.env.OIDC_REHEARSAL_SCOPES || 'openid profile email';
const providerUsername = process.env.OIDC_REHEARSAL_USERNAME || process.env.LOCAL_OIDC_TEST_USERNAME || 'oidc-operator';
const providerPassword = process.env.OIDC_REHEARSAL_PASSWORD || process.env.LOCAL_OIDC_TEST_PASSWORD || 'local-oidc-operator';
const externalEntitlementType = process.env.OIDC_REHEARSAL_ENTITLEMENT_TYPE || process.env.LOCAL_OIDC_ENTITLEMENT_TYPE || 'group';
const externalEntitlementId = process.env.OIDC_REHEARSAL_ENTITLEMENT_ID || process.env.LOCAL_OIDC_ENTITLEMENT_ID || 'operators';
const testEngineBaseUrl = process.env.OIDC_REHEARSAL_ENGINE_BASE_URL || 'http://operaton-mock:9080/engine-rest';
const testEngineType = process.env.OIDC_REHEARSAL_ENGINE_TYPE || 'operaton';
// The local Keycloak realm gives this fixture user a stable UUID. The recovery
// journey uses the same upstream subject that the real OIDC callback persisted,
// rather than an implementation-only database lookup.
const localOidcOperatorSubjectId = process.env.LOCAL_OIDC_TEST_SUBJECT_ID || '11111111-aaaa-4aaa-8aaa-111111111111';
const runsLocalIdentityRecovery = !realEntra && clientId === 'enterpriseglue-local';
const providerDisplayName = 'Local OIDC test provider';

type Engine = { id: string; name: string };
type Mapping = { id: string; providerKey: string; targetGroupId: string; isActive: boolean };
type RoleAssignment = { id: string; principalType: 'group'; principalId: string; roleId: string; resourceType: string | null; resourceId: string | null };
type SessionUser = { id: string };
type ProvisionedMapping = { mapping: Mapping; assignment: { id: string }; createdGroup: { id: string } | null };

async function captureLiveScreenshot(page: Page, fileName: string): Promise<void> {
  const screenshotDirectory = process.env.OIDC_REHEARSAL_SCREENSHOT_DIR || process.env.LOCAL_OIDC_SCREENSHOT_DIR;
  if (!screenshotDirectory) return;

  await mkdir(screenshotDirectory, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: resolve(screenshotDirectory, fileName),
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
  const seedData = getE2ESeedData();
  const email = seedData.adminEmail || configuredAdminEmail;
  const password = seedData.adminPassword || configuredAdminPassword;
  expect(email, 'A disposable or configured administrator email is required.').toBeTruthy();
  expect(password, 'A disposable or configured administrator password is required.').toBeTruthy();
  await page.goto('/admin-recovery');
  await page.getByLabel(/email/i).fill(email!);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Log in for recovery', exact: true }).click();
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

async function fillProviderField(page: Page, selector: string, value: string): Promise<void> {
  const field = page.locator(selector);
  // Keep lower optional fields keyboard-reachable in the in-page workflow at
  // laptop-height viewports instead of relying on a larger CI viewport.
  await field.scrollIntoViewIfNeeded();
  await field.fill(value);
}

async function createProviderThroughUi(page: Page, providerKey: string): Promise<void> {
  await page.goto('/admin/settings/identity-providers');
  await page.getByRole('button', { name: 'Create provider', exact: true }).click();
  await page.getByLabel('Provider key').fill(providerKey);
  await page.getByLabel('Sign-in name').fill(providerDisplayName);
  await page.getByLabel('Sign-in use').selectOption('direct');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connection', exact: true })).toBeFocused();
  await fillProviderField(page, '#identity-provider-issuer', issuerUrl);
  await fillProviderField(page, '#identity-provider-client-id', clientId);
  if (clientSecretRef) await fillProviderField(page, '#identity-provider-secret-ref', clientSecretRef);
  await fillProviderField(page, '#identity-provider-callback', `${baseUrl.replace(/\/$/, '')}/api/auth/identity/callback`);
  await fillProviderField(page, '#identity-provider-scopes', oidcScopes);
  await fillProviderField(page, '#identity-provider-group-claim', 'groups');
  await fillProviderField(page, '#identity-provider-expected-audience', clientId);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Membership', exact: true })).toBeFocused();
  const emailLinkingToggle = page.getByLabel('Allow verified email account linking');
  if (await emailLinkingToggle.getAttribute('aria-checked') !== 'true') await emailLinkingToggle.press('Space');
  await expect(emailLinkingToggle).toHaveAttribute('aria-checked', 'true');
  if (directoryTenantId) await fillProviderField(page, '#identity-provider-directory-tenant', directoryTenantId);
  // Carbon renders this toggle as a button with role=switch, not a native
  // checkbox. Keyboard activation avoids scroll/overlay geometry and
  // exercises the accessible switch interaction a keyboard user receives.
  const enabledToggle = page.getByLabel('Enable provider');
  await enabledToggle.scrollIntoViewIfNeeded();
  if (await enabledToggle.getAttribute('aria-checked') !== 'true') await enabledToggle.press('Space');
  await expect(enabledToggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Create provider', exact: true }).click();
  await expect(page.getByText(providerKey, { exact: true })).toBeVisible();

  const providerRow = page.getByRole('row').filter({ hasText: providerKey });
  await providerRow.getByRole('button', { name: 'Provider actions' }).click();
  await page.getByRole('menuitem', { name: 'Test connection' }).click();
  await expect(page.getByText(`Provider metadata reachable: ${providerDisplayName}`, { exact: true })).toBeVisible();
}

async function createMappingThroughUi(page: Page, providerKey: string, groupKey: string, groupName: string, engine: Engine): Promise<void> {
  await page.goto('/admin/settings/identity-mappings');
  await page.getByRole('button', { name: 'Create mapping', exact: true }).click();
  await page.getByRole('combobox', { name: 'Identity provider' }).click();
  await page.getByRole('option', { name: `${providerDisplayName} (${providerKey})`, exact: true }).click();
  if (externalEntitlementType !== 'group') {
    await page.locator('#identity-mapping-type').selectOption(externalEntitlementType);
  }
  await page.getByRole('textbox', { name: 'External group, role, or attribute value' }).fill(externalEntitlementId);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  const createGroupChoice = page.getByRole('radio', { name: 'Create a new group', exact: true });
  await createGroupChoice.focus();
  await page.keyboard.press('Space');
  await expect(createGroupChoice).toBeChecked();
  await page.getByLabel('New EnterpriseGlue group name').fill(groupName);
  await page.getByLabel('New group key').fill(groupKey);
  const scopedEngineAccessChoice = page.getByRole('radio', { name: 'Also grant engine access', exact: true });
  await scopedEngineAccessChoice.focus();
  await page.keyboard.press('Space');
  await expect(scopedEngineAccessChoice).toBeChecked();
  await page.getByRole('combobox', { name: 'Engine role' }).click();
  await page.getByRole('option', { name: /engine operator/i }).click();
  await page.locator('#identity-mapping-provision-scope').selectOption('engine');
  await page.locator('#identity-mapping-provision-engine').click();
  await page.getByRole('option', { name: engine.name, exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Review before creating', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create mapping', exact: true }).click();
  await expect(page.getByRole('table').filter({ hasText: providerKey }).getByText(groupKey, { exact: true })).toBeVisible();
}

async function provisionAdditionalScopedRight(
  page: Page,
  csrf: string,
  input: { providerKey: string; groupKey: string; groupName: string; engine: Engine },
): Promise<ProvisionedMapping> {
  // This is the public, transactional API behind the mapping wizard. Keeping
  // the first grant in the UI and using this endpoint for the second grant
  // proves that a headless change can add a right without replacing the first.
  const result = await requestJson<ProvisionedMapping>(page, '/api/identity/mappings/provision-access', {
    method: 'POST',
    csrf,
    data: {
      providerKey: input.providerKey,
      entitlementType: externalEntitlementType,
      externalId: externalEntitlementId,
      matchOperator: 'exact',
      syncMode: 'authoritative',
      newGroup: { key: input.groupKey, name: input.groupName },
      roleId: 'system.engine.operator',
      resourceType: 'engine',
      resourceId: input.engine.id,
    },
  });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  expect(result.body).toMatchObject({
    mapping: { providerKey: input.providerKey, isActive: true },
    assignment: { id: expect.any(String) },
    createdGroup: { id: expect.any(String) },
  });
  return result.body!;
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

  test(`creates a ${profile} provider and independently adds, revokes, and restores scoped rights through supported administration flows @local-oidc-live @identity-authorization-live`, async ({ browser }) => {
    const crossTenantEngineId = process.env.OIDC_REHEARSAL_CROSS_TENANT_ENGINE_ID
      || getE2EFineGrainedFixture().crossTenantEngineId;
    if (requireCrossTenantEvidence) {
      expect(crossTenantEngineId, 'The strict provider-authorization rehearsal requires a seeded cross-tenant engine.').toBeTruthy();
    }
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const providerKey = `local-oidc-authz-${suffix}`;
    const viewGroupKey = `group.local-oidc-view-${suffix}`;
    const viewGroupName = 'Local OIDC viewers';
    const operateGroupKey = `group.local-oidc-operate-${suffix}`;
    const operateGroupName = 'Local OIDC operators';
    const adminContext = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: baseUrl });
    const operatorContext = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: baseUrl });
    const admin = await adminContext.newPage();
    const createdEngines: Engine[] = [];
    const createdGroupIds: string[] = [];
    const createdAssignmentIds: string[] = [];
    let elevatedOperatorContext: BrowserContext | null = null;
    let recoveredOperatorContext: BrowserContext | null = null;

    try {
      await loginLocalAdministrator(admin);
      const csrf = await csrfToken(admin);
      const allowedEngine = await createEngine(admin, csrf, 'OIDC scoped-access test engine');
      const siblingEngine = await createEngine(admin, csrf, 'OIDC sibling test engine');
      createdEngines.push(allowedEngine, siblingEngine);

      await createProviderThroughUi(admin, providerKey);
      await createMappingThroughUi(admin, providerKey, viewGroupKey, viewGroupName, allowedEngine);

      const initialMappings = await requestJson<Mapping[]>(admin, '/api/identity/mappings');
      expect(initialMappings.status).toBe(200);
      const viewMapping = initialMappings.body?.find((candidate) => candidate.providerKey === providerKey);
      expect(viewMapping).toMatchObject({ isActive: true });
      if (viewMapping) createdGroupIds.push(viewMapping.targetGroupId);
      const viewAssignments = await requestJson<RoleAssignment[]>(admin, `/api/authz/role-assignments?principalType=group&principalId=${encodeURIComponent(viewMapping!.targetGroupId)}&resourceType=engine&resourceId=${encodeURIComponent(allowedEngine.id)}`);
      expect(viewAssignments.status, JSON.stringify(viewAssignments.body)).toBe(200);
      const viewAssignment = viewAssignments.body?.find((assignment) => assignment.roleId === 'system.engine.operator');
      expect(viewAssignment).toMatchObject({
        principalType: 'group',
        principalId: viewMapping!.targetGroupId,
        resourceType: 'engine',
        resourceId: allowedEngine.id,
      });
      if (viewAssignment) createdAssignmentIds.push(viewAssignment.id);
      await expect(admin.getByRole('region', { name: 'Create identity mapping' })).toBeHidden();
      await captureLiveScreenshot(admin, '61a-identity-mapping-live-oidc-configuration.png');

      const operator = await signInWithProvider(operatorContext, providerKey);
      const initialInventory = await requestJson<Engine[]>(operator, '/engines-api/engines');
      expect(initialInventory.status, JSON.stringify(initialInventory.body)).toBe(200);
      expect(initialInventory.body?.map((engine) => engine.id)).toEqual([allowedEngine.id]);

      const allowed = await requestJson<Engine>(operator, `/engines-api/engines/${allowedEngine.id}`);
      expect(allowed.status).toBe(200);
      const initiallyDeniedSibling = await requestJson(operator, `/engines-api/engines/${siblingEngine.id}`);
      expect([403, 404]).toContain(initiallyDeniedSibling.status);
      if (crossTenantEngineId) {
        const initiallyDeniedCrossTenant = await requestJson(operator, `/engines-api/engines/${crossTenantEngineId}`);
        expect([403, 404]).toContain(initiallyDeniedCrossTenant.status);
      }
      await operator.goto('/engines');
      await expect(operator.getByRole('heading', { name: 'Engines', exact: true })).toBeVisible();
      await expect(operator.getByText('Showing your assigned engines', { exact: true })).toBeVisible();
      await expect(operator.getByRole('button', { name: 'Add engine', exact: true })).toHaveCount(0);
      await expect(operator.getByText(allowedEngine.name, { exact: true })).toBeVisible();
      await expect(operator.getByRole('cell', { name: 'Operaton', exact: true })).toBeVisible();
      await expect(operator.getByText(siblingEngine.name, { exact: true })).toHaveCount(0);
      await operator.getByRole('button', { name: 'Options', exact: true }).click();
      await expect(operator.getByRole('menuitem', { name: 'View details', exact: true })).toBeVisible();
      await expect(operator.getByRole('menuitem', { name: 'View access', exact: true })).toBeVisible();
      await expect(operator.getByRole('menuitem', { name: 'Test connection', exact: true })).toHaveCount(0);
      await expect(operator.getByRole('menuitem', { name: 'Delete', exact: true })).toHaveCount(0);
      await operator.keyboard.press('Escape');
      await captureLiveScreenshot(operator, '61-identity-provider-scoped-engine-access.png');

      // Add an independent right for the same upstream entitlement. A fresh
      // sign-in is required so the mandatory reconciliation creates only this
      // newly mapped provider membership, while retaining the existing one.
      const provisionedRight = await provisionAdditionalScopedRight(admin, csrf, {
        providerKey,
        groupKey: operateGroupKey,
        groupName: operateGroupName,
        engine: siblingEngine,
      });
      createdGroupIds.push(provisionedRight.createdGroup!.id);
      createdAssignmentIds.push(provisionedRight.assignment.id);
      const operateMapping = provisionedRight.mapping;
      expect(operateMapping).toMatchObject({ isActive: true });

      elevatedOperatorContext = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: baseUrl });
      const elevatedOperator = await signInWithProvider(elevatedOperatorContext, providerKey);
      const elevatedInventory = await requestJson<Engine[]>(elevatedOperator, '/engines-api/engines');
      expect(elevatedInventory.status, JSON.stringify(elevatedInventory.body)).toBe(200);
      expect(elevatedInventory.body?.map((engine) => engine.id).sort()).toEqual([allowedEngine.id, siblingEngine.id].sort());
      expect((await requestJson<Engine>(elevatedOperator, `/engines-api/engines/${allowedEngine.id}`)).status).toBe(200);
      expect((await requestJson<Engine>(elevatedOperator, `/engines-api/engines/${siblingEngine.id}`)).status).toBe(200);
      if (crossTenantEngineId) {
        expect([403, 404]).toContain((await requestJson(elevatedOperator, `/engines-api/engines/${crossTenantEngineId}`)).status);
      }

      // Mapping-provisioned assignments are source-owned. The generic manual
      // assignment endpoint must not bypass that ownership boundary.
      const removeViewAssignmentDirectly = await requestJson<{ error?: string }>(admin, `/api/authz/role-assignments/${viewAssignment!.id}`, {
        method: 'DELETE', csrf,
      });
      expect(removeViewAssignmentDirectly.status, JSON.stringify(removeViewAssignmentDirectly.body)).toBe(400);
      expect(removeViewAssignmentDirectly.body?.error).toBe('Only manual role assignments can be removed here');

      // Revoke and restore through the owning identity mapping. Disabling
      // removes the provider-derived membership immediately; enabling becomes
      // effective after the mandatory reconciliation on the next sign-in.
      const disableViewMapping = await requestJson<Mapping>(admin, `/api/identity/mappings/${viewMapping!.id}`, {
        method: 'PUT', csrf, data: { isActive: false },
      });
      expect(disableViewMapping.status, JSON.stringify(disableViewMapping.body)).toBe(200);
      expect(disableViewMapping.body).toMatchObject({ id: viewMapping!.id, isActive: false });
      const afterAssignmentRemoval = await requestJson<Engine[]>(elevatedOperator, '/engines-api/engines');
      expect(afterAssignmentRemoval.status, JSON.stringify(afterAssignmentRemoval.body)).toBe(200);
      expect(afterAssignmentRemoval.body?.map((engine) => engine.id)).toEqual([siblingEngine.id]);
      expect([403, 404]).toContain((await requestJson(elevatedOperator, `/engines-api/engines/${allowedEngine.id}`)).status);
      expect((await requestJson<Engine>(elevatedOperator, `/engines-api/engines/${siblingEngine.id}`)).status).toBe(200);

      const restoreViewMapping = await requestJson<Mapping>(admin, `/api/identity/mappings/${viewMapping!.id}`, {
        method: 'PUT', csrf, data: { isActive: true },
      });
      expect(restoreViewMapping.status, JSON.stringify(restoreViewMapping.body)).toBe(200);
      expect(restoreViewMapping.body).toMatchObject({ id: viewMapping!.id, isActive: true });
      const restoredContext = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: baseUrl });
      const restoredOperator = await signInWithProvider(restoredContext, providerKey);
      const afterAssignmentRestore = await requestJson<Engine[]>(restoredOperator, '/engines-api/engines');
      expect(afterAssignmentRestore.status, JSON.stringify(afterAssignmentRestore.body)).toBe(200);
      expect(afterAssignmentRestore.body?.map((engine) => engine.id).sort()).toEqual([allowedEngine.id, siblingEngine.id].sort());
      await restoredContext.close();

      // Keycloak's deterministic fixture user lets this use the real recovery
      // UI and backend data instead of a browser-only identity mock. Entra's
      // local profile has a separate subject and retains its focused
      // provider/mapping authorization coverage above.
      let recoveredOperator: Page | null = null;
      if (runsLocalIdentityRecovery) {
        const session = await requestJson<SessionUser>(elevatedOperator, '/api/auth/me');
        expect(session.status, JSON.stringify(session.body)).toBe(200);
        expect(session.body?.id).toBeTruthy();

        await admin.goto('/admin/settings/identity-providers');
        const providerRow = admin.getByRole('row').filter({ hasText: providerKey });
        await providerRow.getByRole('button', { name: 'Provider actions' }).click();
        await admin.getByRole('menuitem', { name: 'Resolve identity conflict' }).click();
        const conflictDialog = admin.getByRole('dialog', { name: 'Resolve external identity conflict' });
        await conflictDialog.getByLabel('External provider subject ID').fill(localOidcOperatorSubjectId);
        await conflictDialog.getByLabel('Currently linked account ID').fill(session.body!.id);
        await conflictDialog.getByRole('button', { name: /Unlink external identity/ }).click();
        await expect(admin.getByText(`External identity unlinked: ${providerDisplayName}`, { exact: true })).toBeVisible();

        const unlinkedSession = await requestJson(elevatedOperator, `/engines-api/engines/${allowedEngine.id}`);
        expect([401, 403, 404]).toContain(unlinkedSession.status);

        recoveredOperatorContext = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: baseUrl });
        recoveredOperator = await signInWithProvider(recoveredOperatorContext, providerKey);
        const recoveredInventory = await requestJson<Engine[]>(recoveredOperator, '/engines-api/engines');
        expect(recoveredInventory.status, JSON.stringify(recoveredInventory.body)).toBe(200);
        expect(recoveredInventory.body?.map((engine) => engine.id).sort()).toEqual([allowedEngine.id, siblingEngine.id].sort());
      }

      const effectiveOperator = recoveredOperator || elevatedOperator;
      const revokeView = await requestJson<Mapping>(admin, `/api/identity/mappings/${viewMapping!.id}`, {
        method: 'PUT', csrf, data: { isActive: false },
      });
      expect(revokeView.status, JSON.stringify(revokeView.body)).toBe(200);
      expect(revokeView.body).toMatchObject({ id: viewMapping!.id, isActive: false });

      const afterViewRevocation = await requestJson<Engine[]>(effectiveOperator, '/engines-api/engines');
      expect(afterViewRevocation.status, JSON.stringify(afterViewRevocation.body)).toBe(200);
      expect(afterViewRevocation.body?.map((engine) => engine.id)).toEqual([siblingEngine.id]);
      expect([403, 404]).toContain((await requestJson(effectiveOperator, `/engines-api/engines/${allowedEngine.id}`)).status);
      expect((await requestJson<Engine>(effectiveOperator, `/engines-api/engines/${siblingEngine.id}`)).status).toBe(200);

      const revokeOperate = await requestJson<Mapping>(admin, `/api/identity/mappings/${operateMapping!.id}`, {
        method: 'PUT', csrf, data: { isActive: false },
      });
      expect(revokeOperate.status, JSON.stringify(revokeOperate.body)).toBe(200);
      expect(revokeOperate.body).toMatchObject({ id: operateMapping!.id, isActive: false });
      const afterFullRevocation = await requestJson<Engine[]>(effectiveOperator, '/engines-api/engines');
      expect(afterFullRevocation.status, JSON.stringify(afterFullRevocation.body)).toBe(200);
      expect(afterFullRevocation.body).toEqual([]);
      expect([403, 404]).toContain((await requestJson(effectiveOperator, `/engines-api/engines/${siblingEngine.id}`)).status);
      if (crossTenantEngineId) {
        expect([403, 404]).toContain((await requestJson(effectiveOperator, `/engines-api/engines/${crossTenantEngineId}`)).status);
      }

      if (runsLocalIdentityRecovery) {
        await admin.goto('/admin/settings/identity-providers');
        const providerRow = admin.getByRole('row').filter({ hasText: providerKey });
        await providerRow.getByRole('button', { name: 'Provider actions' }).click();
        await admin.getByRole('menuitem', { name: 'Disable provider' }).click();
        const disableDialog = admin.getByRole('dialog', { name: `Disable ${providerDisplayName}?` });
        await expect(disableDialog).toContainText('Provider-managed group memberships will be removed immediately');
        await disableDialog.getByRole('button', { name: /Disable provider/ }).click();
        await expect(providerRow).toContainText('Disabled');

        const chooser = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: baseUrl });
        const chooserPage = await chooser.newPage();
        await chooserPage.goto('/login');
        await expect(chooserPage.getByRole('button', { name: `Continue with ${providerDisplayName}`, exact: true })).toHaveCount(0);
        await chooser.close();
      }
    } finally {
      const csrf = await csrfToken(admin).catch(() => null);
      const mappings = await requestJson<Mapping[]>(admin, '/api/identity/mappings').catch(() => ({ status: 0, body: null }));
      const disposableMappings = Array.isArray(mappings.body)
        ? mappings.body.filter((candidate) => candidate.providerKey === providerKey)
        : [];
      for (const mapping of disposableMappings) {
        if (csrf) await requestJson(admin, `/api/identity/mappings/${mapping.id}`, { method: 'DELETE', csrf }).catch(() => undefined);
      }
      for (const assignmentId of createdAssignmentIds) {
        if (csrf) await requestJson(admin, `/api/authz/role-assignments/${assignmentId}`, { method: 'DELETE', csrf }).catch(() => undefined);
      }
      for (const groupId of createdGroupIds) {
        if (csrf) await requestJson(admin, `/api/authz/groups/${groupId}`, { method: 'DELETE', csrf }).catch(() => undefined);
      }
      if (csrf) await requestJson(admin, `/api/identity/providers/${encodeURIComponent(providerKey)}`, { method: 'DELETE', csrf }).catch(() => undefined);
      for (const engine of createdEngines) {
        if (csrf) await requestJson(admin, `/engines-api/engines/${engine.id}`, { method: 'DELETE', csrf }).catch(() => undefined);
      }
      await elevatedOperatorContext?.close();
      await recoveredOperatorContext?.close();
      await operatorContext.close();
      await adminContext.close();
    }
  });
});
