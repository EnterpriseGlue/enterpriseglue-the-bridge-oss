import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto';
import { expect, test, type APIResponse, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { Client } from 'pg';
import { captureManualScreenshot, manualScreenshotDirectory } from './utils/manualScreenshots';

type JsonObject = Record<string, any>;

const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'https://localhost:5443';
const enabled = process.env.POOLED_TENANCY_E2E === 'true' && isLocalUrl(baseUrl);
const adminEmail = process.env.POOLED_TENANCY_ADMIN_EMAIL || '';
const adminPassword = process.env.POOLED_TENANCY_ADMIN_PASSWORD || '';
const oidcIssuer = process.env.POOLED_TENANCY_OIDC_ISSUER_URL || '';
const oidcClientSecret = process.env.POOLED_TENANCY_OIDC_CLIENT_SECRET || '';
const oidcUsername = process.env.POOLED_TENANCY_OIDC_USERNAME || 'oidc-operator';
const oidcPassword = process.env.POOLED_TENANCY_OIDC_PASSWORD || 'local-oidc-operator';
const samlUsername = process.env.POOLED_TENANCY_SAML_USERNAME || 'saml-operator';
const samlPassword = process.env.POOLED_TENANCY_SAML_PASSWORD || 'local-saml-operator';
const ldapUsername = process.env.POOLED_TENANCY_LDAP_USERNAME || 'browser-login@identity-mock.test';
const ldapPassword = process.env.EG_LDAP_TEST_BROWSER_USER_PASSWORD || '';
const postgresHost = process.env.POOLED_TENANCY_POSTGRES_HOST || '';
const postgresPort = Number(process.env.POOLED_TENANCY_POSTGRES_PORT || 0);
const postgresUser = process.env.POOLED_TENANCY_POSTGRES_USER || '';
const postgresPassword = process.env.POOLED_TENANCY_POSTGRES_PASSWORD || '';
const postgresDatabase = process.env.POOLED_TENANCY_POSTGRES_DATABASE || '';
const eligibilityPrivateKeyFile = process.env.POOLED_TENANCY_ELIGIBILITY_PRIVATE_KEY_FILE || '';
const eligibilityIssuer = process.env.POOLED_TENANCY_ELIGIBILITY_ISSUER || '';
const eligibilityAudience = process.env.POOLED_TENANCY_ELIGIBILITY_AUDIENCE || '';
const referencePluginDataDir = process.env.POOLED_TENANCY_REFERENCE_PLUGIN_DATA_DIR || '';
const referencePluginId = 'io.enterpriseglue.reference-health';
const referencePluginVersion = '0.1.0';
const referencePluginRelease = `registry.invalid/pooled-reference@sha256:${'1'.repeat(64)}`;
const referenceStatusOperation = `${referencePluginId}.read-status`;
const referenceQualificationOperation = `${referencePluginId}.qualify-runtime`;
const referenceScheduleDeliveryOperation = `${referencePluginId}.deliver-scheduled-health`;
const referenceEventDeliveryOperation = `${referencePluginId}.consume-engine-inventory`;
const referenceEventType = 'io.enterpriseglue.host.engine-inventory.v1';

function isLocalUrl(value: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

async function json(response: APIResponse): Promise<JsonObject> {
  return response.json().catch(() => ({}));
}

async function expectStatus(response: APIResponse, status: number): Promise<JsonObject> {
  const body = await json(response);
  expect(response.status(), JSON.stringify(body)).toBe(status);
  return body;
}

let eligibilityPrivateKeyPromise: Promise<ReturnType<typeof createPrivateKey>> | undefined;

function signedTenantEligibility(input: {
  tenantRef: string;
  state: 'trial' | 'active' | 'grace' | 'expired' | 'revoked' | 'unavailable';
  revision: number;
}): Promise<string> {
  eligibilityPrivateKeyPromise ??= readFile(eligibilityPrivateKeyFile, 'utf8')
    .then((pem) => createPrivateKey(pem));
  return eligibilityPrivateKeyPromise.then((privateKey) => {
    const now = Math.floor(Date.now() / 1_000);
    const header = Buffer.from(JSON.stringify({
      alg: 'ES256',
      kid: 'pooled-e2e-eligibility-1',
      typ: 'JWT',
    })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      schemaVersion: 'tenant-eligibility.plugin.enterpriseglue.io/v1',
      iss: eligibilityIssuer,
      aud: eligibilityAudience,
      jti: `pooled-e2e-${input.tenantRef}-${input.revision}`,
      tenantRef: input.tenantRef,
      pluginId: referencePluginId,
      pluginVersion: referencePluginVersion,
      release: referencePluginRelease,
      state: input.state,
      effectiveFrom: null,
      effectiveUntil: new Date((now + 1_800) * 1_000).toISOString(),
      limitsHash: '0'.repeat(64),
      revision: input.revision,
      projectionRef: `pooled-e2e-projection-${input.tenantRef}`,
      iat: now - 5,
      exp: now + 3_600,
    })).toString('base64url');
    const signature = sign(
      'sha256',
      Buffer.from(`${header}.${payload}`, 'ascii'),
      { key: privateKey, dsaEncoding: 'ieee-p1363' },
    ).toString('base64url');
    return `${header}.${payload}.${signature}`;
  });
}

async function applyTenantEligibility(input: {
  page: Page;
  token: string;
  tenantRef: string;
  state: 'trial' | 'active' | 'grace' | 'expired' | 'revoked' | 'unavailable';
  revision: number;
}): Promise<JsonObject> {
  return expectStatus(await input.page.request.put(
    `/api/workloads/tenants/${encodeURIComponent(input.tenantRef)}/apps/${referencePluginId}/eligibility`,
    {
      headers: {
        authorization: `Bearer ${input.token}`,
        'x-correlation-id': `pooled-e2e-eligibility-${input.revision}`,
      },
      data: {
        signedProjection: await signedTenantEligibility(input),
      },
    },
  ), 200);
}

async function csrfToken(page: Page): Promise<string> {
  const response = await page.request.get('/api/csrf-token');
  expect(response.status()).toBe(200);
  const token = response.headers()['x-csrf-token'];
  expect(token).toBeTruthy();
  return token;
}

async function post(page: Page, path: string, data?: JsonObject): Promise<APIResponse> {
  return page.request.post(path, {
    headers: { 'X-CSRF-Token': await csrfToken(page) },
    ...(data === undefined ? {} : { data }),
  });
}

async function put(page: Page, path: string, data: JsonObject): Promise<APIResponse> {
  return page.request.put(path, { headers: { 'X-CSRF-Token': await csrfToken(page) }, data });
}

async function remove(page: Page, path: string): Promise<APIResponse> {
  return page.request.delete(path, { headers: { 'X-CSRF-Token': await csrfToken(page) } });
}

async function newAppContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ baseURL: baseUrl, ignoreHTTPSErrors: true });
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  )).toBe(true);
}

async function captureResponsiveScreenshot(page: Page, fileName: string): Promise<void> {
  if (!manualScreenshotDirectory) return;
  const directory = resolve(manualScreenshotDirectory, '..', 'responsive');
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: resolve(directory, fileName),
    type: 'jpeg',
    quality: 90,
    animations: 'disabled',
    caret: 'hide',
  });
}

async function assertTenantSession(context: BrowserContext, tenant: { id: string; slug: string }, siblingSlug: string) {
  const meResponse = await context.request.get('/api/auth/me');
  const me = await expectStatus(meResponse, 200);
  expect(me.session?.tenant).toEqual({ id: tenant.id });

  const membershipsResponse = await context.request.get('/api/auth/my-tenants');
  const memberships = await membershipsResponse.json().catch(() => []);
  expect(membershipsResponse.status(), JSON.stringify(memberships)).toBe(200);
  expect(memberships).toEqual([
    expect.objectContaining({ tenantId: tenant.id, tenantSlug: tenant.slug, role: 'member' }),
  ]);

  await expectStatus(await context.request.get(`/api/t/${tenant.slug}/tenant`), 200);
  await expectStatus(await context.request.get(`/api/t/${siblingSlug}/tenant`), 403);
}

async function markDiscoveryDomainVerified(domainId: string): Promise<void> {
  const client = new Client({
    host: postgresHost,
    port: postgresPort,
    user: postgresUser,
    password: postgresPassword,
    database: postgresDatabase,
  });
  await client.connect();
  try {
    // DNS proof itself is covered by the injected-resolver service test. The disposable browser
    // lane promotes that completed proof directly so it can exercise verified-email routing
    // without depending on public DNS.
    const result = await client.query(
      'UPDATE main.tenant_discovery_domains SET status = $1, verified_at = $2, verification_token_hash = NULL, updated_at = $2 WHERE id = $3',
      ['verified', Date.now(), domainId],
    );
    expect(result.rowCount).toBe(1);
  } finally {
    await client.end();
  }
}

async function databaseRows(sql: string, parameters: unknown[] = []): Promise<JsonObject[]> {
  const client = new Client({
    host: postgresHost,
    port: postgresPort,
    user: postgresUser,
    password: postgresPassword,
    database: postgresDatabase,
  });
  await client.connect();
  try {
    return (await client.query(sql, parameters)).rows;
  } finally {
    await client.end();
  }
}

async function forceScheduledJobDue(jobRef: string): Promise<void> {
  const rows = await databaseRows(
    `UPDATE main.plugin_scheduled_jobs
     SET next_run_at = $1, status = 'scheduled', lease_owner = NULL, lease_expires_at = NULL, updated_at = $1
     WHERE job_ref = $2
     RETURNING job_ref`,
    [Date.now() - 1_000, jobRef],
  );
  expect(rows).toEqual([{ job_ref: jobRef }]);
}

async function enqueueEngineInventoryEvent(input: {
  tenantRef: string;
  deliveryRef: string;
  dueAt?: number;
}): Promise<string> {
  const now = Date.now();
  const deliveryId = `pooled-e2e-${input.deliveryRef}`;
  const event = {
    specversion: '1.0',
    id: `event-${input.deliveryRef}`,
    source: 'enterpriseglue-oss',
    type: referenceEventType,
    subject: `engine-${input.deliveryRef}`,
    time: new Date(now).toISOString(),
    dataschema: 'https://schemas.enterpriseglue.io/events/engine-inventory-v1.json',
    tenantRef: input.tenantRef,
    data: {
      engineRef: `engine-${input.deliveryRef}`,
      product: 'operaton',
      version: '7.24.0',
      observedAtBucket: new Date(now).toISOString(),
    },
  };
  const eventJson = JSON.stringify(event);
  await databaseRows(
    `INSERT INTO main.plugin_event_deliveries (
       id, delivery_id, plugin_id, deployment_ref, tenant_ref,
       subscription_type, operation_id, event_id, event_sha256, event_json,
       status, attempt, max_attempts, next_attempt_at, lease_owner,
       lease_expires_at, reason_code, delivered_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'oss-deployment', $4,
       $5, $6, $7, $8, $9,
       'pending', 0, 3, $10, NULL,
       NULL, 'queued', NULL, $11, $11
     )`,
    [
      randomUUID(),
      deliveryId,
      referencePluginId,
      input.tenantRef,
      referenceEventType,
      referenceEventDeliveryOperation,
      event.id,
      createHash('sha256').update(eventJson).digest('hex'),
      eventJson,
      input.dueAt ?? now,
      now,
    ],
  );
  return deliveryId;
}

async function forcePluginEventDue(deliveryId: string): Promise<void> {
  const rows = await databaseRows(
    `UPDATE main.plugin_event_deliveries
     SET next_attempt_at = $1, status = 'pending', lease_owner = NULL, lease_expires_at = NULL, updated_at = $1
     WHERE delivery_id = $2
     RETURNING delivery_id`,
    [Date.now() - 1_000, deliveryId],
  );
  expect(rows).toEqual([{ delivery_id: deliveryId }]);
}

async function pluginDeliveryEvidence(): Promise<JsonObject[]> {
  try {
    const text = await readFile(
      resolve(referencePluginDataDir, 'qualification-deliveries.jsonl'),
      'utf8',
    );
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error: any) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function oidcLoginFromOrganizationFinder(browser: Browser, tenantSlug: string, displayName: string, email: string): Promise<BrowserContext> {
  const context = await newAppContext(browser);
  const page = await context.newPage();
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Find your organization' })).toBeVisible();
  await expect(page.getByLabel('Work email')).toBeFocused();
  await captureManualScreenshot(page, '01-neutral-organization-finder.jpg');
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(new RegExp(`/t/${tenantSlug}/login(?:$|[?#])`));
  await page.getByRole('button', { name: new RegExp(`Continue with ${displayName}`) }).click();
  await page.locator('input[name="username"]').fill(oidcUsername);
  await page.locator('input[name="password"]').fill(oidcPassword);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(new RegExp(`/t/${tenantSlug}/(?:$|[?#])`));
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  return context;
}

async function assertWorkspaceFallback(browser: Browser, tenantSlug: string): Promise<void> {
  const context = await newAppContext(browser);
  try {
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByRole('button', { name: 'Use an organization name instead' }).click();
    await page.getByLabel('Organization name').fill(tenantSlug);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenantSlug}/login(?:$|[?#])`));
  } finally {
    await context.close();
  }
}

async function assertOrganizationFinderResponsive(browser: Browser): Promise<void> {
  const context = await newAppContext(browser);
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Find your organization' })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await captureResponsiveScreenshot(page, '01-neutral-organization-finder-narrow.jpg');
  } finally {
    await context.close();
  }
}

async function samlLogin(browser: Browser, tenantSlug: string, providerId: string): Promise<BrowserContext> {
  const context = await newAppContext(browser);
  const page = await context.newPage();
  await page.goto(`/api/t/${tenantSlug}/auth/providers/${encodeURIComponent(providerId)}/start`);
  await page.locator('input[name="username"]').fill(samlUsername);
  await page.locator('input[name="password"]').fill(samlPassword);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(new RegExp(`/t/${tenantSlug}/(?:$|[?#])`));
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  return context;
}

async function ldapLogin(browser: Browser, tenantSlug: string, providerId: string, displayName: string): Promise<BrowserContext> {
  const context = await newAppContext(browser);
  const page = await context.newPage();
  await page.goto(`/t/${tenantSlug}/login`);
  await page.getByRole('button', { name: new RegExp(`Continue with ${displayName}`) }).click();
  await page.getByLabel('Username').fill(ldapUsername);
  await page.getByLabel('Password', { exact: true }).fill(ldapPassword);
  const loginResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST'
      && url.pathname === `/api/t/${tenantSlug}/auth/providers/${encodeURIComponent(providerId)}/login`;
  });
  await page.getByRole('button', { name: /^Log in$/ }).click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(`/t/${tenantSlug}/(?:$|[?#])`));
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  return context;
}

async function identityFixtureSecrets(): Promise<{
  samlSigningCertificate: string;
  ldapBindPassword: string;
  ldapTlsTrustCertificate: string;
}> {
  const secretDir = process.env.LOCAL_IDENTITY_SECRET_DIR || '';
  const caPath = process.env.EG_LDAP_TEST_CA_CERT_PATH || '';
  const bindPassword = process.env.EG_LDAP_TEST_ADMIN_PASSWORD || '';
  if (!secretDir || !caPath || !bindPassword || !ldapPassword) throw new Error('Disposable LDAP fixture inputs are missing');
  return {
    samlSigningCertificate: await readFile(`${secretDir}/keycloak-saml-signing.crt`, 'utf8'),
    ldapBindPassword: bindPassword,
    ldapTlsTrustCertificate: await readFile(caPath, 'utf8'),
  };
}

test.describe('Native pooled tenancy with segregated SSO', () => {
  test.skip(!enabled || !adminEmail || !adminPassword || !oidcIssuer || !oidcClientSecret || !ldapPassword
    || !postgresHost || !postgresPort || !postgresUser || !postgresPassword || !postgresDatabase
    || !referencePluginDataDir,
    'Run through test:native-tenancy:pooled-e2e with the disposable identity fixtures.');

  test('isolates tenant providers and completes OIDC, SAML, and LDAP tenant sign-in @pooled-tenancy-live @segregated-sso-live', async ({ browser }) => {
    test.setTimeout(240_000);
    const fixtureSecrets = await identityFixtureSecrets();
    const adminContext = await newAppContext(browser);
    const admin = await adminContext.newPage();
    const userContexts: BrowserContext[] = [];

    try {
      const recovery = await expectStatus(await admin.request.post('/api/auth/recovery/login', {
        data: { email: adminEmail, password: adminPassword },
      }), 200);
      const administratorId = recovery.user?.id;
      expect(administratorId).toBeTruthy();

      const capabilities = await expectStatus(await admin.request.get('/api/tenancy/capabilities'), 200);
      expect(capabilities).toMatchObject({
        mode: 'pooled',
        rootTenantAliasesEnabled: false,
        tenantScopedLoginRequired: true,
        databaseIsolation: 'postgres_rls',
        organizationDiscoveryEnabled: true,
      });

      const tenants: Record<string, JsonObject & { id: string; slug: string }> = {};
      for (const [slug, name] of [['alpha', 'Alpha Industries'], ['bravo', 'Bravo Services'], ['charlie', 'Charlie Operations']]) {
        const tenant = await expectStatus(await post(admin, '/api/platform/tenants', {
          name,
          slug,
          ownerUserId: administratorId,
          placementKey: 'pooled-e2e',
        }), 201);
        expect(tenant).toMatchObject({ id: expect.any(String), slug });
        tenants[slug] = tenant as JsonObject & { id: string; slug: string };
      }

      const eligibilityServiceAccount = await expectStatus(await post(
        admin,
        '/api/authz/service-accounts',
        {
          name: 'Pooled E2E tenant eligibility controller',
          description: 'Disposable workload identity for signed eligibility qualification',
          scopes: ['tenant:lifecycle'],
        },
      ), 201);
      expect(eligibilityServiceAccount.account).toMatchObject({
        scopes: ['tenant:lifecycle'],
        isActive: true,
      });
      const eligibilityToken = eligibilityServiceAccount.token as string;
      expect(eligibilityToken).toMatch(/^egsa_/);
      const alphaEligibility = await applyTenantEligibility({
        page: admin,
        token: eligibilityToken,
        tenantRef: tenants.alpha.id,
        state: 'active',
        revision: 1,
      });
      const bravoEligibility = await applyTenantEligibility({
        page: admin,
        token: eligibilityToken,
        tenantRef: tenants.bravo.id,
        state: 'trial',
        revision: 1,
      });
      const charlieEligibility = await applyTenantEligibility({
        page: admin,
        token: eligibilityToken,
        tenantRef: tenants.charlie.id,
        state: 'revoked',
        revision: 1,
      });
      expect(alphaEligibility).toMatchObject({ state: 'active', revision: 1 });
      expect(bravoEligibility).toMatchObject({ state: 'trial', revision: 1 });
      expect(charlieEligibility).toMatchObject({ state: 'revoked', revision: 1 });
      expect(JSON.stringify(alphaEligibility)).not.toMatch(/tenantRef|signedProjection|price|agreement/i);

      const secretInputs = {
        alpha: { purpose: 'oidc.client_secret', value: oidcClientSecret },
        bravo: { purpose: 'saml.idp_signing_certificate', value: fixtureSecrets.samlSigningCertificate },
        charlieBind: { purpose: 'ldap.bind_password', value: fixtureSecrets.ldapBindPassword },
        charlieTrust: { purpose: 'ldap.tls_trust_certificate', value: fixtureSecrets.ldapTlsTrustCertificate },
      } as const;
      const provisionSecret = async (slug: string, purpose: string, value: string) => {
        const secret = await expectStatus(await post(admin, `/api/t/${slug}/identity/provider-secrets`, { purpose, value }), 201);
        expect(secret).toMatchObject({ purpose, previousRetired: false });
        expect(secret.reference).toMatch(new RegExp(`^ref:tenant-secret://v1/${tenants[slug].id}/${purpose.replace('.', '\\.')}/`));
        expect(JSON.stringify(secret)).not.toContain(value);
        return secret.reference as string;
      };
      const secretReferences = {
        alpha: await provisionSecret('alpha', secretInputs.alpha.purpose, secretInputs.alpha.value),
        bravo: await provisionSecret('bravo', secretInputs.bravo.purpose, secretInputs.bravo.value),
        charlieBind: await provisionSecret('charlie', secretInputs.charlieBind.purpose, secretInputs.charlieBind.value),
        charlieTrust: await provisionSecret('charlie', secretInputs.charlieTrust.purpose, secretInputs.charlieTrust.value),
      };
      await expectStatus(await post(admin, '/api/t/bravo/identity/provider-secrets/retire', {
        purpose: 'oidc.client_secret',
        reference: secretReferences.alpha,
        confirmation: 'RETIRE_IDENTITY_PROVIDER_SECRET',
      }), 400);

      await admin.goto('/admin/tenants');
      await expect(admin.getByRole('heading', { name: 'Tenants', exact: true })).toBeVisible();
      for (const name of ['Alpha Industries', 'Bravo Services', 'Charlie Operations']) {
        await expect(admin.getByRole('heading', { name })).toBeVisible();
      }
      await captureManualScreenshot(admin, '02-pooled-tenant-administration.jpg');

      const discoveryDomains: Record<string, JsonObject> = {};
      for (const slug of ['alpha', 'bravo']) {
        const created = await expectStatus(await post(admin, `/api/t/${slug}/tenant/discovery-domains`, {
          domain: `${slug}.example`,
        }), 201);
        discoveryDomains[slug] = created.domain;
        expect(created).toMatchObject({
          domain: { tenantId: tenants[slug].id, domain: `${slug}.example`, status: 'pending' },
          dnsRecord: {
            name: `_enterpriseglue-discovery.${slug}.example`,
            type: 'TXT',
          },
        });
      }
      await expectStatus(await post(admin, '/api/t/alpha/tenant/discovery-domains', { domain: 'gmail.com' }), 400);

      for (const slug of ['alpha', 'bravo']) {
        const listed = await expectStatus(await admin.request.get(`/api/t/${slug}/tenant/discovery-domains`), 200);
        expect(listed).toEqual([
          expect.objectContaining({ id: discoveryDomains[slug].id, tenantId: tenants[slug].id, domain: `${slug}.example`, status: 'pending' }),
        ]);
      }

      const unknownDiscovery = await expectStatus(await post(admin, '/api/auth/tenant-discovery', {
        email: 'unknown@unmapped.example',
      }), 200);
      const pendingDiscovery = await expectStatus(await post(admin, '/api/auth/tenant-discovery', {
        email: 'employee@alpha.example',
      }), 200);
      expect(unknownDiscovery).toEqual({ status: 'verification_sent', message: expect.any(String) });
      expect(pendingDiscovery).toEqual(unknownDiscovery);
      await markDiscoveryDomainVerified(discoveryDomains.alpha.id);

      const callbackUrl = `${baseUrl}/api/auth/identity/callback`;
      const samlCallbackUrl = `${baseUrl}/api/auth/providers/saml/callback`;
      const providerPayloads: Record<string, JsonObject> = {
        alpha: {
          key: 'tenant-sso',
          displayName: 'Alpha OIDC',
          organization: 'Alpha Industries',
          protocol: 'oidc',
          isEnabled: true,
          authenticationMode: 'direct',
          configuration: {
            issuerUrl: oidcIssuer,
            clientId: 'enterpriseglue-local',
            clientSecretRef: secretReferences.alpha,
            callbackUrl,
            scopes: ['openid', 'profile', 'email'],
            groupClaim: 'groups',
            expectedAudience: 'enterpriseglue-local',
            allowVerifiedEmailLinking: true,
          },
          sync: { triggers: ['login', 'manual'], requiredForLogin: true, incompleteEntitlements: 'fail_closed', connectorCapability: 'claim_only', scheduled: false },
        },
        bravo: {
          key: 'tenant-sso',
          displayName: 'Bravo SAML',
          organization: 'Bravo Services',
          protocol: 'saml',
          isEnabled: true,
          authenticationMode: 'direct',
          configuration: {
            entityId: 'enterpriseglue-local-saml',
            idpEntityId: oidcIssuer,
            callbackUrl: samlCallbackUrl,
            ssoUrl: `${oidcIssuer}/protocol/saml`,
            metadataUrl: `${oidcIssuer}/protocol/saml/descriptor`,
            signingCertificateRef: secretReferences.bravo,
            signatureAlgorithm: 'sha256',
            nameIdAttribute: 'nameID',
            emailAttribute: 'email',
            groupAttribute: 'groups',
          },
          sync: { triggers: ['login', 'manual'], requiredForLogin: true, incompleteEntitlements: 'fail_closed', connectorCapability: 'claim_only', scheduled: false },
        },
        charlie: {
          key: 'tenant-sso',
          displayName: 'Charlie Directory',
          organization: 'Charlie Operations',
          protocol: 'ldap',
          isEnabled: true,
          authenticationMode: 'direct',
          configuration: {
            url: 'ldaps://openldap:636',
            bindDn: process.env.EG_LDAP_TEST_BIND_DN,
            bindPasswordRef: secretReferences.charlieBind,
            userBaseDn: 'ou=people,dc=identity-mock,dc=test',
            userSearchFilter: '(&(mail={username})(employeeType=active))',
            userEnumerationFilter: '(&(objectClass=inetOrgPerson)(employeeType=active))',
            pageSize: 10,
            groupBaseDn: 'ou=groups,dc=identity-mock,dc=test',
            groupIdAttribute: 'businessCategory',
            membershipMode: 'group_search',
            nestedGroups: true,
            tlsTrustRef: secretReferences.charlieTrust,
            allowVerifiedEmailLinking: true,
          },
          sync: { triggers: ['login', 'manual'], requiredForLogin: true, incompleteEntitlements: 'fail_closed', connectorCapability: 'ldap_directory', scheduled: false },
        },
      };

      const providers: Record<string, JsonObject> = {};
      for (const slug of ['alpha', 'bravo', 'charlie']) {
        providers[slug] = await expectStatus(await post(admin, `/api/t/${slug}/identity/providers`, providerPayloads[slug]), 201);
        await expectStatus(await post(admin, `/api/t/${slug}/identity/providers/tenant-sso/test-connection`), 200);
        await expectStatus(await put(admin, `/api/t/${slug}/tenant/login-policy`, {
          localPasswordMode: 'disabled',
          providerSelectionMode: 'chooser',
        }), 200);
      }

      const rotatedAlphaSecret = await expectStatus(await put(
        admin,
        '/api/t/alpha/identity/providers/tenant-sso/secrets/oidc.client_secret',
        { value: oidcClientSecret },
      ), 200);
      expect(rotatedAlphaSecret).toMatchObject({ purpose: 'oidc.client_secret', previousRetired: true });
      expect(rotatedAlphaSecret.reference).not.toBe(secretReferences.alpha);
      expect(JSON.stringify(rotatedAlphaSecret)).not.toContain(oidcClientSecret);
      const alphaSecretAvailability = await expectStatus(await admin.request.get(
        '/api/t/alpha/identity/providers/tenant-sso/secrets/oidc.client_secret/availability',
      ), 200);
      expect(alphaSecretAvailability).toMatchObject({ purpose: 'oidc.client_secret', configured: true, available: true });

      expect(new Set(Object.values(providers).map((provider) => provider.id)).size).toBe(3);
      expect(Object.values(providers).map((provider) => provider.key)).toEqual(['tenant-sso', 'tenant-sso', 'tenant-sso']);

      for (const slug of ['alpha', 'bravo', 'charlie']) {
        const listedResponse = await admin.request.get(`/api/t/${slug}/identity/providers`);
        const listed = await listedResponse.json().catch(() => []);
        expect(listedResponse.status(), JSON.stringify(listed)).toBe(200);
        expect(listed).toHaveLength(1);
        expect(listed[0]).toMatchObject({ id: providers[slug].id, key: 'tenant-sso', protocol: providerPayloads[slug].protocol, tenantId: tenants[slug].id });

        const discovery = await expectStatus(await admin.request.get(`/api/t/${slug}/auth/login-methods`), 200);
        expect(discovery.localPassword).toEqual({ enabled: false });
        expect(discovery.providers).toEqual([
          expect.objectContaining({ id: providers[slug].id, key: 'tenant-sso', protocol: providerPayloads[slug].protocol }),
        ]);
      }

      await expectStatus(await post(admin, '/api/auth/switch-tenant', { tenantSlug: 'alpha' }), 200);
      await admin.goto('/t/alpha/admin/settings');
      await expect(admin.getByRole('heading', { name: 'Tenant sign-in and identity' })).toBeVisible();
      await expect(admin.getByText('alpha.example', { exact: true })).toBeVisible();
      await captureManualScreenshot(admin, '03-alpha-tenant-sign-in-settings.jpg');
      const alphaProviderLabel = admin.getByText('Alpha OIDC', { exact: true }).first();
      await alphaProviderLabel.scrollIntoViewIfNeeded();
      await expect(alphaProviderLabel).toBeVisible();
      await captureManualScreenshot(admin, '04-alpha-tenant-segregated-oidc.jpg', { stabilize: false });

      await admin.setViewportSize({ width: 390, height: 844 });
      await assertNoHorizontalOverflow(admin);
      await expect(admin.getByRole('heading', { name: 'Tenant sign-in and identity' })).toBeVisible();
      await captureResponsiveScreenshot(admin, '02-alpha-tenant-settings-narrow.jpg');

      await admin.setViewportSize({ width: 1280, height: 900 });
      await admin.evaluate(() => { document.documentElement.style.zoom = '2'; });
      await assertNoHorizontalOverflow(admin);
      await expect(admin.getByRole('heading', { name: 'Tenant sign-in and identity' })).toBeVisible();
      await captureResponsiveScreenshot(admin, '03-alpha-tenant-settings-200-percent-zoom.jpg');
      await admin.evaluate(() => { document.documentElement.style.zoom = '1'; });
      await admin.setViewportSize({ width: 1440, height: 900 });

      await admin.goto('/t/alpha');
      await expect(admin.getByRole('heading', { name: /dashboard/i })).toBeVisible();
      const tenantPicker = admin.locator('.cds--header__menu-title', { hasText: 'Alpha Industries' });
      await expect(tenantPicker).toBeVisible();
      await tenantPicker.click();
      await expect(admin.getByRole('link', { name: 'Bravo Services' })).toBeVisible();
      await expect(admin.getByRole('link', { name: 'Charlie Operations' })).toBeVisible();
      await captureManualScreenshot(admin, '05-tenant-picker-with-memberships.jpg', { stabilize: false });

      await expectStatus(await admin.request.get('/api/auth/login-methods'), 404);
      await expectStatus(await admin.request.get('/api/identity/providers'), 404);
      await expectStatus(await admin.request.get(`/api/t/bravo/auth/providers/${providers.alpha.id}/start`, { maxRedirects: 0 }), 404);

      await assertOrganizationFinderResponsive(browser);
      await assertWorkspaceFallback(browser, 'bravo');
      const alphaContext = await oidcLoginFromOrganizationFinder(browser, 'alpha', 'Alpha OIDC', 'operator@alpha.example');
      const bravoContext = await samlLogin(browser, 'bravo', providers.bravo.id);
      const charlieContext = await ldapLogin(browser, 'charlie', providers.charlie.id, 'Charlie Directory');
      userContexts.push(alphaContext, bravoContext, charlieContext);

      await assertTenantSession(alphaContext, tenants.alpha, 'bravo');
      await assertTenantSession(bravoContext, tenants.bravo, 'charlie');
      await assertTenantSession(charlieContext, tenants.charlie, 'alpha');

      const alphaMember = await alphaContext.newPage();
      const alphaCatalogue = await expectStatus(
        await alphaMember.request.get('/api/t/alpha/apps'),
        200,
      );
      expect(alphaCatalogue).toMatchObject({
        activationPolicy: 'approval_required',
        applications: [{
          pluginId: referencePluginId,
          status: 'available',
          active: false,
          entitled: 'active',
          revision: 0,
        }],
      });
      expect(JSON.stringify(alphaCatalogue)).not.toMatch(/bundle|registry|credential|tenantRef/i);
      await expectStatus(await post(
        alphaMember,
        `/api/t/alpha/apps/${referencePluginId}/activate`,
        { expectedRevision: 0, idempotencyKey: 'pooled-alpha-member-activate-0001' },
      ), 403);
      await expectStatus(await alphaMember.request.get('/api/t/bravo/apps'), 403);
      const alphaRequested = await expectStatus(await post(
        alphaMember,
        `/api/t/alpha/apps/${referencePluginId}/activation-request`,
        { expectedRevision: 0, idempotencyKey: 'pooled-alpha-request-0001' },
      ), 200);
      expect(alphaRequested).toMatchObject({ status: 'requested', active: false, revision: 1 });

      const alphaApproved = await expectStatus(await post(
        admin,
        `/api/t/alpha/apps/${referencePluginId}/activation-request/decision`,
        { decision: 'approve', expectedRevision: 1, idempotencyKey: 'pooled-alpha-approve-0001' },
      ), 200);
      expect(alphaApproved).toMatchObject({ status: 'active', active: true, revision: 2 });

      const alphaStatus = await expectStatus(
        await alphaContext.request.get(
          `/t/alpha/api/plugins/v1/${referencePluginId}/operations/${referenceStatusOperation}`,
        ),
        200,
      );
      expect(alphaStatus).toMatchObject({
        status: 'ready',
        pluginId: referencePluginId,
        version: referencePluginVersion,
      });
      const alphaQualification = await expectStatus(
        await post(
          alphaMember,
          `/t/alpha/api/plugins/v1/${referencePluginId}/operations/${referenceQualificationOperation}`,
          { body: { runRef: 'alpha-pooled-runtime-1' } },
        ),
        200,
      );
      expect(alphaQualification).toMatchObject({
        status: 'qualified',
        storage: { action: 'put', revision: 'r1' },
        schedule: {
          status: 'scheduled',
          jobRef: expect.any(String),
          revision: 1,
        },
      });
      const alphaStorage = await databaseRows(
        `SELECT tenant_ref_key, storage_key, value_json, revision::text
         FROM main.plugin_storage_entries
         WHERE plugin_id = $1 AND scope = 'tenant'`,
        [referencePluginId],
      );
      expect(alphaStorage).toEqual([{
        tenant_ref_key: tenants.alpha.id,
        storage_key: 'qualification/alpha-pooled-runtime-1',
        value_json: JSON.stringify({ runRef: 'alpha-pooled-runtime-1', status: 'qualified' }),
        revision: '1',
      }]);
      expect(alphaStorage).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tenant_ref_key: tenants.bravo.id }),
        ]),
      );

      const scheduledJobRef = alphaQualification.schedule.jobRef as string;
      await forceScheduledJobDue(scheduledJobRef);
      await expect.poll(
        async () => (await databaseRows(
          `SELECT status, reason_code, revision::text, attempt
           FROM main.plugin_scheduled_jobs WHERE job_ref = $1`,
          [scheduledJobRef],
        ))[0],
        { timeout: 20_000 },
      ).toMatchObject({
        status: 'scheduled',
        reason_code: 'qualified',
        revision: '2',
        attempt: 0,
      });
      await expect.poll(
        async () => (await pluginDeliveryEvidence()).filter(
          (entry) => entry.kind === 'schedule' && entry.tenantRef === tenants.alpha.id,
        ),
        { timeout: 20_000 },
      ).toHaveLength(1);

      const alphaEventDeliveryId = await enqueueEngineInventoryEvent({
        tenantRef: tenants.alpha.id,
        deliveryRef: 'alpha-inventory-1',
      });
      await expect.poll(
        async () => (await databaseRows(
          `SELECT status, reason_code, attempt, event_json
           FROM main.plugin_event_deliveries WHERE delivery_id = $1`,
          [alphaEventDeliveryId],
        ))[0],
        { timeout: 20_000 },
      ).toMatchObject({
        status: 'delivered',
        reason_code: 'qualified',
        attempt: 1,
        event_json: '{}',
      });
      await expect.poll(
        async () => (await pluginDeliveryEvidence()).filter(
          (entry) => entry.kind === 'event' && entry.deliveryId === alphaEventDeliveryId,
        ),
        { timeout: 20_000 },
      ).toEqual([expect.objectContaining({ tenantRef: tenants.alpha.id })]);

      await expectStatus(await post(
        alphaMember,
        `/t/alpha/api/plugins/v1/${referencePluginId}/operations/${referenceScheduleDeliveryOperation}`,
        { body: {} },
      ), 404);
      await expectStatus(await post(
        alphaMember,
        `/t/alpha/api/plugins/v1/${referencePluginId}/operations/${referenceEventDeliveryOperation}`,
        { body: {} },
      ), 404);
      const alphaEligibilityView = await expectStatus(
        await alphaContext.request.get(`/api/t/alpha/apps/${referencePluginId}/eligibility`),
        200,
      );
      expect(alphaEligibilityView).toMatchObject({ state: 'active', revision: 1 });
      expect(JSON.stringify(alphaEligibilityView)).not.toMatch(/tenantRef|signedProjection|price|agreement/i);
      const charlieBlocked = await expectStatus(
        await charlieContext.request.get(`/api/t/charlie/apps/${referencePluginId}`),
        200,
      );
      expect(charlieBlocked).toMatchObject({ status: 'revoked', active: false, entitled: 'revoked' });
      await expectStatus(
        await charlieContext.request.get(
          `/t/charlie/api/plugins/v1/${referencePluginId}/operations/${referenceStatusOperation}`,
        ),
        404,
      );
      await expectStatus(await post(admin, '/api/auth/switch-tenant', { tenantSlug: 'bravo' }), 200);
      const bravoBefore = await expectStatus(
        await admin.request.get(`/api/t/bravo/apps/${referencePluginId}`),
        200,
      );
      expect(bravoBefore).toMatchObject({ status: 'available', active: false, revision: 0 });
      await expectStatus(await post(
        admin,
        `/api/t/bravo/apps/${referencePluginId}/activation-request`,
        { expectedRevision: 0, idempotencyKey: 'pooled-bravo-request-0001' },
      ), 200);
      await expectStatus(await post(
        admin,
        `/api/t/bravo/apps/${referencePluginId}/activation-request/decision`,
        { decision: 'approve', expectedRevision: 1, idempotencyKey: 'pooled-bravo-approve-0001' },
      ), 200);
      await expectStatus(
        await bravoContext.request.get(
          `/t/bravo/api/plugins/v1/${referencePluginId}/operations/${referenceStatusOperation}`,
        ),
        200,
      );
      const bravoQueuedBeforeRevocation = await enqueueEngineInventoryEvent({
        tenantRef: tenants.bravo.id,
        deliveryRef: 'bravo-before-revocation-1',
        dueAt: Date.now() + 60_000,
      });
      const bravoRevokedProjection = await applyTenantEligibility({
        page: admin,
        token: eligibilityToken,
        tenantRef: tenants.bravo.id,
        state: 'revoked',
        revision: 2,
      });
      expect(bravoRevokedProjection).toMatchObject({ state: 'revoked', revision: 2 });
      const bravoRevoked = await expectStatus(
        await admin.request.get(`/api/t/bravo/apps/${referencePluginId}`),
        200,
      );
      expect(bravoRevoked).toMatchObject({ status: 'revoked', active: true, entitled: 'revoked', revision: 2 });
      const bravoInactive = await expectStatus(await post(
        admin,
        `/api/t/bravo/apps/${referencePluginId}/deactivate`,
        { expectedRevision: 2, idempotencyKey: 'pooled-bravo-deactivate-0001' },
      ), 200);
      expect(bravoInactive).toMatchObject({ status: 'revoked', active: false, revision: 3 });
      await forcePluginEventDue(bravoQueuedBeforeRevocation);
      await expect.poll(
        async () => (await databaseRows(
          `SELECT status, reason_code, attempt
           FROM main.plugin_event_deliveries WHERE delivery_id = $1`,
          [bravoQueuedBeforeRevocation],
        ))[0],
        { timeout: 20_000 },
      ).toMatchObject({
        status: 'dead_letter',
        reason_code: 'subscription_inactive',
        attempt: 1,
      });
      expect(
        (await pluginDeliveryEvidence()).filter(
          (entry) => entry.deliveryId === bravoQueuedBeforeRevocation,
        ),
      ).toEqual([]);
      await expectStatus(
        await bravoContext.request.get(
          `/t/bravo/api/plugins/v1/${referencePluginId}/operations/${referenceStatusOperation}`,
        ),
        404,
      );
      await expectStatus(await post(admin, '/api/auth/switch-tenant', { tenantSlug: 'alpha' }), 200);
      await expectStatus(
        await admin.request.get(`/api/t/alpha/apps/${referencePluginId}`),
        200,
      ).then((application) => expect(application).toMatchObject({ status: 'active', active: true, revision: 2 }));

      const alphaBootstrap = await expectStatus(
        await alphaContext.request.get('/t/alpha/api/plugins/v1/frontend'),
        200,
      );
      expect(alphaBootstrap.plugins).toEqual([
        expect.objectContaining({ pluginId: referencePluginId }),
      ]);
      const bravoBootstrap = await expectStatus(
        await bravoContext.request.get('/t/bravo/api/plugins/v1/frontend'),
        200,
      );
      expect(bravoBootstrap.plugins).toEqual([]);
      const alphaApplicationAudit = await expectStatus(
        await admin.request.get(`/api/t/alpha/apps/${referencePluginId}/audit`),
        200,
      );
      expect(alphaApplicationAudit.events.map((event: JsonObject) => event.eventType)).toEqual([
        'tenant_activation_approved',
        'tenant_activation_requested',
        'tenant_eligibility_updated',
      ]);
      expect(JSON.stringify(alphaApplicationAudit)).not.toContain(tenants.bravo.id);

      const alphaMembersResponse = await admin.request.get('/api/t/alpha/tenant/members');
      const alphaMembers = await alphaMembersResponse.json().catch(() => []);
      expect(alphaMembersResponse.status(), JSON.stringify(alphaMembers)).toBe(200);
      const alphaSsoUser = alphaMembers.find((member: JsonObject) => member.email === 'oidc-operator@localhost.test');
      expect(alphaSsoUser).toMatchObject({ role: 'member' });

      await expectStatus(await put(admin, `/api/t/alpha/tenant/members/${encodeURIComponent(alphaSsoUser.userId)}`, {
        role: 'admin',
      }), 204);
      const alphaAdmin = await alphaContext.newPage();
      const alphaProviders = await expectStatus(await alphaAdmin.request.get('/api/t/alpha/identity/providers'), 200);
      expect(alphaProviders).toEqual([
        expect.objectContaining({ id: providers.alpha.id, tenantId: tenants.alpha.id, protocol: 'oidc' }),
      ]);
      await expectStatus(await post(alphaAdmin, '/api/t/alpha/identity/providers/tenant-sso/test-connection'), 200);
      await expectStatus(await alphaAdmin.request.get('/api/t/bravo/identity/providers'), 403);
      await expectStatus(await post(alphaAdmin, '/api/t/bravo/identity/providers/tenant-sso/test-connection'), 403);
      const alphaDiscoveryDomains = await expectStatus(await alphaAdmin.request.get('/api/t/alpha/tenant/discovery-domains'), 200);
      expect(alphaDiscoveryDomains).toEqual([
        expect.objectContaining({ id: discoveryDomains.alpha.id, tenantId: tenants.alpha.id, domain: 'alpha.example', status: 'verified' }),
      ]);
      await expectStatus(await alphaAdmin.request.get('/api/t/bravo/tenant/discovery-domains'), 403);

      const alphaDeactivated = await expectStatus(await post(
        admin,
        `/api/t/alpha/apps/${referencePluginId}/deactivate`,
        { expectedRevision: 2, idempotencyKey: 'pooled-alpha-deactivate-0001' },
      ), 200);
      expect(alphaDeactivated).toMatchObject({
        status: 'inactive',
        active: false,
        revision: 3,
      });
      await expectStatus(
        await alphaContext.request.get(
          `/t/alpha/api/plugins/v1/${referencePluginId}/operations/${referenceStatusOperation}`,
        ),
        404,
      );
      const alphaBootstrapAfterDeactivation = await expectStatus(
        await alphaContext.request.get('/t/alpha/api/plugins/v1/frontend'),
        200,
      );
      expect(alphaBootstrapAfterDeactivation.plugins).toEqual([]);
      const retainedAlphaStorage = await databaseRows(
        `SELECT tenant_ref_key, storage_key, value_json, revision::text
         FROM main.plugin_storage_entries
         WHERE plugin_id = $1 AND tenant_ref_key = $2`,
        [referencePluginId, tenants.alpha.id],
      );
      expect(retainedAlphaStorage).toEqual([{
        tenant_ref_key: tenants.alpha.id,
        storage_key: 'qualification/alpha-pooled-runtime-1',
        value_json: JSON.stringify({ runRef: 'alpha-pooled-runtime-1', status: 'qualified' }),
        revision: '1',
      }]);

      await expectStatus(await remove(admin, `/api/t/alpha/tenant/members/${encodeURIComponent(alphaSsoUser.userId)}`), 204);
      await expectStatus(await alphaContext.request.get('/api/auth/me'), 403);
      await expectStatus(await alphaContext.request.get('/api/auth/my-tenants'), 403);
    } finally {
      await Promise.all(userContexts.map((context) => context.close()));
      await adminContext.close();
    }
  });
});
