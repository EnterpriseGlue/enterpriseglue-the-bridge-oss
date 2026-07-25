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
  hasE2ECredentials,
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
  && isLocalUrl(mockControlUrl)
  && hasE2ECredentials()
  && Boolean(getE2EEngineId());

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

async function responseJson<T>(response: APIResponse, operation: string): Promise<T> {
  const body = await response.json().catch(() => null);
  expect(response.ok(), `${operation} failed (${response.status()}): ${JSON.stringify(body)}`).toBe(true);
  return body as T;
}

async function login(page: Page, email?: string, password?: string): Promise<void> {
  if (!email || !password) throw new Error('Disposable local test credentials are unavailable');
  await page.goto('/login?local=1');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
}

async function csrfToken(page: Page): Promise<string> {
  const body = await responseJson<{ csrfToken: string }>(
    await page.request.get('/api/csrf-token'),
    'obtain CSRF token',
  );
  expect(body.csrfToken).toBeTruthy();
  return body.csrfToken;
}

function mutationOptions(token: string, data?: unknown) {
  return { headers: { 'X-CSRF-Token': token }, ...(data === undefined ? {} : { data }) };
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
      const csrf = await csrfToken(page);
      const engine = await responseJson<{ id: string; name: string; tenantId: string | null; runtimeAccessScope: string }>(
        await page.request.get(`/engines-api/engines/${encodeURIComponent(engineId)}`),
        'read seeded Camunda engine',
      );
      expect(engine).toMatchObject({ id: engineId, tenantId: 'tenant-default', runtimeAccessScope: 'resource_aware' });

      await responseJson(
        await page.request.post(
          `/engines-api/engines/${encodeURIComponent(engineId)}/runtime-resources/reconcile`,
          mutationOptions(csrf),
        ),
        'reconcile synthetic Camunda runtime inventory',
      );
      const runtimeResources = await responseJson<Array<{ resourceKind: string; resourceKey: string }>>(
        await page.request.get(`/engines-api/engines/${encodeURIComponent(engineId)}/runtime-resources`),
        'read reconciled runtime inventory',
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
      await expect(modal.getByText(/manual required: 8/i)).toBeVisible();
      await expect(modal.getByText('synthetic-operations')).toHaveCount(0);

      const ledger = await responseJson<{ requests: Array<{ request: string }> }>(
        await mockControl.get('/__e2e/requests'),
        'read native-grant mock request ledger',
      );
      expect(ledger.requests).toEqual([expect.objectContaining({ request: 'GET /engine-rest/authorization' })]);

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
      expect((await applyResponse).status()).toBe(200);
      await expect(modal.getByText('Migration draft applied')).toBeVisible();

      const groupRows = await pool.query<{ id: string }>(
        'SELECT id FROM authz_groups WHERE source_ref = $1 AND is_archived = false ORDER BY id',
        [`config_bundle:${bundleKey}`],
      );
      expect(groupRows.rows).toHaveLength(2);
      const membershipSourceRef = `e2e-native-browser:${randomUUID()}`;
      const now = Date.now();
      for (const group of groupRows.rows) {
        await pool.query(
          `INSERT INTO authz_group_memberships
            (id, tenant_id, group_id, user_id, source, source_ref, expires_at, created_by_id, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [randomUUID(), 'tenant-default', group.id, fixture.runtimeScopedUserId, 'sso', membershipSourceRef, null, null, now, now],
        );
      }

      const browser = page.context().browser();
      if (!browser) throw new Error('Native-grant evidence requires a browser-backed Playwright page');
      memberContext = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
      const memberPage = await memberContext.newPage();
      await login(memberPage, fixture.runtimeScopedEmail, fixture.runtimeScopedPassword);
      const definitionsPath = `/mission-control-api/process-definitions?engineId=${encodeURIComponent(engineId)}`;
      const allowedDefinitions = await responseJson<Array<{ key: string }>>(
        await memberPage.request.get(definitionsPath),
        'list imported member process definitions',
      );
      expect(allowedDefinitions.map((definition) => definition.key)).toEqual(['invoice-process']);

      await page.reload();
      modal = await openMigrationPanel(page, engine.name);
      await expect(modal.getByRole('button', { name: 'Resume rollback' })).toBeVisible();
      await modal.getByRole('button', { name: 'Resume rollback' }).click();
      await expect(modal.getByText('Applied migration resumed')).toBeVisible();
      await modal.getByRole('button', { name: 'Preview rollback' }).click();
      await expect(modal.getByText('Rollback removes only import-owned configuration')).toBeVisible();
      await modal.getByLabel(/I understand that this will remove/i).check();
      await modal.getByRole('button', { name: 'Roll back imported configuration' }).click();
      await expect(modal.getByText('Imported configuration rolled back')).toBeVisible();

      const afterRollback = await memberPage.request.get(definitionsPath);
      expect(afterRollback.status()).toBe(403);

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
          'sso_membership_effective_access_allow_and_sibling_deny',
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
