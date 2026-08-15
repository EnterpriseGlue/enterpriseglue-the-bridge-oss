import { expect, test, type BrowserContext, type Page } from '@playwright/test';

function isLocalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname) || url.hostname.endsWith('.local');
  } catch {
    return false;
  }
}

const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'https://localhost:5443';
const enabled = process.env.LOCAL_OIDC_CONFIG_AUTHORIZATION_REHEARSAL === 'true'
  && isLocalUrl(baseUrl)
  && Boolean(process.env.LOCAL_OIDC_ADMIN_EMAIL)
  && Boolean(process.env.LOCAL_OIDC_ADMIN_PASSWORD);
const issuerUrl = process.env.LOCAL_OIDC_ISSUER_URL || 'https://localhost:8180/realms/enterpriseglue-local';
const clientId = process.env.LOCAL_OIDC_CLIENT_ID || 'enterpriseglue-local';
const operatorUsername = process.env.LOCAL_OIDC_TEST_USERNAME || 'oidc-operator';
const operatorPassword = process.env.LOCAL_OIDC_TEST_PASSWORD || 'local-oidc-operator';
const externalEntitlementType = process.env.LOCAL_OIDC_ENTITLEMENT_TYPE === 'role' ? 'role' : 'group';
const externalEntitlementId = process.env.LOCAL_OIDC_ENTITLEMENT_ID || 'operators';

type Engine = { id: string; name: string };
type ConfigPreview = { valid: boolean; canonicalHash: string; requiredAcknowledgements?: string[] };
type ConfigBundleRunSummary = { bundleKey: string; status: string };

async function requestJson<T>(page: Page, path: string, options: { method?: 'GET' | 'POST'; csrf?: string; data?: unknown } = {}) {
  const response = await page.request.fetch(path, {
    method: options.method || 'GET',
    headers: options.csrf ? { 'x-csrf-token': options.csrf } : undefined,
    data: options.data,
    timeout: 30_000,
  });
  let body: T | null = null;
  try { body = await response.json() as T; } catch { /* status-only assertion */ }
  return { status: response.status(), body };
}

async function csrfToken(page: Page): Promise<string> {
  const response = await page.request.get('/api/csrf-token');
  expect(response.status()).toBe(200);
  const token = response.headers()['x-csrf-token'];
  expect(token).toBeTruthy();
  return token;
}

async function loginAdministrator(page: Page): Promise<void> {
  await page.goto('/admin-recovery');
  await page.getByLabel(/email/i).fill(process.env.LOCAL_OIDC_ADMIN_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.LOCAL_OIDC_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Log in for recovery', exact: true }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
}

async function applyBundle(page: Page, csrf: string, envelope: Record<string, unknown>, idempotencyKey: string): Promise<void> {
  const preview = await requestJson<ConfigPreview>(page, '/api/authz/config-bundles/preview', {
    method: 'POST', csrf, data: envelope,
  });
  expect(preview.status, JSON.stringify(preview.body)).toBe(200);
  expect(preview.body).toMatchObject({ valid: true, canonicalHash: expect.any(String) });

  const diff = await requestJson<ConfigPreview>(page, '/api/authz/config-bundles/diff', {
    method: 'POST', csrf, data: envelope,
  });
  expect(diff.status, JSON.stringify(diff.body)).toBe(200);
  expect(diff.body).toMatchObject({ valid: true, canonicalHash: preview.body!.canonicalHash });

  const applied = await requestJson(page, '/api/authz/config-bundles/apply', {
    method: 'POST', csrf,
    data: {
      ...envelope,
      expectedPreviewHash: preview.body!.canonicalHash,
      acknowledgements: diff.body?.requiredAcknowledgements || [],
      idempotencyKey,
      identityReconciliationMode: 'none',
    },
  });
  expect([200, 202], JSON.stringify(applied.body)).toContain(applied.status);
}

async function signInWithKeycloak(context: BrowserContext, providerKey: string, throughChooser = false, displayName = providerKey): Promise<Page> {
  const page = await context.newPage();
  if (throughChooser) {
    await page.goto('/login');
    const escapedDisplayName = displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await page.getByRole('button', { name: new RegExp(`^Continue with ${escapedDisplayName}(?:$|\\s)`) }).click();
  } else {
    await page.goto(`/api/auth/identity/${encodeURIComponent(providerKey)}/start`);
  }
  await page.locator('input[name="username"]').fill(operatorUsername);
  await page.locator('input[name="password"]').fill(operatorPassword);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(new RegExp(`${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(?:$|[?#])`));
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  return page;
}

function emptyBundle(bundle: ReturnType<typeof bundleFor>) {
  return {
    ...bundle,
    files: Object.fromEntries(Object.entries(bundle.files).map(([path, value]) => {
      const [property] = Object.keys(value as Record<string, unknown>);
      return [path, { [property]: [] }];
    })),
  };
}

function bundleFor(input: { bundleKey: string; providerKey: string; groupKey: string; engineKey: string; includeMapping: boolean }) {
  const imports = ['./groups.json', './engines.json', './assignments.json', './identity-providers.json', './identity-mappings.json'];
  return {
    bundle: {
      apiVersion: 'enterpriseglue.ai/v1beta1',
      kind: 'EnterpriseGlueConfigBundle',
      metadata: { key: input.bundleKey, owner: 'local-oidc-rehearsal' },
      tenantKey: 'default',
      mode: 'authoritative',
      imports,
    },
    files: {
      './groups.json': { groups: [{ key: input.groupKey, name: `Configured OIDC operators ${input.bundleKey}`, ownershipMode: 'config_locked' }] },
      './engines.json': { engines: [{
        key: input.engineKey,
        name: `Configured OIDC engine ${input.bundleKey}`,
        type: 'operaton',
        baseUrl: 'http://camunda-mock:9080/engine-rest',
        auth: { type: 'basic', username: 'e2e', passwordRef: 'env://E2E_ENGINE_PASSWORD' },
        connectionMode: 'direct',
        runtimeAccessScope: 'engine_wide',
        tenancy: { mode: 'dedicated', tenantRef: { type: 'default' } },
        metadataDiscoveryEnabled: false,
        deploymentDiscoveryEnabled: false,
        pipelineReceiptEnabled: false,
        ownershipMode: 'config_locked',
      }] },
      './assignments.json': { assignments: [{
        key: `assignment.${input.bundleKey}`,
        principal: { type: 'group', key: input.groupKey },
        roleKey: 'system.engine.operator',
        scope: { type: 'engine', engineKey: input.engineKey },
        ownershipMode: 'config_locked',
      }] },
      './identity-providers.json': { identityProviders: [{
        key: input.providerKey,
        displayName: 'Configured OIDC identity',
        organization: 'Local acceptance environment',
        displayOrder: 20,
        preferred: false,
        loginDomains: ['identity-mock.test'],
        type: 'oidc',
        enabled: true,
        authenticationMode: 'direct',
        allowVerifiedEmailLinking: true,
        sync: {
          triggers: ['login'],
          requiredForLogin: true,
          incompleteEntitlements: 'fail_closed',
          connectorCapability: 'claim_only',
          scheduled: false,
        },
        oidc: {
          issuerUrl,
          clientId,
          callbackUrl: `${baseUrl.replace(/\/$/, '')}/api/auth/identity/callback`,
          scopes: ['openid', 'profile', 'email'],
          groupClaim: 'groups',
          expectedAudience: clientId,
        },
        ownershipMode: 'config_locked',
      }] },
      './identity-mappings.json': { identityMappings: input.includeMapping ? [{
        key: `mapping.${input.bundleKey}`,
        providerKey: input.providerKey,
        source: { type: externalEntitlementType, externalId: externalEntitlementId, operator: 'exact' },
        targetGroupKey: input.groupKey,
        syncMode: 'authoritative',
        ownershipMode: 'config_locked',
      }] : [] },
    },
  };
}

async function cleanInterruptedConfigFixtures(page: Page, csrf: string): Promise<void> {
  const runs = await requestJson<ConfigBundleRunSummary[]>(page, '/api/authz/config-bundles/runs?limit=100');
  expect(runs.status, JSON.stringify(runs.body)).toBe(200);
  const staleBundleKeys = [...new Set((runs.body || [])
    .map((run) => run.bundleKey)
    .filter((key) => key.startsWith('e2e.oidc-config.')))];
  for (const bundleKey of staleBundleKeys) {
    const staleSuffix = bundleKey.slice('e2e.oidc-config.'.length);
    const staleBundle = bundleFor({
      bundleKey,
      providerKey: `identity.oidc.config.${staleSuffix}`,
      groupKey: `group.oidc-config.${staleSuffix}`,
      engineKey: `engine.oidc-config.${staleSuffix}`,
      includeMapping: false,
    });
    await applyBundle(page, csrf, emptyBundle(staleBundle), `oidc-config-recovered-cleanup-${staleSuffix}`);
  }
}

test.describe('Local OIDC configuration-to-login authorization rehearsal', () => {
  test.setTimeout(180_000);
  test.skip(!enabled, 'Set LOCAL_OIDC_CONFIG_AUTHORIZATION_REHEARSAL=true with local administrator credentials.');

  test('applies an authoritative bundle, signs in through its OIDC provider, and revokes access after mapping removal @local-oidc-live @identity-configuration-live', async ({ browser }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const bundleKey = `e2e.oidc-config.${suffix}`;
    const providerKey = `identity.oidc.config.${suffix}`;
    const groupKey = `group.oidc-config.${suffix}`;
    const engineKey = `engine.oidc-config.${suffix}`;
    const adminContext = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: baseUrl });
    const operatorContext = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: baseUrl });
    const admin = await adminContext.newPage();
    let csrf: string | null = null;
    let granted: ReturnType<typeof bundleFor> | null = null;

    try {
      await loginAdministrator(admin);
      csrf = await csrfToken(admin);
      await cleanInterruptedConfigFixtures(admin, csrf);
      granted = bundleFor({ bundleKey, providerKey, groupKey, engineKey, includeMapping: true });
      await applyBundle(admin, csrf, granted, `oidc-config-create-${suffix}`);

      const chooser = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: baseUrl });
      const chooserPage = await chooser.newPage();
      await chooserPage.goto('/login');
      await expect(chooserPage.getByRole('button', { name: 'Continue with local-keycloak-oidc', exact: true })).toBeVisible();
      await expect(chooserPage.getByRole('button', { name: 'Continue with Configured OIDC identity Local acceptance environment', exact: true })).toHaveCount(1);
      await chooser.close();

      const operator = await signInWithKeycloak(operatorContext, providerKey, true, 'Configured OIDC identity');
      const visible = await requestJson<Engine[]>(operator, '/engines-api/engines');
      expect(visible.status, JSON.stringify(visible.body)).toBe(200);
      expect(visible.body).toHaveLength(1);
      expect(visible.body?.[0]?.name).toBe(`Configured OIDC engine ${bundleKey}`);

      const revoked = bundleFor({ bundleKey, providerKey, groupKey, engineKey, includeMapping: false });
      await applyBundle(admin, csrf, revoked, `oidc-config-revoke-${suffix}`);
      const denied = await requestJson(operator, `/engines-api/engines/${visible.body![0].id}`);
      expect([403, 404]).toContain(denied.status);
    } finally {
      if (csrf && granted) {
        await applyBundle(admin, csrf, emptyBundle(granted), `oidc-config-cleanup-${suffix}`).catch(() => undefined);
      }
      await operatorContext.close();
      await adminContext.close();
    }
  });
});
