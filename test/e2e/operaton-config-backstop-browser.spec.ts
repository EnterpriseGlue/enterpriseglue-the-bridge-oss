import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getE2ECredentials } from './utils/credentials';

const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';
const engineUrl = process.env.OPERATON_BACKSTOP_ENGINE_URL || '';
const operatonUrl = process.env.OPERATON_BACKSTOP_DIRECT_URL || '';
const nativeGroupId = process.env.OPERATON_CONFIG_BACKSTOP_NATIVE_GROUP || '';
const enabled = process.env.OPERATON_CONFIG_BACKSTOP_BROWSER_EVIDENCE === 'true'
  && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/.test(baseUrl)
  && /^http:\/\/host\.docker\.internal(?::\d+)?\/engine-rest$/.test(engineUrl)
  && /^http:\/\/(127\.0\.0\.1|localhost)(?::\d+)?\/engine-rest$/.test(operatonUrl)
  && /^egconfigbackstop[a-z0-9]+$/.test(nativeGroupId);

type ConfigApply = {
  canonicalHash: string;
  applyRunId: string;
  changes: Array<{ objectType: string; key: string; operation: string; currentId?: string }>;
  reconciliation: {
    runtimeReconciliation: { status: string; taskId: string | null };
  };
};
type NativeAuthorization = { id: string; type: number; groupId: string; resourceType: number; resourceId: string; permissions: string[] };

async function json<T>(response: Awaited<ReturnType<Page['request']['get']>>, label: string): Promise<T> {
  const body = await response.json().catch(() => null);
  expect(response.ok(), `${label} failed (${response.status()}): ${JSON.stringify(body)}`).toBe(true);
  return body as T;
}

async function csrf(page: Page): Promise<string> {
  const response = await page.request.get('/api/csrf-token');
  expect(response.status()).toBe(200);
  const token = response.headers()['x-csrf-token'];
  expect(token).toBeTruthy();
  return token;
}

async function mutation(page: Page, data?: unknown) {
  return { headers: { 'X-CSRF-Token': await csrf(page) }, ...(data === undefined ? {} : { data }) };
}

async function postWithFreshCsrf(page: Page, path: string, data: unknown) {
  // The dashboard can refresh a local session while this intentionally long
  // configuration/reconciliation rehearsal is polling. Retry only an initial
  // 403 with a freshly minted double-submit token; ordinary API failures still
  // flow to the labelled assertion below.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await page.request.post(path, await mutation(page, data));
    if (response.status() !== 403 || attempt === 1) return response;
  }
  throw new Error('unreachable');
}

async function login(page: Page): Promise<void> {
  const { email, password } = getE2ECredentials();
  if (!email || !password) throw new Error('Disposable local browser credentials are unavailable');
  await page.goto('/login?local=1');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith('/api/auth/login'));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const response = await responsePromise;
  const body = await response.json().catch(() => null);
  expect(response.ok(), `local E2E administrator login failed (${response.status()}): ${JSON.stringify(body)}`).toBe(true);
  await page.waitForURL(/\/t\/default(?:\/|$)/);
}

async function deployFixture(page: Page): Promise<void> {
  for (const file of ['authorization-process.bpmn', 'authorization-decision.dmn']) {
    const content = await readFile(resolve(process.cwd(), 'test/e2e/operaton-container/fixtures', file));
    const response = await page.request.post(`${operatonUrl}/deployment/create`, {
      multipart: { 'deployment-name': `enterpriseglue-config-backstop-${file}`, [file]: { name: file, mimeType: 'application/xml', buffer: content } },
    });
    expect(response.ok(), `deploy ${file} to Operaton failed (${response.status()}): ${await response.text()}`).toBe(true);
  }
}

async function applyBundle(page: Page, envelope: Record<string, unknown>, idempotencyKey: string): Promise<ConfigApply> {
  const preview = await json<{ valid: boolean; canonicalHash: string }>(
    await postWithFreshCsrf(page, '/api/authz/config-bundles/preview', envelope),
    'preview headless Operaton bundle',
  );
  expect(preview.valid).toBe(true);
  const diff = await json<{ valid: boolean; canonicalHash: string; requiredAcknowledgements: string[]; changes: Array<{ objectType: string; key: string; operation: string; reason: string }> }>(
    await postWithFreshCsrf(page, '/api/authz/config-bundles/diff', envelope),
    'diff headless Operaton bundle',
  );
  expect(diff.valid).toBe(true);
  expect(diff.canonicalHash).toBe(preview.canonicalHash);
  expect(diff.changes.filter((change) => change.operation === 'conflict'), 'headless configuration diff must resolve every referenced object').toEqual([]);
  const result = await json<ConfigApply>(
    await postWithFreshCsrf(page, '/api/authz/config-bundles/apply', {
      ...envelope,
      expectedPreviewHash: preview.canonicalHash,
      acknowledgements: diff.requiredAcknowledgements,
      idempotencyKey,
      identityReconciliationMode: 'none',
    }),
    'apply headless Operaton bundle',
  );
  expect(result.canonicalHash).toBe(preview.canonicalHash);
  return result;
}

async function waitForRuntimeReconciliation(page: Page, apply: ConfigApply): Promise<void> {
  const taskId = apply.reconciliation.runtimeReconciliation.taskId;
  expect(taskId, 'a changed configured engine must queue durable runtime inventory reconciliation').toBeTruthy();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const tasks = await json<Array<{ id: string; status: string; attempts: number; lastError: string | null }>>(
      await page.request.get(`/api/authz/config-bundles/runs/${encodeURIComponent(apply.applyRunId)}/runtime-reconciliation-tasks`),
      'read headless configuration runtime reconciliation receipt',
    );
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (task?.status === 'completed') return;
    if (task && (task.attempts > 0 || task.lastError)) {
      throw new Error(`Headless configuration runtime reconciliation failed: ${task.lastError || 'unknown failure'}`);
    }
    await page.waitForTimeout(250);
  }
  throw new Error('Timed out waiting for headless configuration runtime reconciliation');
}

async function waitForResolvedConfigReferences(page: Page, envelope: Record<string, unknown>): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const diff = await json<{ valid: boolean; changes: Array<{ operation: string; reason: string }> }>(
      await postWithFreshCsrf(page, '/api/authz/config-bundles/diff', envelope),
      'wait for discovered runtime resources to resolve configuration references',
    );
    if (diff.valid && !diff.changes.some((change) => change.operation === 'conflict')) return;
    await page.waitForTimeout(250);
  }
  throw new Error('Timed out waiting for Operaton runtime discovery to resolve exact configuration grants');
}

test.describe('Operaton headless configuration backstop workflow', () => {
  test.setTimeout(180_000);
  test.skip(!enabled, 'Runs only from the explicit localhost Operaton configuration-backstop runner.');

  test('provisions the engine, mappings, and exact resource grants from JSON configuration', async ({ page }) => {
    await login(page);
    await deployFixture(page);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const bundleKey = `e2e.operaton-config-backstop.${suffix}`;
    const engineKey = `engine.operaton-config-backstop.${suffix}`;
    const groupKey = `group.operaton-config-backstop.${suffix}`;
    const roleKey = `custom.operaton-config-backstop.${suffix}`;
    const mappingKey = `engine-backstop-mapping.operaton-config-${suffix}`;
    const baseBundle = {
      bundle: {
        apiVersion: 'enterpriseglue.ai/v1beta1', kind: 'EnterpriseGlueConfigBundle',
        metadata: { key: bundleKey, owner: 'local-operaton-config-rehearsal' },
        tenantKey: 'default', mode: 'authoritative',
      },
    };
    const engine = {
      key: engineKey, name: `Configured Operaton backstop ${suffix}`, type: 'operaton', baseUrl: engineUrl,
      auth: { type: 'basic', username: 'demo', passwordRef: 'env://OPERATON_CONFIG_BACKSTOP_PASSWORD' },
      connectionMode: 'direct', runtimeAccessScope: 'resource_aware',
      tenancy: { mode: 'dedicated', tenantRef: { type: 'default' } },
      metadataDiscoveryEnabled: true, deploymentDiscoveryEnabled: false, pipelineReceiptEnabled: false,
      ownershipMode: 'config_locked',
    };
    const role = {
      key: roleKey, name: `Configured Operaton viewer ${suffix}`, scope: 'engine',
      permissions: ['engine:instance:view'], ownershipMode: 'config_locked',
    };
    const group = { key: groupKey, name: `Configured Operaton operators ${suffix}`, ownershipMode: 'config_locked' };
    const mapping = {
      key: mappingKey, engineRef: { engineKey }, groupRef: { groupKey },
      nativeGroupIdRef: 'env://OPERATON_CONFIG_BACKSTOP_NATIVE_GROUP', ownershipMode: 'config_locked',
    };
    const initial = {
      ...baseBundle,
      bundle: { ...baseBundle.bundle, imports: ['./roles.json', './groups.json', './engines.json', './engine-backstop-mappings.json'] },
      files: {
        './roles.json': { roles: [role] },
        './groups.json': { groups: [group] },
        './engines.json': { engines: [engine] },
        './engine-backstop-mappings.json': { engineBackstopMappings: [mapping] },
      },
    };
    const full = {
      ...baseBundle,
      bundle: { ...baseBundle.bundle, imports: ['./roles.json', './groups.json', './engines.json', './engine-backstop-mappings.json', './assignments.json'] },
      files: {
        ...initial.files,
        './assignments.json': { assignments: [
          { key: `assignment.${suffix}.process`, principal: { type: 'group', key: groupKey }, roleKey, ownershipMode: 'config_locked', scope: { type: 'engine_runtime_resource', engineKey, resourceKind: 'process_definition', resourceKey: 'egprocess' } },
          { key: `assignment.${suffix}.decision`, principal: { type: 'group', key: groupKey }, roleKey, ownershipMode: 'config_locked', scope: { type: 'engine_runtime_resource', engineKey, resourceKind: 'decision_definition', resourceKey: 'egdecision' } },
        ] },
      },
    };
    const empty = {
      ...baseBundle,
      bundle: { ...baseBundle.bundle, imports: ['./roles.json', './groups.json', './engines.json', './engine-backstop-mappings.json', './assignments.json'] },
      files: {
        './roles.json': { roles: [] }, './groups.json': { groups: [] }, './engines.json': { engines: [] },
        './engine-backstop-mappings.json': { engineBackstopMappings: [] }, './assignments.json': { assignments: [] },
      },
    };
    let engineId: string | null = null;
    try {
      const groupResponse = await page.request.post(`${operatonUrl}/group/create`, { data: { id: nativeGroupId, name: 'Configured EnterpriseGlue backstop group', type: 'WORKFLOW' } });
      expect(groupResponse.ok(), `create disposable Operaton native group failed (${groupResponse.status()}): ${await groupResponse.text()}`).toBe(true);

      const initialApply = await applyBundle(page, initial, `operaton-config-initial-${suffix}`);
      expect(initialApply.changes).toEqual(expect.arrayContaining([
        expect.objectContaining({ objectType: 'engine', key: engineKey, operation: 'create' }),
        expect.objectContaining({ objectType: 'engine_backstop_mapping', key: mappingKey, operation: 'create' }),
      ]));
      // A create diff intentionally has no pre-existing ID. Reapply the same
      // source-owned bundle to obtain the durable engine ID from its noop
      // receipt, exactly as a headless caller would on its next reconciliation.
      const stableInitial = await applyBundle(page, initial, `operaton-config-initial-stable-${suffix}`);
      engineId = stableInitial.changes.find((change) => change.objectType === 'engine' && change.key === engineKey)?.currentId || null;
      expect(engineId).toBeTruthy();
      await waitForRuntimeReconciliation(page, initialApply);
      await waitForResolvedConfigReferences(page, full);

      const fullApply = await applyBundle(page, full, `operaton-config-grants-${suffix}`);
      expect(fullApply.changes).toEqual(expect.arrayContaining([
        expect.objectContaining({ objectType: 'assignment', operation: 'create' }),
      ]));
      const exported = await json<Record<string, unknown>>(
        await page.request.get(`/api/authz/config-bundles/export?bundleKey=${encodeURIComponent(bundleKey)}&tenantKey=default`),
        'export JSON-configured Operaton bundle',
      );
      expect(JSON.stringify(exported)).not.toContain(nativeGroupId);
      expect(JSON.stringify(exported)).toContain('env://OPERATON_CONFIG_BACKSTOP_NATIVE_GROUP');

      const preview = await json<{ run: { id: string; desiredHash: string; counts: { proposed: number; blocked: number; manualRequired: number } } }>(
        await page.request.post(`/engines-api/engines/${encodeURIComponent(engineId!)}/backstop/sync/preview`, await mutation(page, {})),
        'preview config-mapped native authorization backstop',
      );
      expect(preview.run.counts).toMatchObject({ proposed: 2, blocked: 0, manual_required: 0 });
      const applied = await json<{ run: { status: string } }>(
        await page.request.post(`/engines-api/engines/${encodeURIComponent(engineId!)}/backstop/sync/${encodeURIComponent(preview.run.id)}/apply`, await mutation(page, {
          desiredHash: preview.run.desiredHash, acknowledgeDirectIdentityBoundary: true,
        })),
        'apply config-mapped native authorization backstop',
      );
      expect(applied.run.status).toBe('succeeded');
      const grants = await json<NativeAuthorization[]>(
        await page.request.get(`${operatonUrl}/authorization?groupIdIn=${encodeURIComponent(nativeGroupId)}`),
        'read JSON-configured Operaton native grants',
      );
      expect(grants.map((grant) => ({ type: grant.type, groupId: grant.groupId, resourceType: grant.resourceType, resourceId: grant.resourceId, permissions: grant.permissions })).sort((left, right) => left.resourceType - right.resourceType)).toEqual([
        { type: 1, groupId: nativeGroupId, resourceType: 6, resourceId: 'egprocess', permissions: ['READ'] },
        { type: 1, groupId: nativeGroupId, resourceType: 10, resourceId: 'egdecision', permissions: ['READ'] },
      ]);
    } finally {
      await applyBundle(page, empty, `operaton-config-cleanup-${suffix}`).catch(() => undefined);
    }
  });
});
