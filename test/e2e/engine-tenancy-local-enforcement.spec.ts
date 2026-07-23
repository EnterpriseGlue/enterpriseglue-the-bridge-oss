import { expect, test, type APIResponse, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import {
  getE2ECredentials,
  getE2EFineGrainedFixture,
  hasE2ECredentials,
} from './utils/credentials';

type ClassificationRow = {
  engineId: string;
  engineName: string;
  status: 'classified' | 'ready_for_apply' | 'requires_review' | 'conflict';
  reason: string;
  proposed: {
    mode: 'dedicated' | 'shared';
    tenantRef?: { type: 'default' | 'id' | 'key'; id?: string; key?: string };
    mappingStrategy?: 'engine_tenant_id' | 'deployment_target' | 'explicit';
  } | null;
};

type ClassificationReport = {
  generatedAt: number;
  defaultTenantId: string;
  totals: {
    engines: number;
    classified: number;
    readyForApply: number;
    requiresReview: number;
    conflicts: number;
  };
  rows: ClassificationRow[];
};

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
const enabled = process.env.ENGINE_TENANCY_LOCAL_EVIDENCE === 'true'
  && isLocalUrl(baseUrl)
  && isLocalUrl(apiUrl)
  && hasE2ECredentials();
const applyReadyRows = process.env.ENGINE_TENANCY_APPLY_READY === 'true';

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

async function classificationReport(page: Page): Promise<ClassificationReport> {
  return responseJson<ClassificationReport>(
    await page.request.get('/engines-api/engines/tenancy/classification-report'),
    'read tenancy classification report',
  );
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

async function applyReadyClassificationRows(
  page: Page,
  report: ClassificationReport,
  token: string,
  operatorUserId: string,
  migrationRoleId: string,
): Promise<string[]> {
  const applied: string[] = [];
  for (const row of report.rows.filter((candidate) => candidate.status === 'ready_for_apply')) {
    if (!row.proposed) throw new Error(`Ready row ${row.engineId} has no proposed tenancy state`);
    const assignment = await responseJson<{ id: string }>(
      await page.request.post('/api/authz/role-assignments', mutationOptions(token, {
        principalType: 'user',
        principalId: operatorUserId,
        roleId: migrationRoleId,
        resourceType: 'engine',
        resourceId: row.engineId,
      })),
      `grant temporary tenancy migration access for ${row.engineId}`,
    );
    try {
      const preview = await responseJson<{
        previewHash: string;
        previewExpiresAt: number;
        requiredAcknowledgements: string[];
      }>(
        await page.request.post(`/engines-api/engines/${encodeURIComponent(row.engineId)}/tenancy/preview`, {
          ...mutationOptions(token, { tenancy: row.proposed }),
        }),
        `preview tenancy classification for ${row.engineId}`,
      );
      await responseJson(
        await page.request.post(`/engines-api/engines/${encodeURIComponent(row.engineId)}/tenancy/apply`, {
          ...mutationOptions(token, {
            tenancy: row.proposed,
            previewHash: preview.previewHash,
            previewExpiresAt: preview.previewExpiresAt,
            acknowledgements: preview.requiredAcknowledgements,
          }),
        }),
        `apply tenancy classification for ${row.engineId}`,
      );
      applied.push(row.engineId);
    } finally {
      const removal = await page.request.delete(
        `/api/authz/role-assignments/${encodeURIComponent(assignment.id)}`,
        mutationOptions(token),
      );
      expect(
        [204, 404],
        `remove temporary migration assignment ${assignment.id} failed (${removal.status()})`,
      ).toContain(removal.status());
    }
  }
  return applied;
}

test.describe('Local engine-tenancy enforcement evidence', () => {
  test.skip(
    !enabled,
    'Set ENGINE_TENANCY_LOCAL_EVIDENCE=true with a localhost URL and disposable seeded credentials.',
  );

  test('proves classification, dedicated defaults, shared fail-closed mapping, and readiness metrics', async ({
    page,
  }, testInfo: TestInfo) => {
    await login(page);
    const token = await csrfToken(page);
    const session = await responseJson<{ user?: { id?: string }; id?: string }>(
      await page.request.get('/api/auth/me'),
      'read local operator session',
    );
    const operatorUserId = session.user?.id || session.id;
    if (!operatorUserId) throw new Error('Local operator session has no canonical user ID');
    const migrationRoleId = getE2EFineGrainedFixture().runtimeCustomRoleId;
    if (!migrationRoleId) throw new Error('Disposable engine-scoped migration role is unavailable');

    const initialReport = await classificationReport(page);
    expect(initialReport.totals.requiresReview).toBe(0);
    expect(initialReport.totals.conflicts).toBe(0);

    let appliedEngineIds: string[] = [];
    if (applyReadyRows && initialReport.totals.readyForApply > 0) {
      await responseJson(
        await page.request.put(
          `/api/authz/roles/${encodeURIComponent(migrationRoleId)}`,
          mutationOptions(token, {
            permissionIds: ['engine:instance:view', 'engine:edit'],
          }),
        ),
        'prepare disposable engine-tenancy migration role',
      );
      appliedEngineIds = await applyReadyClassificationRows(
        page,
        initialReport,
        token,
        operatorUserId,
        migrationRoleId,
      );
    }
    const classifiedReport = await classificationReport(page);
    if (applyReadyRows) {
      expect(classifiedReport.totals.readyForApply).toBe(0);
    }
    expect(classifiedReport.totals.requiresReview).toBe(0);
    expect(classifiedReport.totals.conflicts).toBe(0);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createdEngineIds: string[] = [];
    let dedicated: Record<string, unknown> | null = null;
    let shared: Record<string, unknown> | null = null;
    let unmappedDiagnostics: Record<string, unknown> | null = null;
    let mappedDiagnostics: Record<string, unknown> | null = null;
    let finalReport: ClassificationReport | null = null;
    let metrics = '';

    try {
      const unsafeShared = await page.request.post('/engines-api/engines', {
        ...mutationOptions(token, {
          name: `tenancy-evidence-unsafe-${suffix}`,
          baseUrl: 'http://camunda-mock:9080/engine-rest',
          type: 'camunda7',
          deploymentDiscoveryEnabled: false,
          tenancy: { mode: 'shared', mappingStrategy: 'engine_tenant_id' },
        }),
      });
      expect(unsafeShared.status()).toBe(400);
      expect(await unsafeShared.json()).toMatchObject({
        code: 'ENGINE_SHARED_REQUIRES_RESOURCE_AWARE',
        field: 'tenancy',
      });

      dedicated = await responseJson<Record<string, unknown>>(
        await page.request.post('/engines-api/engines', {
          ...mutationOptions(token, {
            name: `tenancy-evidence-dedicated-${suffix}`,
            baseUrl: 'http://camunda-mock:9080/engine-rest',
            type: 'camunda7',
            deploymentDiscoveryEnabled: false,
          }),
        }),
        'create dedicated evidence engine',
      );
      createdEngineIds.push(String(dedicated.id));
      expect(dedicated).toMatchObject({
        tenancyMode: 'dedicated',
        tenantId: 'tenant-default',
        tenantResolutionStatus: 'ready',
        runtimeAccessScope: 'engine_wide',
      });

      shared = await responseJson<Record<string, unknown>>(
        await page.request.post('/engines-api/engines', {
          ...mutationOptions(token, {
            name: `tenancy-evidence-shared-${suffix}`,
            baseUrl: 'http://camunda-mock:9080/engine-rest',
            type: 'camunda7',
            runtimeAccessScope: 'resource_aware',
            deploymentDiscoveryEnabled: false,
            tenancy: { mode: 'shared', mappingStrategy: 'engine_tenant_id' },
          }),
        }),
        'create shared evidence engine',
      );
      const sharedEngineId = String(shared.id);
      createdEngineIds.push(sharedEngineId);
      expect(shared).toMatchObject({
        tenancyMode: 'shared',
        tenantId: null,
        tenantMappingStrategy: 'engine_tenant_id',
        tenantResolutionStatus: 'incomplete',
        runtimeAccessScope: 'resource_aware',
      });

      await responseJson(
        await page.request.post(
          `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/runtime-resources/reconcile`,
          mutationOptions(token),
        ),
        'reconcile unmapped shared inventory',
      );
      unmappedDiagnostics = await responseJson<Record<string, unknown>>(
        await page.request.get(
          `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/tenancy/diagnostics`,
        ),
        'read unmapped shared diagnostics',
      );
      expect(unmappedDiagnostics).toMatchObject({
        mode: 'shared',
        resolutionStatus: 'incomplete',
        mappedResourceCount: 0,
      });
      expect(Number(unmappedDiagnostics.unmappedResourceCount)).toBeGreaterThan(0);
      const hiddenResources = await responseJson<unknown[]>(
        await page.request.get(
          `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/runtime-resources`,
        ),
        'read fail-closed shared inventory',
      );
      expect(hiddenResources).toEqual([]);

      const mapping = await responseJson<{
        mappingVersion: number;
        created: number;
      }>(
        await page.request.put(
          `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/tenant-mappings`,
          mutationOptions(token, {
              expectedMappingVersion: 0,
              dryRun: false,
              atomic: true,
              mappings: [{
                externalTenantId: '',
                tenantRef: { type: 'default' },
                strategy: 'engine_tenant_id',
                sourceRef: `local-evidence:${suffix}`,
              }],
          }),
        ),
        'map shared runtime tenant',
      );
      expect(mapping).toMatchObject({ mappingVersion: 1, created: 1 });

      await responseJson(
        await page.request.post(
          `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/runtime-resources/reconcile`,
          mutationOptions(token),
        ),
        'reconcile mapped shared inventory',
      );
      mappedDiagnostics = await responseJson<Record<string, unknown>>(
        await page.request.get(
          `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/tenancy/diagnostics`,
        ),
        'read mapped shared diagnostics',
      );
      expect(mappedDiagnostics).toMatchObject({
        mode: 'shared',
        resolutionStatus: 'ready',
        unmappedResourceCount: 0,
        conflictingResourceCount: 0,
      });
      expect(Number(mappedDiagnostics.mappedResourceCount)).toBeGreaterThan(0);
      const visibleResources = await responseJson<unknown[]>(
        await page.request.get(
          `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/runtime-resources`,
        ),
        'read mapped shared inventory',
      );
      expect(visibleResources.length).toBeGreaterThan(0);

      finalReport = await classificationReport(page);
      expect(finalReport.totals).toMatchObject({
        readyForApply: applyReadyRows ? 0 : classifiedReport.totals.readyForApply,
        requiresReview: 0,
        conflicts: 0,
      });
      expect(
        finalReport.totals.classified + finalReport.totals.readyForApply,
      ).toBe(finalReport.totals.engines);

      const metricsResponse = await page.request.get(`${apiUrl}/metrics`);
      expect(metricsResponse.ok(), `read tenancy readiness metrics failed (${metricsResponse.status()})`).toBe(true);
      metrics = await metricsResponse.text();
      expect(metrics).toContain('enterpriseglue_engine_tenancy_metrics_collection_success 1');
      expect(metrics).toMatch(
        /enterpriseglue_engine_tenancy_engines\{mode="shared",resolution_status="ready"\} [1-9]\d*/,
      );
      expect(metrics).toContain(
        'enterpriseglue_engine_tenancy_runtime_resources{resolution_status="unmapped"} 0',
      );
      expect(metrics).toContain(
        'enterpriseglue_engine_tenancy_runtime_resources{resolution_status="conflict"} 0',
      );

      const evidencePath = testInfo.outputPath('engine-tenancy-local-evidence.json');
      await writeFile(evidencePath, JSON.stringify({
        generatedAt: Date.now(),
        baseUrl,
        applyReadyRows,
        initialTotals: initialReport.totals,
        appliedEngineIds,
        classifiedTotals: classifiedReport.totals,
        dedicated: {
          id: dedicated.id,
          tenancyMode: dedicated.tenancyMode,
          tenantId: dedicated.tenantId,
          resolutionStatus: dedicated.tenantResolutionStatus,
        },
        shared: {
          id: shared.id,
          tenancyMode: shared.tenancyMode,
          tenantId: shared.tenantId,
          resolutionStatus: shared.tenantResolutionStatus,
        },
        unmappedDiagnostics,
        mappedDiagnostics,
        finalTotals: finalReport.totals,
        metricsAssertions: {
          collectionSuccess: true,
          sharedReady: true,
          zeroUnmappedResources: true,
          zeroConflictingResources: true,
        },
      }, null, 2));
      await testInfo.attach('engine-tenancy-local-evidence.json', {
        path: evidencePath,
        contentType: 'application/json',
      });

      const screenshotPath = testInfo.outputPath('engine-tenancy-dashboard.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      await testInfo.attach('engine-tenancy-dashboard.png', {
        path: screenshotPath,
        contentType: 'image/png',
      });
    } finally {
      for (const engineId of createdEngineIds.reverse()) {
        const response = await page.request.delete(
          `/engines-api/engines/${encodeURIComponent(engineId)}`,
          mutationOptions(token),
        );
        expect(
          [204, 404],
          `cleanup engine ${engineId} failed (${response.status()}): ${await response.text()}`,
        ).toContain(response.status());
      }
    }
  });
});
