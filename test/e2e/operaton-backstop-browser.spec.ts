import { expect, test, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { getE2ECredentials } from './utils/credentials';

const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';
// The EnterpriseGlue backend runs in Docker, so its registration endpoint
// needs Docker's host gateway. The browser talks to the same disposable engine
// through the loopback address that was published by the test runner.
const engineUrl = process.env.OPERATON_BACKSTOP_ENGINE_URL || '';
const operatonUrl = process.env.OPERATON_BACKSTOP_DIRECT_URL || '';
const enabled = process.env.OPERATON_BACKSTOP_BROWSER_EVIDENCE === 'true'
  && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/.test(baseUrl)
  && /^http:\/\/host\.docker\.internal(?::\d+)?\/engine-rest$/.test(engineUrl)
  && /^http:\/\/(127\.0\.0\.1|localhost)(?::\d+)?\/engine-rest$/.test(operatonUrl);
const restartBackendForDurability = process.env.OPERATON_BACKSTOP_RESTART_BACKEND === 'true';
const execFileAsync = promisify(execFile);

type CreatedEngine = { id: string; name: string };
type RuntimeResource = { id: string; resourceKind: string; resourceKey: string };
type NativeAuthorization = { id: string; type: number; groupId: string; resourceType: number; resourceId: string; permissions: string[] };

async function json<T>(response: Awaited<ReturnType<Page['request']['get']>>, label: string): Promise<T> {
  const body = await response.json().catch(() => null);
  expect(response.ok(), `${label} failed (${response.status()}): ${JSON.stringify(body)}`).toBe(true);
  return body as T;
}

async function csrf(page: Page): Promise<string> {
  const response = await page.request.get('/api/csrf-token');
  expect(response.status()).toBe(200);
  const value = response.headers()['x-csrf-token'];
  expect(value).toBeTruthy();
  return value;
}

async function mutation(page: Page, data?: unknown) {
  return { headers: { 'X-CSRF-Token': await csrf(page) }, ...(data === undefined ? {} : { data }) };
}

async function login(page: Page): Promise<void> {
  const { email, password } = getE2ECredentials();
  if (!email || !password) throw new Error('Disposable local browser credentials are unavailable');
  await page.goto('/login?local=1');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/t\/default(?:\/|$)/);
}

async function restartLocalBackend(page: Page): Promise<void> {
  if (!restartBackendForDurability) return;
  const repoRoot = process.cwd();
  await execFileAsync('docker', [
    'compose', '--project-directory', repoRoot, '--env-file', resolve(repoRoot, '.env.docker'),
    '-f', resolve(repoRoot, 'infra/docker/compose/docker-compose.yml'),
    '-f', resolve(repoRoot, 'infra/docker/compose/docker-compose.backend-expose.yml'),
    'restart', 'backend',
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  let lastStatus = 0;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await page.request.get('/api/csrf-token', { timeout: 2_000 });
      lastStatus = response.status();
      if (response.ok()) return;
    } catch {
      // The reverse proxy can briefly lose the freshly restarted backend.
    }
    await page.waitForTimeout(1_000);
  }
  throw new Error(`EnterpriseGlue backend did not become ready after its durability restart (last status ${lastStatus})`);
}

async function deployFixture(page: Page): Promise<void> {
  for (const file of ['authorization-process.bpmn', 'authorization-decision.dmn']) {
    const content = await readFile(resolve(process.cwd(), 'test/e2e/operaton-container/fixtures', file));
    const response = await page.request.post(`${operatonUrl}/deployment/create`, {
      multipart: { 'deployment-name': `enterpriseglue-backstop-${file}`, [file]: { name: file, mimeType: 'application/xml', buffer: content } },
    });
    expect(response.ok(), `deploy ${file} to Operaton failed (${response.status()}): ${await response.text()}`).toBe(true);
  }
}

async function openPanel(page: Page, engineName: string) {
  await page.goto('/t/default/engines');
  const row = page.getByRole('row').filter({ hasText: engineName });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole('button', { name: 'Options' }).click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit engine' });
  await expect(dialog.getByRole('heading', { name: 'Native authorization backstop' })).toBeVisible();
  return dialog;
}

test.describe('Operaton native authorization backstop browser workflow', () => {
  test.setTimeout(180_000);
  test.skip(!enabled, 'Runs only from the explicit localhost Operaton backstop browser runner.');

  test('maps, previews, applies, detects drift, and keeps native IDs write-only against direct Operaton', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await login(page);
      await deployFixture(page);
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const groupName = `Operaton browser operators ${suffix}`;
      const nativeGroupId = `eg-operaton-ui-${suffix}`;
      let engine: CreatedEngine | null = null;
      let assignmentIds: string[] = [];
      let groupId: string | null = null;
      let roleId: string | null = null;

      try {
        const createdGroup = await json<{ id: string }>(
          await page.request.post('/api/authz/groups', await mutation(page, { name: groupName, description: 'Disposable Operaton backstop browser fixture.' })),
          'create Operaton authorization group',
        );
        groupId = createdGroup.id;
        const createdRole = await json<{ id: string }>(
          await page.request.post('/api/authz/roles', await mutation(page, {
            name: `Operaton backstop viewer ${suffix}`,
            description: 'Disposable exact-view role for Operaton native authorization evidence.',
            scope: 'engine',
            permissionIds: ['engine:instance:view'],
          })),
          'create exact Operaton runtime-viewer role',
        );
        roleId = createdRole.id;
        engine = await json<CreatedEngine>(
          await page.request.post('/engines-api/engines', await mutation(page, {
            name: `Operaton browser backstop ${suffix}`,
            baseUrl: engineUrl,
            type: 'operaton',
            // The disposable Operaton image exposes its documented demo
            // account. A direct engine must still be credentialed: keep that
            // production guard in place rather than making the test endpoint
            // credentialless.
            authType: 'basic',
            username: 'demo',
            passwordEnc: 'demo',
            connectionMode: 'direct',
            runtimeAccessScope: 'resource_aware',
            deploymentDiscoveryEnabled: false,
          })),
          'create Operaton engine',
        );
        await json(
          await page.request.post(`/engines-api/engines/${encodeURIComponent(engine.id)}/runtime-resources/reconcile`, await mutation(page)),
          'reconcile Operaton runtime resources',
        );
        const resources = await json<RuntimeResource[]>(
          await page.request.get(`/engines-api/engines/${encodeURIComponent(engine.id)}/runtime-resources`),
          'read reconciled Operaton runtime resources',
        );
        const projectedResources = resources.filter((resource) => (
          (resource.resourceKind === 'process_definition' && resource.resourceKey === 'egprocess')
          || (resource.resourceKind === 'decision_definition' && resource.resourceKey === 'egdecision')
        ));
        expect(projectedResources).toHaveLength(2);
        for (const resource of projectedResources) {
          const assignment = await json<{ id: string }>(
            await page.request.post('/api/authz/role-assignments', await mutation(page, {
              principalType: 'group', principalId: groupId, roleId,
              resourceType: 'engine_runtime_resource', resourceId: resource.id,
            })),
            `assign Operaton ${resource.resourceKind} runtime view`,
          );
          assignmentIds.push(assignment.id);
        }

        const dialog = await openPanel(page, engine.name);
        const backstop = dialog.getByRole('region', { name: 'Native authorization backstop' });
        await expect(backstop).toBeVisible();
        await backstop.getByLabel('EnterpriseGlue group ID').fill(groupId);
        await backstop.getByLabel('Engine group ID (write-only)').fill(nativeGroupId);
        const inputGeometry = await backstop.getByLabel('Engine group ID (write-only)').evaluate((element) => {
          const peer = document.getElementById('backstop-authz-group-id');
          const own = element.getBoundingClientRect();
          const other = peer?.getBoundingClientRect();
          return other ? { top: Math.abs(own.top - other.top), bottom: Math.abs(own.bottom - other.bottom) } : null;
        });
        expect(inputGeometry).toEqual({ top: 0, bottom: 0 });
        await backstop.getByRole('button', { name: 'Save manual mapping' }).click();
        await expect.poll(() => backstop.locator('input').evaluateAll(
          (inputs, id) => inputs.some((input) => input.value === id),
          nativeGroupId,
        )).toBe(false);
        await expect(backstop.getByText(nativeGroupId, { exact: true })).toHaveCount(0);
        await backstop.getByRole('button', { name: 'Create backstop preview' }).click();
        await expect(backstop.getByText('Previewed', { exact: true }).first()).toBeVisible();
        await expect(backstop.getByRole('button', { name: 'Apply reviewed backstop' })).toBeVisible();
        const applyAcknowledgement = backstop.locator('#backstop-apply-acknowledgement');
        await expect(applyAcknowledgement).toBeEnabled();
        await applyAcknowledgement.check({ force: true });
        await expect(applyAcknowledgement).toBeChecked();
        await backstop.getByRole('button', { name: 'Apply reviewed backstop' }).click();
        await expect(backstop.getByText('Succeeded', { exact: true }).first()).toBeVisible();

        const grants = await json<NativeAuthorization[]>(
          await page.request.get(`${operatonUrl}/authorization?groupIdIn=${encodeURIComponent(nativeGroupId)}`),
          'read owned Operaton authorization grants',
        );
        expect(grants.map((grant) => ({ type: grant.type, groupId: grant.groupId, resourceType: grant.resourceType, resourceId: grant.resourceId, permissions: grant.permissions })).sort((left, right) => left.resourceType - right.resourceType)).toEqual([
          { type: 1, groupId: nativeGroupId, resourceType: 6, resourceId: 'egprocess', permissions: ['READ'] },
          { type: 1, groupId: nativeGroupId, resourceType: 10, resourceId: 'egdecision', permissions: ['READ'] },
        ]);
        await restartLocalBackend(page);
        await page.request.delete(`${operatonUrl}/authorization/${encodeURIComponent(grants[0].id)}`);
        await backstop.getByRole('button', { name: 'Check native drift' }).click();
        await expect(backstop.getByText('Native drift detected', { exact: true })).toBeVisible();
        const screenshot = await backstop.screenshot();
        await testInfo.attach('operaton-backstop-direct.png', { body: screenshot, contentType: 'image/png' });
        if (process.env.OPERATON_BACKSTOP_SCREENSHOT_PATH) {
          await writeFile(process.env.OPERATON_BACKSTOP_SCREENSHOT_PATH, screenshot);
        }
      } finally {
        for (const assignmentId of assignmentIds.reverse()) await page.request.delete(`/api/authz/role-assignments/${encodeURIComponent(assignmentId)}`, await mutation(page)).catch(() => undefined);
        if (roleId) await page.request.delete(`/api/authz/roles/${encodeURIComponent(roleId)}`, await mutation(page)).catch(() => undefined);
        if (engine) await page.request.delete(`/engines-api/engines/${encodeURIComponent(engine.id)}`, await mutation(page)).catch(() => undefined);
        if (groupId) await page.request.put(`/api/authz/groups/${encodeURIComponent(groupId)}`, await mutation(page, { isArchived: true })).catch(() => undefined);
      }
  });
});
