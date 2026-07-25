import {
  expect,
  request as playwrightRequest,
  test,
  type APIResponse,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  getE2ECredentials,
  getE2EEngineId,
  getE2EFineGrainedFixture,
} from './utils/credentials';

function isLocalUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return ['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.local');
  } catch {
    return false;
  }
}

const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';
const apiUrl = process.env.E2E_API_BASE_URL || 'http://localhost:8787';
const mockControlUrl = process.env.CAMUNDA_MOCK_CONTROL_URL || 'http://localhost:59080';
const enabled = process.env.CAMUNDA_NATIVE_GRANT_BROWSER_EVIDENCE === 'true'
  && isLocalUrl(baseUrl)
  && isLocalUrl(apiUrl)
  && isLocalUrl(mockControlUrl);

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function drainLocalRuntimeReconciliation(applyRunId: string): void {
  if (process.env.CAMUNDA_NATIVE_GRANT_TASK_DRAIN !== 'true') {
    throw new Error('Native-grant browser evidence requires the explicit local runtime-task drain');
  }
  if (!/^[a-zA-Z0-9-]{8,255}$/.test(applyRunId)) {
    throw new Error('Native-grant apply receipt has an unsafe runtime-task identifier');
  }
  const worker = [
    `const applyRunId = ${JSON.stringify(applyRunId)};`,
    "const { configBundleRuntimeReconciliationTaskService } = await import('./packages/shared/dist/services/platform-admin/ConfigBundleRuntimeReconciliationTaskService.js');",
    'const result = await configBundleRuntimeReconciliationTaskService.drainApplyRun({ applyRunId, maxTasks: 100 });',
    "if (result.status !== 'completed' || result.failedTaskCount !== 0) throw new Error(`runtime reconciliation did not complete: ${JSON.stringify(result)}`);",
  ].join(' ');
  const encodedWorker = Buffer.from(worker, 'utf8').toString('base64');
  execFileSync('docker', [
    'compose', '--project-directory', '.', '--env-file', '.local/docker/env/docker.env',
    '-f', 'infra/docker/compose/docker-compose.yml', 'exec', '-T', 'backend',
    'sh', '-lc', `cd /repo && node --input-type=module -e "$(printf '%s' ${encodedWorker} | base64 -d)"`,
  ], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

interface IdentitySourceSynchronizationResult {
  providerId: string;
  mappingIds: string[];
  groupMembershipsCreated: number;
  groupMembershipsRemoved: number;
}

/**
 * The local Docker stack intentionally has no external directory.  This still
 * exercises the production identity-source path by creating a claims-only
 * synthetic provider and mappings, then reconciling an allowlisted group claim
 * through SsoNormalizedIdentityService.  It must never use the manual group
 * membership API or a direct membership-row insertion.
 */
function synchronizeSyntheticIdentitySource(input: {
  tenantId: string;
  userId: string;
  email: string;
  groupKeys: string[];
}): IdentitySourceSynchronizationResult {
  const providerKey = `e2e-native-browser-${randomUUID()}`;
  const entitlement = 'e2e-native-grant-browser-member';
  const payload = {
    ...input,
    providerKey,
    entitlement,
    providerSubject: `synthetic-subject:${providerKey}`,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const worker = [
    `const input = JSON.parse(Buffer.from(${JSON.stringify(encodedPayload)}, 'base64').toString('utf8'));`,
    "const { identityProviderService } = await import('./packages/shared/dist/services/platform-admin/IdentityProviderService.js');",
    "const { identityEntitlementMappingService } = await import('./packages/shared/dist/services/platform-admin/IdentityEntitlementMappingService.js');",
    "const { ssoNormalizedIdentityService } = await import('./packages/shared/dist/services/platform-admin/SsoNormalizedIdentityService.js');",
    "const provider = await identityProviderService.upsert({ tenantId: input.tenantId, key: input.providerKey, protocol: 'oidc', isEnabled: false, authenticationMode: 'claims_only', configuration: { issuerUrl: 'https://identity.example.invalid', clientId: 'e2e-native-grant-browser' }, sync: { connectorCapability: 'claim_only' }, ownershipMode: 'manual', sourceRef: 'e2e-native-browser-identity-source' });",
    "const mappings = []; for (const groupKey of input.groupKeys) mappings.push(await identityEntitlementMappingService.create({ providerKey: input.providerKey, targetGroupKey: groupKey, entitlementType: 'group', externalId: input.entitlement, matchOperator: 'exact', syncMode: 'authoritative' }, input.tenantId));",
    "const result = await ssoNormalizedIdentityService.upsertIdentity({ tenantId: input.tenantId, providerId: provider.id, providerType: 'oidc', providerSubject: input.providerSubject, subjectClaim: 'sub', userId: input.userId, email: input.email, claims: { groups: [input.entitlement] } });",
    "process.stdout.write(JSON.stringify({ providerId: provider.id, mappingIds: mappings.map((mapping) => mapping.id), groupMembershipsCreated: result.groupMembershipsCreated, groupMembershipsRemoved: result.groupMembershipsRemoved }));",
  ].join(' ');
  const encodedWorker = Buffer.from(worker, 'utf8').toString('base64');
  const output = execFileSync('docker', [
    'compose', '--project-directory', '.', '--env-file', '.local/docker/env/docker.env',
    '-f', 'infra/docker/compose/docker-compose.yml', 'exec', '-T', 'backend',
    'sh', '-lc', `cd /repo && node --input-type=module -e "$(printf '%s' ${encodedWorker} | base64 -d)"`,
  ], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const resultLine = output.trim().split(/\r?\n/).reverse().find((line) => line.trim().startsWith('{'));
  if (!resultLine) throw new Error('Identity-source reconciliation did not return a JSON receipt');
  return JSON.parse(resultLine) as IdentitySourceSynchronizationResult;
}

async function responseJson<T>(response: APIResponse, operation: string): Promise<T> {
  const body = await response.json().catch(() => null);
  expect(response.ok(), `${operation} failed (${response.status()}): ${JSON.stringify(body)}`).toBe(true);
  return body as T;
}

async function csrfToken(page: Page): Promise<string> {
  const token = await responseJson<{ csrfToken: string }>(
    await page.request.get('/api/csrf-token'),
    'obtain Effective Access CSRF token',
  );
  expect(token.csrfToken).toBeTruthy();
  return token.csrfToken;
}

function mutationOptions(token: string, data: unknown) {
  return { headers: { 'X-CSRF-Token': token }, data };
}

async function evaluateRuntimeAccess(
  page: Page,
  token: string,
  userId: string,
  engineId: string,
  resourceKind: 'process_definition' | 'decision_definition',
  resourceKey: string,
) {
  return responseJson<{ allowed: boolean; sources: Array<Record<string, unknown>> }>(
    await page.request.post('/api/authz/evaluate', mutationOptions(token, {
      userId,
      permission: 'engine:instance:view',
      resourceType: 'engine_runtime_resource',
      runtimeResource: { engineId, resourceKind, resourceKey, runtimeTenantId: '' },
    })),
    `evaluate ${resourceKind} Effective Access`,
  );
}

async function login(page: Page, email?: string, password?: string): Promise<void> {
  if (!email || !password) throw new Error('Disposable local test credentials are unavailable');
  await page.goto('/login?local=1');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
}

async function openMigrationPanel(page: Page, engineName: string) {
  await page.goto('/t/default/engines');
  const row = page.getByRole('row').filter({ hasText: engineName });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Options' }).click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Edit engine' });
  await expect(modal.getByRole('heading', { name: 'Migrate existing Camunda grants' })).toBeVisible();
  return modal;
}

test.describe('Camunda native-grant migration browser workflow', () => {
  test.skip(!enabled, 'Runs only from the explicit localhost Docker native-grant evidence runner');

  test('previews, drafts, applies, enforces, resumes, and rolls back the safe Camunda subset', async ({ page }) => {
    const { email, password } = getE2ECredentials();
    const engineId = getE2EEngineId()!;
    const fixture = getE2EFineGrainedFixture();
    expect(fixture.runtimeScopedUserId, 'seeded scoped identity is required').toBeTruthy();
    expect(fixture.runtimeScopedEmail, 'seeded scoped identity is required').toBeTruthy();
    expect(fixture.runtimeScopedPassword, 'seeded scoped identity is required').toBeTruthy();

    const pool = new Pool({
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT || 5432),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DATABASE,
      ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
      options: `-c search_path=${process.env.POSTGRES_SCHEMA || 'main'}`,
    });
    let memberContext: BrowserContext | null = null;
    let mockControl: Awaited<ReturnType<typeof playwrightRequest.newContext>> | null = null;

    try {
      await login(page, email, password);
      const engine = await responseJson<{ id: string; name: string; tenantId: string | null; runtimeAccessScope: string }>(
        await page.request.get(`/engines-api/engines/${encodeURIComponent(engineId)}`),
        'read seeded Camunda engine',
      );
      expect(engine).toMatchObject({ id: engineId, tenantId: 'tenant-default', runtimeAccessScope: 'resource_aware' });

      const runtimeResources = await responseJson<Array<{ resourceKind: string; resourceKey: string }>>(
        await page.request.get(`/engines-api/engines/${encodeURIComponent(engineId)}/runtime-resources`),
        'read synthetic Camunda runtime inventory',
      );
      expect(runtimeResources).toEqual(expect.arrayContaining([
        expect.objectContaining({ resourceKind: 'process_definition', resourceKey: 'invoice-process' }),
        expect.objectContaining({ resourceKind: 'decision_definition', resourceKey: 'invoice-risk' }),
        expect.objectContaining({ resourceKind: 'process_definition', resourceKey: 'invoice-sequential-review' }),
      ]));

      mockControl = await playwrightRequest.newContext({ baseURL: mockControlUrl });
      expect((await mockControl.post('/__e2e/requests/reset')).status()).toBe(204);

      let modal = await openMigrationPanel(page, engine.name);
      const previewResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && response.url().includes(`/engines/${encodeURIComponent(engineId)}/camunda-native-grants/imports/preview`),
      );
      await modal.getByRole('button', { name: 'Read native grants' }).click();
      expect((await previewResponse).status()).toBe(201);
      await expect(modal.getByText('Sanitized preview created')).toBeVisible();
      await expect(modal.getByText(/proposed: 2/i)).toBeVisible();
      await expect(modal.getByText(/manual required: 5/i)).toBeVisible();
      await expect(modal.getByText(/approval required: 2/i)).toBeVisible();
      await expect(modal.getByText(/blocked: 3/i)).toBeVisible();
      await expect(modal.getByText('synthetic-operations')).toHaveCount(0);

      const ledger = await responseJson<{ requests: Array<{ request: string }> }>(
        await mockControl.get('/__e2e/requests'),
        'read native-grant mock request ledger',
      );
      expect(ledger.requests).toEqual(expect.arrayContaining([
        expect.objectContaining({ request: 'GET /engine-rest/authorization' }),
      ]));
      // Health/version probes can race the panel open, but the inventory path
      // itself may never write to Camunda.
      expect(ledger.requests.every(({ request }) => request.startsWith('GET '))).toBe(true);

      await modal.getByRole('button', { name: 'Map proposed groups' }).click();
      await expect(modal.getByLabel(/EnterpriseGlue group key for synthetic-operations/i)).toBeVisible();
      const bundleKey = await modal.locator('#camunda-native-bundle-key').inputValue();
      expect(bundleKey).toMatch(/^migration\.camunda-native-/);
      await modal.getByRole('button', { name: 'Generate reviewed draft' }).click();
      await expect(modal.getByText('Hash-bound draft generated')).toBeVisible();

      const applyResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && response.url().includes('/camunda-native-grants/imports/')
        && response.url().endsWith('/apply'),
      );
      await modal.getByRole('button', { name: 'Apply reviewed draft' }).click();
      const appliedResponse = await applyResponse;
      expect(appliedResponse.status()).toBe(200);
      const appliedPayload = await appliedResponse.json() as { result?: { applyRunId?: string } };
      expect(appliedPayload.result?.applyRunId).toBeTruthy();
      await expect(modal.getByText('Migration draft applied')).toBeVisible();
      drainLocalRuntimeReconciliation(appliedPayload.result!.applyRunId!);

      const groupRows = await pool.query<{ id: string; key: string }>(
        'SELECT id, key FROM authz_groups WHERE source_ref = $1 AND is_archived = false ORDER BY key',
        [`config_bundle:${bundleKey}`],
      );
      expect(groupRows.rows).toHaveLength(2);
      const identitySynchronization = synchronizeSyntheticIdentitySource({
        tenantId: 'tenant-default',
        userId: fixture.runtimeScopedUserId!,
        email: fixture.runtimeScopedEmail!,
        groupKeys: groupRows.rows.map((group) => group.key),
      });
      expect(identitySynchronization.mappingIds).toHaveLength(groupRows.rows.length);
      expect(identitySynchronization.groupMembershipsCreated).toBe(groupRows.rows.length);
      expect(identitySynchronization.groupMembershipsRemoved).toBe(0);
      const synchronizedMemberships = await pool.query<{ source: string }>(
        `SELECT source FROM authz_group_memberships
         WHERE user_id = $1 AND group_id = ANY($2::text[]) AND source = 'identity_provider'`,
        [fixture.runtimeScopedUserId, groupRows.rows.map((group) => group.id)],
      );
      expect(synchronizedMemberships.rows).toHaveLength(groupRows.rows.length);

      const browser = page.context().browser();
      if (!browser) throw new Error('Native-grant evidence requires a browser-backed Playwright page');
      memberContext = await browser.newContext({ baseURL: baseUrl, ignoreHTTPSErrors: true });
      const memberPage = await memberContext.newPage();
      await login(memberPage, fixture.runtimeScopedEmail, fixture.runtimeScopedPassword);
      const definitionsPath = `/mission-control-api/process-definitions?engineId=${encodeURIComponent(engineId)}`;
      const allowedDefinitions = await responseJson<Array<{ key: string }>>(
        await memberPage.request.get(definitionsPath),
        'list imported member process definitions',
      );
      expect(allowedDefinitions.map((definition) => definition.key)).toEqual(['invoice-process']);
      const decisionDefinitionsPath = `/mission-control-api/decision-definitions?engineId=${encodeURIComponent(engineId)}`;
      const allowedDecisionDefinitions = await responseJson<Array<{ key: string }>>(
        await memberPage.request.get(decisionDefinitionsPath),
        'list imported member decision definitions',
      );
      expect(allowedDecisionDefinitions.map((definition) => definition.key)).toEqual(['invoice-risk']);

      const effectiveAccessToken = await csrfToken(page);
      await expect(evaluateRuntimeAccess(
        page,
        effectiveAccessToken,
        fixture.runtimeScopedUserId!,
        engineId,
        'process_definition',
        'invoice-process',
      )).resolves.toMatchObject({ allowed: true });
      await expect(evaluateRuntimeAccess(
        page,
        effectiveAccessToken,
        fixture.runtimeScopedUserId!,
        engineId,
        'decision_definition',
        'invoice-risk',
      )).resolves.toMatchObject({ allowed: true });
      await expect(evaluateRuntimeAccess(
        page,
        effectiveAccessToken,
        fixture.runtimeScopedUserId!,
        engineId,
        'process_definition',
        'invoice-sequential-review',
      )).resolves.toMatchObject({ allowed: false, sources: [] });

      await page.reload();
      modal = await openMigrationPanel(page, engine.name);
      await expect(modal.getByRole('button', { name: 'Resume rollback' })).toBeVisible();
      await modal.getByRole('button', { name: 'Resume rollback' }).click();
      await expect(modal.getByText('Applied migration resumed')).toBeVisible();
      await modal.getByRole('button', { name: 'Preview rollback' }).click();
      await expect(modal.getByText('Rollback removes only import-owned configuration')).toBeVisible();
      const rollbackAcknowledgement = modal.locator('label[for="camunda-native-rollback-acknowledgement"]');
      await rollbackAcknowledgement.click();
      await expect(modal.getByLabel(/I understand that this will remove/i)).toBeChecked();
      await modal.getByRole('button', { name: 'Roll back imported configuration' }).click();
      await expect(modal.getByText('Imported configuration rolled back')).toBeVisible();

      const afterRollback = await memberPage.request.get(definitionsPath);
      expect(afterRollback.status()).toBe(403);
      const afterRollbackDecision = await memberPage.request.get(decisionDefinitionsPath);
      expect(afterRollbackDecision.status()).toBe(403);
      await expect(evaluateRuntimeAccess(
        page,
        effectiveAccessToken,
        fixture.runtimeScopedUserId!,
        engineId,
        'process_definition',
        'invoice-process',
      )).resolves.toMatchObject({ allowed: false, sources: [] });

      const observationDirectory = path.join(process.cwd(), 'test/results/camunda-native-grant-browser-observations');
      await mkdir(observationDirectory, { recursive: true });
      await writeFile(path.join(observationDirectory, 'workflow.json'), `${JSON.stringify({
        schemaVersion: 1,
        status: 'passed',
        commit: git(['rev-parse', 'HEAD']),
        sourceState: git(['status', '--porcelain', '--untracked-files=no']) ? 'dirty' : 'clean',
        releaseCommitQualified: git(['status', '--porcelain', '--untracked-files=no']) === '',
        localhostOnly: true,
        realHttpService: true,
        persistentDatabase: true,
        authorizationEvaluator: true,
        userInterface: true,
        assertions: [
          'read_only_native_inventory',
          'sanitized_preview_then_protected_mapping',
          'hash_bound_draft_and_apply',
          'identity_source_sync_effective_access_process_and_decision_allow_sibling_deny',
          'history_resume_and_hash_bound_rollback',
          'rollback_restores_denial',
        ],
        sanitization: {
          containsCredentials: false,
          containsTokens: false,
          containsPrivateEndpoints: false,
          containsRawIdentityClaims: false,
          containsCustomerIdentifiers: false,
        },
      }, null, 2)}\n`, 'utf8');
    } finally {
      await memberContext?.close();
      await mockControl?.dispose();
      await pool.end();
    }
  });
});
