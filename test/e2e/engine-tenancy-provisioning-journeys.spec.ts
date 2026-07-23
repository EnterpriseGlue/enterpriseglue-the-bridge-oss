import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getE2ECredentials, hasE2ECredentials } from './utils/credentials';

function isLocalUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return ['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.local');
  } catch {
    return false;
  }
}

const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';
const apiUrl = process.env.ENGINE_TENANCY_API_URL || 'http://localhost:8787';
const enabled = process.env.ENGINE_TENANCY_PROVISIONING_EVIDENCE === 'true'
  && isLocalUrl(baseUrl)
  && isLocalUrl(apiUrl)
  && hasE2ECredentials();

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

async function responseJson<T>(response: APIResponse, operation: string): Promise<T> {
  const body = await response.json().catch(() => null);
  expect(response.ok(), `${operation} failed (${response.status()}): ${JSON.stringify(body)}`).toBe(true);
  return body as T;
}

async function login(page: Page): Promise<void> {
  const { email, password } = getE2ECredentials();
  if (!email || !password) throw new Error('Disposable local test credentials are unavailable');
  await page.goto('/login?local=1');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
}

async function csrfToken(page: Page): Promise<string> {
  const response = await page.request.get('/api/csrf-token');
  const body = await responseJson<{ csrfToken: string }>(response, 'obtain CSRF token');
  expect(body.csrfToken).toBeTruthy();
  return body.csrfToken;
}

function mutationOptions(token: string, data?: unknown) {
  return {
    headers: { 'X-CSRF-Token': token },
    ...(data === undefined ? {} : { data }),
  };
}

test.describe('Engine tenancy provisioning journeys', () => {
  test.skip(
    !enabled,
    'Set ENGINE_TENANCY_PROVISIONING_EVIDENCE=true with localhost URLs and disposable seeded credentials.',
  );

  test('journey 1 manual UI dedicated lifecycle', async ({ page }) => {
    const commit = git(['rev-parse', 'HEAD']);
    const sourceState = git(['status', '--porcelain', '--untracked-files=no'])
      ? 'dirty-development-run'
      : 'clean';
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const originalName = `journey-01-dedicated-${suffix}`;
    const updatedName = `${originalName}-updated`;
    let engineId: string | null = null;

    await login(page);
    const token = await csrfToken(page);
    await page.goto('/t/default/engines');
    await expect(page.getByRole('heading', { name: 'Engines', exact: true })).toBeVisible();
    await expect(page.locator('.cds--skeleton')).toHaveCount(0);

    try {
      await page.getByRole('button', { name: /Add (?:your first )?engine/ }).click();
      const modal = page.getByRole('dialog', { name: 'Add engine' });
      await expect(modal).toBeVisible();
      await modal.getByLabel('Name', { exact: true }).fill(originalName);
      await modal.getByLabel('Base URL', { exact: true }).fill(
        'http://camunda-mock:9080/engine-rest',
      );
      await modal.locator('#eng-type').click();
      await page.getByRole('option', { name: 'Camunda 7', exact: true }).click();
      const deploymentDiscovery = modal.getByRole('switch', {
        name: 'Deployment history discovery',
      });
      await deploymentDiscovery.click({ force: true });
      await expect(deploymentDiscovery).toHaveAttribute('aria-checked', 'false');

      const createResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST'
          && new URL(response.url()).pathname.endsWith('/engines-api/engines'),
      );
      await modal.getByRole('button', { name: 'Create', exact: true }).click();
      const created = await responseJson<Record<string, unknown>>(
        await createResponsePromise,
        'create dedicated engine through UI',
      );
      engineId = String(created.id);
      expect(created).toMatchObject({
        name: originalName,
        tenancyMode: 'dedicated',
        tenantId: 'tenant-default',
        tenantResolutionStatus: 'ready',
      });
      await expect(page.getByText('Engine created', { exact: true })).toBeVisible();

      let row = page.getByRole('row').filter({ hasText: originalName });
      await expect(row).toBeVisible();
      const inspected = await responseJson<Record<string, unknown>>(
        await page.request.get(`/engines-api/engines/${encodeURIComponent(engineId)}`),
        'inspect dedicated engine',
      );
      expect(inspected).toMatchObject({
        id: engineId,
        name: originalName,
        tenancyMode: 'dedicated',
        tenantId: 'tenant-default',
      });

      await row.getByRole('button', { name: 'Options' }).click();
      await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
      const editModal = page.getByRole('dialog', { name: 'Edit engine' });
      await expect(editModal.getByRole('heading', { name: 'Tenancy and tenant mappings' })).toBeVisible();
      await expect(editModal.getByLabel('Proposed topology')).toHaveValue('dedicated');
      await editModal.getByLabel('Name', { exact: true }).fill(updatedName);

      const updateResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT'
          && new URL(response.url()).pathname.endsWith(
            `/engines-api/engines/${encodeURIComponent(engineId!)}`,
          ),
      );
      await editModal.getByRole('button', { name: 'Save', exact: true }).click();
      const updated = await responseJson<Record<string, unknown>>(
        await updateResponsePromise,
        'update dedicated engine through UI',
      );
      expect(updated).toMatchObject({
        id: engineId,
        name: updatedName,
        tenancyMode: 'dedicated',
        tenantId: 'tenant-default',
      });
      await expect(page.getByText('Engine updated', { exact: true })).toBeVisible();
      row = page.getByRole('row').filter({ hasText: updatedName });
      await expect(row).toBeVisible();

      const reconciliation = await responseJson<Record<string, unknown>>(
        await page.request.post(
          `/engines-api/engines/${encodeURIComponent(engineId)}/runtime-resources/reconcile`,
          mutationOptions(token),
        ),
        'reconcile dedicated engine inventory',
      );
      expect(reconciliation).toMatchObject({
        created: expect.any(Number),
        updated: expect.any(Number),
        deactivated: expect.any(Number),
        materializedSets: expect.any(Number),
      });
      const inventory = await responseJson<unknown[]>(
        await page.request.get(
          `/engines-api/engines/${encodeURIComponent(engineId)}/runtime-resources`,
        ),
        'read reconciled dedicated engine inventory',
      );
      expect(inventory.length).toBeGreaterThan(0);

      const persisted = await responseJson<Record<string, unknown>>(
        await page.request.get(`/engines-api/engines/${encodeURIComponent(engineId)}`),
        'verify persisted dedicated engine update',
      );
      expect(persisted).toMatchObject({
        id: engineId,
        name: updatedName,
        tenancyMode: 'dedicated',
        tenantId: 'tenant-default',
      });

      await row.getByRole('button', { name: 'Options' }).click();
      const deleteResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'DELETE'
          && new URL(response.url()).pathname.endsWith(
            `/engines-api/engines/${encodeURIComponent(engineId!)}`,
          ),
      );
      await page.getByRole('menuitem', { name: /^Delete/ }).click();
      const deleteResponse = await deleteResponsePromise;
      expect(deleteResponse.status()).toBe(204);
      engineId = null;
      await expect(page.getByText('Engine deleted', { exact: true })).toBeVisible();
      await expect(page.getByRole('row').filter({ hasText: updatedName })).toHaveCount(0);

      const observationDirectory = path.join(
        process.cwd(),
        'test/results/engine-tenancy-provisioning-observations',
      );
      await mkdir(observationDirectory, { recursive: true });
      await writeFile(
        path.join(observationDirectory, 'journey-01-manual-ui.json'),
        `${JSON.stringify({
          schemaVersion: 1,
          journeyId: 1,
          channel: 'manual-ui',
          status: 'passed',
          commit,
          sourceState,
          releaseCommitQualified: sourceState === 'clean',
          localhostOnly: true,
          realHttpService: true,
          persistentDatabase: true,
          authorizationEvaluator: true,
          userInterface: true,
          assertions: ['create', 'inspect', 'update', 'reconcile', 'remove'],
          sanitization: {
            containsCredentials: false,
            containsTokens: false,
            containsPrivateEndpoints: false,
            containsRawIdentityClaims: false,
            containsCustomerIdentifiers: false,
          },
        }, null, 2)}\n`,
      );
    } finally {
      if (engineId) {
        const cleanup = await page.request.delete(
          `/engines-api/engines/${encodeURIComponent(engineId)}`,
          mutationOptions(token),
        );
        expect(
          [204, 404],
          `cleanup engine ${engineId} failed (${cleanup.status()}): ${await cleanup.text()}`,
        ).toContain(cleanup.status());
      }
    }
  });
});
