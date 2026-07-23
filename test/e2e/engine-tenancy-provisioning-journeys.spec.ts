import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { canonicalRoleAssignmentKey } from '../../packages/shared/src/authz/role-assignment-identity';
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

  test('journey 2 external API dedicated idempotent lifecycle', async ({ page }) => {
    const commit = git(['rev-parse', 'HEAD']);
    const sourceState = git(['status', '--porcelain', '--untracked-files=no'])
      ? 'dirty-development-run'
      : 'clean';
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const originalName = `e2e-journey-02-dedicated-${suffix}`;
    const updatedName = `${originalName}-updated`;
    const externalId = `e2e/journey-02/${suffix}`;
    let apiClientId: string | null = null;
    let assignmentId: string | null = null;
    let engineId: string | null = null;
    let decommissioned = false;
    let externalApi: APIRequestContext | null = null;

    await login(page);
    const token = await csrfToken(page);

    try {
      const apiClientResult = await responseJson<{
        client: { id: string };
        token: string;
      }>(
        await page.request.post('/api/authz/api-clients', mutationOptions(token, {
          name: `e2e-journey-02-client-${suffix}`,
          scopes: ['engine:register'],
        })),
        'create disposable external-registration API client',
      );
      apiClientId = apiClientResult.client.id;
      externalApi = await playwrightRequest.newContext({
        baseURL: apiUrl,
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: {
          Authorization: `Bearer ${apiClientResult.token}`,
          'Content-Type': 'application/json',
        },
      });

      const createPayload = {
        name: originalName,
        baseUrl: 'https://engine.example.test/engine-rest',
        externalId,
        type: 'camunda7',
        connectionMode: 'direct',
        runtimeAccessScope: 'engine_wide',
        metadataDiscoveryEnabled: false,
        deploymentDiscoveryEnabled: false,
        fieldOwnership: {
          display: 'external',
        },
        tenancy: {
          mode: 'dedicated',
          tenantRef: { type: 'default' },
        },
      };

      const unauthorizedCreate = await externalApi.post(
        '/engines-api/external/engines',
        { data: createPayload },
      );
      const unauthorizedBody = await unauthorizedCreate.json().catch(() => null);
      expect(
        unauthorizedCreate.status(),
        `unassigned external API client was not denied as expected: ${JSON.stringify(unauthorizedBody)}`,
      ).toBe(403);
      expect(unauthorizedBody).toMatchObject({
        code: 'FORBIDDEN',
        error: expect.stringContaining('not authorized'),
      });

      const assignment = await responseJson<{ id: string }>(
        await page.request.post('/api/authz/role-assignments', mutationOptions(token, {
          principalType: 'api_client',
          principalId: apiClientId,
          roleId: 'system.api.engine_registrar',
          resourceType: 'platform',
          resourceId: null,
        })),
        'grant platform API engine registrar role',
      );
      assignmentId = assignment.id;

      const createdResponse = await externalApi.post(
        '/engines-api/external/engines',
        { data: createPayload },
      );
      expect(createdResponse.status()).toBe(201);
      const created = await responseJson<{
        created: boolean;
        engine: Record<string, unknown>;
        diagnostics: { tenancyWarnings: string[] };
      }>(createdResponse, 'externally create dedicated engine');
      engineId = String(created.engine.id);
      expect(created).toMatchObject({
        created: true,
        engine: {
          id: engineId,
          name: originalName,
          externalId,
          registrationSource: 'external_api',
          tenancyMode: 'dedicated',
          tenantId: 'tenant-default',
          tenantResolutionStatus: 'ready',
          fieldOwnership: expect.objectContaining({
            display: 'external',
          }),
        },
        diagnostics: { tenancyWarnings: [] },
      });

      const idempotentRetryResponse = await externalApi.post(
        '/engines-api/external/engines',
        { data: createPayload },
      );
      expect(idempotentRetryResponse.status()).toBe(200);
      const idempotentRetry = await responseJson<{
        created: boolean;
        engine: Record<string, unknown>;
      }>(idempotentRetryResponse, 'retry external dedicated upsert');
      expect(idempotentRetry).toMatchObject({
        created: false,
        engine: { id: engineId, name: originalName, externalId },
      });

      const updatePayload = {
        ...createPayload,
        name: updatedName,
        labels: { lifecycle: 'journey-02-updated' },
      };
      const updatedResponse = await externalApi.post(
        '/engines-api/external/engines',
        { data: updatePayload },
      );
      expect(updatedResponse.status()).toBe(200);
      const updated = await responseJson<{
        created: boolean;
        engine: Record<string, unknown>;
      }>(updatedResponse, 'externally update dedicated engine');
      expect(updated).toMatchObject({
        created: false,
        engine: {
          id: engineId,
          name: updatedName,
          labels: { lifecycle: 'journey-02-updated' },
          tenancyMode: 'dedicated',
          tenantId: 'tenant-default',
        },
      });

      const persisted = await responseJson<Record<string, unknown>>(
        await page.request.get(`/engines-api/engines/${encodeURIComponent(engineId)}`),
        'inspect persisted external dedicated engine',
      );
      expect(persisted).toMatchObject({
        id: engineId,
        name: updatedName,
        externalId,
        registrationSource: 'external_api',
        tenancyMode: 'dedicated',
        tenantId: 'tenant-default',
      });

      const decommissionResponse = await externalApi.post(
        '/engines-api/external/engines/decommission',
        {
          data: {
            externalId,
            reason: 'Disposable journey 2 lifecycle completed',
          },
        },
      );
      const decommission = await responseJson<{
        decommissioned: boolean;
        engineId: string;
        lifecycleStatus: string;
      }>(decommissionResponse, 'decommission external dedicated engine');
      expect(decommission).toEqual(expect.objectContaining({
        decommissioned: true,
        engineId,
        lifecycleStatus: 'decommissioned',
      }));
      decommissioned = true;

      const externalInventory = await responseJson<Array<Record<string, unknown>>>(
        await page.request.get('/api/authz/external-engines'),
        'inspect decommissioned external engine registration',
      );
      expect(externalInventory).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: engineId,
          externalId,
          lifecycleStatus: 'decommissioned',
        }),
      ]));

      const observationDirectory = path.join(
        process.cwd(),
        'test/results/engine-tenancy-provisioning-observations',
      );
      await mkdir(observationDirectory, { recursive: true });
      await writeFile(
        path.join(observationDirectory, 'journey-02-external-api.json'),
        `${JSON.stringify({
          schemaVersion: 1,
          journeyId: 2,
          channel: 'external-api',
          status: 'passed',
          commit,
          sourceState,
          releaseCommitQualified: sourceState === 'clean',
          localhostOnly: true,
          realHttpService: true,
          persistentDatabase: true,
          authorizationEvaluator: true,
          userInterface: false,
          assertions: ['create', 'inspect', 'update', 'idempotent-retry', 'decommission'],
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
      if (externalApi && engineId && !decommissioned) {
        await externalApi.post('/engines-api/external/engines/decommission', {
          data: {
            externalId,
            reason: 'Cleanup after incomplete journey 2 test',
          },
        });
      }
      await externalApi?.dispose();
      if (assignmentId) {
        const response = await page.request.delete(
          `/api/authz/role-assignments/${encodeURIComponent(assignmentId)}`,
          mutationOptions(token),
        );
        expect([204, 404]).toContain(response.status());
      }
      if (apiClientId) {
        const response = await page.request.delete(
          `/api/authz/api-clients/${encodeURIComponent(apiClientId)}`,
          mutationOptions(token),
        );
        expect([204, 404]).toContain(response.status());
      }
    }
  });

  test('journey 3 configuration bundle dedicated round trip', async ({ page }) => {
    const commit = git(['rev-parse', 'HEAD']);
    const sourceState = git(['status', '--porcelain', '--untracked-files=no'])
      ? 'dirty-development-run'
      : 'clean';
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const bundleKey = `e2e.journey03.${suffix}`;
    const engineKey = `engine.journey03.${suffix}`;
    const engineName = `e2e-journey-03-dedicated-${suffix}`;
    let engineId: string | null = null;
    let removed = false;

    await login(page);
    const token = await csrfToken(page);
    const envelope = {
      bundle: {
        apiVersion: 'enterpriseglue.ai/v1alpha1',
        kind: 'EnterpriseGlueConfigBundle',
        metadata: {
          key: bundleKey,
          owner: 'e2e',
        },
        tenantKey: 'default',
        mode: 'authoritative',
        settings: {},
        imports: ['./engines.json'],
      },
      files: {
        './engines.json': {
          engines: [{
            key: engineKey,
            name: engineName,
            type: 'camunda7',
            baseUrl: 'http://camunda-mock:9080/engine-rest',
            auth: {
              type: 'basic',
              username: 'e2e',
              passwordRef: 'E2E_ENGINE_PASSWORD',
            },
            connectionMode: 'direct',
            runtimeAccessScope: 'engine_wide',
            tenancy: {
              mode: 'dedicated',
              tenantRef: { type: 'default' },
            },
            metadataDiscoveryEnabled: false,
            deploymentDiscoveryEnabled: false,
            pipelineReceiptEnabled: false,
            ownershipMode: 'config_locked',
          }],
        },
      },
    };

    try {
      const preview = await responseJson<{
        valid: boolean;
        canonicalHash: string;
        errors: unknown[];
        counts: Record<string, number>;
      }>(
        await page.request.post(
          '/api/authz/config-bundles/preview',
          mutationOptions(token, envelope),
        ),
        'preview dedicated configuration bundle',
      );
      expect(preview).toMatchObject({
        valid: true,
        canonicalHash: expect.any(String),
        errors: [],
        counts: { './engines.json': 1 },
      });

      const initialDiff = await responseJson<{
        valid: boolean;
        canonicalHash: string;
        changes: Array<Record<string, unknown>>;
        requiredAcknowledgements: string[];
      }>(
        await page.request.post(
          '/api/authz/config-bundles/diff',
          mutationOptions(token, envelope),
        ),
        'diff dedicated configuration bundle',
      );
      expect(initialDiff).toMatchObject({
        valid: true,
        canonicalHash: preview.canonicalHash,
        requiredAcknowledgements: [],
      });
      expect(initialDiff.changes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          objectType: 'engine',
          key: engineKey,
          operation: 'create',
        }),
      ]));

      const applied = await responseJson<{
        canonicalHash: string;
        created: number;
        updated: number;
        archived: number;
        changes: Array<Record<string, unknown>>;
        applyRunId: string;
      }>(
        await page.request.post(
          '/api/authz/config-bundles/apply',
          mutationOptions(token, {
            ...envelope,
            expectedPreviewHash: preview.canonicalHash,
            idempotencyKey: `journey-03-create-${suffix}`,
            identityReconciliationMode: 'none',
          }),
        ),
        'apply dedicated configuration bundle',
      );
      expect(applied).toMatchObject({
        canonicalHash: preview.canonicalHash,
        created: 1,
        updated: 0,
        archived: 0,
        applyRunId: expect.any(String),
      });

      const exported = await responseJson<{
        bundle: Record<string, unknown>;
        files: Record<string, {
          engines?: Array<Record<string, unknown>>;
        }>;
      }>(
        await page.request.get(
          `/api/authz/config-bundles/export?bundleKey=${encodeURIComponent(bundleKey)}&tenantKey=default`,
        ),
        'export applied dedicated configuration bundle',
      );
      expect(exported.bundle).toMatchObject({
        apiVersion: 'enterpriseglue.ai/v1alpha1',
        kind: 'EnterpriseGlueConfigBundle',
        metadata: { key: bundleKey },
        tenantKey: 'default',
        mode: 'authoritative',
        imports: ['./engines.json'],
      });
      expect(exported.files['./engines.json']?.engines).toEqual([
        expect.objectContaining({
          key: engineKey,
          name: engineName,
          tenancy: {
            mode: 'dedicated',
            tenantRef: { type: 'id', id: 'tenant-default' },
          },
          ownershipMode: 'config_locked',
        }),
      ]);

      const exportedPreview = await responseJson<{
        valid: boolean;
        canonicalHash: string;
        errors: unknown[];
      }>(
        await page.request.post(
          '/api/authz/config-bundles/preview',
          mutationOptions(token, exported),
        ),
        'preview exported dedicated configuration bundle',
      );
      expect(exportedPreview).toMatchObject({
        valid: true,
        canonicalHash: expect.any(String),
        errors: [],
      });

      const reapplied = await responseJson<{
        canonicalHash: string;
        created: number;
        updated: number;
        archived: number;
        changes: Array<Record<string, unknown>>;
      }>(
        await page.request.post(
          '/api/authz/config-bundles/apply',
          mutationOptions(token, {
            ...exported,
            expectedPreviewHash: exportedPreview.canonicalHash,
            idempotencyKey: `journey-03-reapply-${suffix}`,
            identityReconciliationMode: 'none',
          }),
        ),
        'reapply exported dedicated configuration bundle',
      );
      expect(reapplied).toMatchObject({
        canonicalHash: exportedPreview.canonicalHash,
        created: 0,
        updated: 0,
        archived: 0,
      });
      expect(reapplied.changes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          objectType: 'engine',
          key: engineKey,
          operation: 'noop',
          currentId: expect.any(String),
        }),
      ]));
      engineId = String(
        reapplied.changes.find(
          (change) => change.objectType === 'engine' && change.key === engineKey,
        )!.currentId,
      );

      const removalEnvelope = {
        bundle: envelope.bundle,
        files: {
          './engines.json': { engines: [] },
        },
      };
      const removalPreview = await responseJson<{
        valid: boolean;
        canonicalHash: string;
      }>(
        await page.request.post(
          '/api/authz/config-bundles/preview',
          mutationOptions(token, removalEnvelope),
        ),
        'preview authoritative dedicated engine removal',
      );
      expect(removalPreview).toMatchObject({
        valid: true,
        canonicalHash: expect.any(String),
      });
      const removalDiff = await responseJson<{
        valid: boolean;
        canonicalHash: string;
        changes: Array<Record<string, unknown>>;
        requiredAcknowledgements: string[];
      }>(
        await page.request.post(
          '/api/authz/config-bundles/diff',
          mutationOptions(token, removalEnvelope),
        ),
        'diff authoritative dedicated engine removal',
      );
      expect(removalDiff).toMatchObject({
        valid: true,
        canonicalHash: removalPreview.canonicalHash,
      });
      expect(removalDiff.changes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          objectType: 'engine',
          key: engineKey,
          operation: 'archive',
          currentId: engineId,
        }),
      ]));
      expect(removalDiff.requiredAcknowledgements).toContain(
        `config.authoritative_archive:engine:${engineKey}`,
      );

      const removal = await responseJson<{
        canonicalHash: string;
        created: number;
        updated: number;
        archived: number;
        changes: Array<Record<string, unknown>>;
      }>(
        await page.request.post(
          '/api/authz/config-bundles/apply',
          mutationOptions(token, {
            ...removalEnvelope,
            expectedPreviewHash: removalPreview.canonicalHash,
            acknowledgements: removalDiff.requiredAcknowledgements,
            idempotencyKey: `journey-03-remove-${suffix}`,
            identityReconciliationMode: 'none',
          }),
        ),
        'apply authoritative dedicated engine removal',
      );
      expect(removal).toMatchObject({
        canonicalHash: removalPreview.canonicalHash,
        created: 0,
        updated: 0,
        archived: 1,
      });
      removed = true;

      const afterRemoval = await responseJson<{
        bundle: Record<string, unknown>;
        files: Record<string, unknown>;
      }>(
        await page.request.get(
          `/api/authz/config-bundles/export?bundleKey=${encodeURIComponent(bundleKey)}&tenantKey=default`,
        ),
        'verify removed dedicated engine is absent from config export',
      );
      expect(afterRemoval.files['./engines.json']).toBeUndefined();
      expect(afterRemoval.bundle).toMatchObject({
        metadata: { key: bundleKey },
        imports: [],
      });

      const observationDirectory = path.join(
        process.cwd(),
        'test/results/engine-tenancy-provisioning-observations',
      );
      await mkdir(observationDirectory, { recursive: true });
      await writeFile(
        path.join(observationDirectory, 'journey-03-configuration-bundle.json'),
        `${JSON.stringify({
          schemaVersion: 1,
          journeyId: 3,
          channel: 'configuration-bundle',
          status: 'passed',
          commit,
          sourceState,
          releaseCommitQualified: sourceState === 'clean',
          localhostOnly: true,
          realHttpService: true,
          persistentDatabase: true,
          authorizationEvaluator: true,
          userInterface: false,
          assertions: ['preview', 'apply', 'export', 'reapply', 'remove'],
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
      if (!removed) {
        const removalEnvelope = {
          bundle: envelope.bundle,
          files: {
            './engines.json': { engines: [] },
          },
        };
        const cleanupPreview = await page.request.post(
          '/api/authz/config-bundles/preview',
          mutationOptions(token, removalEnvelope),
        );
        if (cleanupPreview.ok()) {
          const previewBody = await cleanupPreview.json() as { canonicalHash?: string };
          const cleanupDiff = await page.request.post(
            '/api/authz/config-bundles/diff',
            mutationOptions(token, removalEnvelope),
          );
          if (cleanupDiff.ok() && previewBody.canonicalHash) {
            const diffBody = await cleanupDiff.json() as { requiredAcknowledgements?: string[] };
            await page.request.post(
              '/api/authz/config-bundles/apply',
              mutationOptions(token, {
                ...removalEnvelope,
                expectedPreviewHash: previewBody.canonicalHash,
                acknowledgements: diffBody.requiredAcknowledgements || [],
                idempotencyKey: `journey-03-cleanup-${suffix}`,
                identityReconciliationMode: 'none',
              }),
            );
          }
        }
      }
    }
  });

  test('journey 7 manual UI runtime resource tenant resolution', async ({ page }) => {
    const commit = git(['rev-parse', 'HEAD']);
    const sourceState = git(['status', '--porcelain', '--untracked-files=no'])
      ? 'dirty-development-run'
      : 'clean';
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const dedicatedName = `e2e-journey-07-manual-dedicated-${suffix}`;
    const sharedName = `e2e-journey-07-manual-shared-${suffix}`;
    const runtimeBaseUrl = 'http://camunda-mock:9080/e2e-shared-engine-rest';
    const createdEngineIds: string[] = [];

    await login(page);
    const token = await csrfToken(page);
    await page.goto('/t/default/engines');
    await expect(page.getByRole('heading', { name: 'Engines', exact: true })).toBeVisible();
    await expect(page.locator('.cds--skeleton')).toHaveCount(0);

    const createEngineThroughUi = async (
      name: string,
      mode: 'dedicated' | 'shared',
    ): Promise<Record<string, unknown>> => {
      await page.getByRole('button', { name: /Add (?:your first )?engine/ }).click();
      const modal = page.getByRole('dialog', { name: 'Add engine' });
      await expect(modal).toBeVisible();
      await modal.getByLabel('Name', { exact: true }).fill(name);
      await modal.getByLabel('Base URL', { exact: true }).fill(runtimeBaseUrl);
      await modal.locator('#eng-type').click();
      await page.getByRole('option', { name: 'Camunda 7', exact: true }).click();
      if (mode === 'shared') {
        await modal.locator('#eng-tenancy-mode').click();
        await page.getByRole('option', {
          name: 'Shared — mapped runtime resources',
          exact: true,
        }).click();
        await expect(modal.getByText('Shared engines start fail closed')).toBeVisible();
      }
      const deploymentDiscovery = modal.getByRole('switch', {
        name: 'Deployment history discovery',
      });
      await deploymentDiscovery.click({ force: true });
      await expect(deploymentDiscovery).toHaveAttribute('aria-checked', 'false');

      const responsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST'
          && new URL(response.url()).pathname.endsWith('/engines-api/engines'),
      );
      await modal.getByRole('button', { name: 'Create', exact: true }).click();
      const created = await responseJson<Record<string, unknown>>(
        await responsePromise,
        `create ${mode} runtime-resolution engine through UI`,
      );
      createdEngineIds.push(String(created.id));
      await expect(page.getByText('Engine created', { exact: true })).toBeVisible();
      await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
      return created;
    };

    try {
      const dedicated = await createEngineThroughUi(dedicatedName, 'dedicated');
      expect(dedicated).toMatchObject({
        tenancyMode: 'dedicated',
        tenantId: 'tenant-default',
        tenantResolutionStatus: 'ready',
        runtimeAccessScope: 'engine_wide',
      });
      const dedicatedEngineId = String(dedicated.id);
      await responseJson(
        await page.request.post(
          `/engines-api/engines/${encodeURIComponent(dedicatedEngineId)}/runtime-resources/reconcile`,
          mutationOptions(token),
        ),
        'reconcile dedicated runtime inventory',
      );
      const dedicatedResources = await responseJson<Array<Record<string, unknown>>>(
        await page.request.get(
          `/engines-api/engines/${encodeURIComponent(dedicatedEngineId)}/runtime-resources`,
        ),
        'read dedicated inherited runtime inventory',
      );
      expect(dedicatedResources.length).toBeGreaterThan(0);
      expect(new Set(dedicatedResources.map((resource) => resource.tenantId))).toEqual(
        new Set(['tenant-default']),
      );
      expect(new Set(dedicatedResources.map((resource) => resource.tenantResolutionStatus))).toEqual(
        new Set(['resolved']),
      );

      const shared = await createEngineThroughUi(sharedName, 'shared');
      expect(shared).toMatchObject({
        tenancyMode: 'shared',
        tenantId: null,
        tenantMappingStrategy: 'engine_tenant_id',
        tenantResolutionStatus: 'incomplete',
        runtimeAccessScope: 'resource_aware',
      });
      const sharedEngineId = String(shared.id);
      await responseJson(
        await page.request.post(
          `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/runtime-resources/reconcile`,
          mutationOptions(token),
        ),
        'reconcile unmapped shared runtime inventory',
      );
      const unmappedDiagnostics = await responseJson<Record<string, unknown>>(
        await page.request.get(
          `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/tenancy/diagnostics`,
        ),
        'inspect unmapped shared runtime inventory',
      );
      expect(unmappedDiagnostics).toMatchObject({
        mode: 'shared',
        resolutionStatus: 'incomplete',
        mappedResourceCount: 0,
        conflictingResourceCount: 0,
      });
      expect(Number(unmappedDiagnostics.unmappedResourceCount)).toBeGreaterThan(0);
      let expectedMappingVersion = Number(unmappedDiagnostics.mappingVersion);
      expect(Number.isSafeInteger(expectedMappingVersion)).toBe(true);
      expect(expectedMappingVersion).toBeGreaterThanOrEqual(0);
      expect(
        await responseJson<unknown[]>(
          await page.request.get(
            `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/runtime-resources`,
          ),
          'verify unmapped shared inventory is quarantined',
        ),
      ).toEqual([]);

      const sharedRow = page.getByRole('row').filter({ hasText: sharedName });
      await sharedRow.getByRole('button', { name: 'Options' }).click();
      await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
      const editModal = page.getByRole('dialog', { name: 'Edit engine' });
      await expect(editModal.getByRole('heading', { name: 'Tenancy and tenant mappings' })).toBeVisible();
      await expect(editModal.getByText('No tenant mappings')).toBeVisible();

      const applyMappingThroughUi = async (
        runtimeTenantId: string,
      ): Promise<void> => {
        await editModal.getByLabel('External tenant ID').fill(runtimeTenantId);
        await editModal.getByLabel('Source reference').fill(
          `manual:journey-07:${runtimeTenantId}:${suffix}`,
        );
        await editModal.getByRole('button', { name: 'Preview mapping change' }).click();
        await expect(
          editModal.getByText(`Mapping preview at version ${expectedMappingVersion + 1}`),
        ).toBeVisible();
        await editModal.getByRole('button', { name: 'Apply mapping change' }).click();
        await expect(page.getByText('Tenant mapping applied', { exact: true })).toBeVisible();
        await expect(
          editModal.getByRole('row').filter({ hasText: runtimeTenantId }),
        ).toBeVisible();
        await expect.poll(async () => {
          const response = await page.request.get(
            `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/tenancy/diagnostics`,
          );
          if (!response.ok()) return -1;
          return Number((await response.json()).mappingVersion);
        }).toBe(expectedMappingVersion + 1);
        expectedMappingVersion += 1;
      };

      await applyMappingThroughUi('e2e-runtime-blue');
      await applyMappingThroughUi('e2e-runtime-green');

      await responseJson(
        await page.request.post(
          `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/runtime-resources/reconcile`,
          mutationOptions(token),
        ),
        'reconcile explicitly mapped shared runtime inventory',
      );
      const mappedDiagnostics = await responseJson<Record<string, unknown>>(
        await page.request.get(
          `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/tenancy/diagnostics`,
        ),
        'inspect explicitly mapped shared runtime inventory',
      );
      expect(mappedDiagnostics).toMatchObject({
        mode: 'shared',
        mappingVersion: expectedMappingVersion,
        resolutionStatus: 'ready',
        unmappedResourceCount: 0,
        conflictingResourceCount: 0,
      });
      expect(Number(mappedDiagnostics.mappedResourceCount)).toBeGreaterThan(0);

      const mappedResources = await responseJson<Array<Record<string, unknown>>>(
        await page.request.get(
          `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/runtime-resources`,
        ),
        'read explicitly mapped shared runtime inventory',
      );
      const blueResourceIds = new Set(
        mappedResources
          .filter((resource) => resource.runtimeTenantId === 'e2e-runtime-blue')
          .map((resource) => String(resource.id)),
      );
      const greenResourceIds = new Set(
        mappedResources
          .filter((resource) => resource.runtimeTenantId === 'e2e-runtime-green')
          .map((resource) => String(resource.id)),
      );
      expect(blueResourceIds.size).toBeGreaterThan(0);
      expect(greenResourceIds.size).toBeGreaterThan(0);
      expect([...blueResourceIds].filter((id) => greenResourceIds.has(id))).toEqual([]);
      expect(new Set(mappedResources.map((resource) => resource.tenantId))).toEqual(
        new Set(['tenant-default']),
      );
      expect(new Set(mappedResources.map((resource) => resource.tenantResolutionStatus))).toEqual(
        new Set(['resolved']),
      );

      const observationDirectory = path.join(
        process.cwd(),
        'test/results/engine-tenancy-provisioning-observations',
      );
      await mkdir(observationDirectory, { recursive: true });
      await writeFile(
        path.join(observationDirectory, 'journey-07-manual-ui.json'),
        `${JSON.stringify({
          schemaVersion: 1,
          journeyId: 7,
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
          assertions: [
            'dedicated-inheritance',
            'shared-explicit-resolution',
            'unmapped-quarantine',
          ],
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

  test('journey 7 external API runtime resource tenant resolution', async ({ page }) => {
    const commit = git(['rev-parse', 'HEAD']);
    const sourceState = git(['status', '--porcelain', '--untracked-files=no'])
      ? 'dirty-development-run'
      : 'clean';
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const dedicatedExternalId = `e2e-j07-dedicated-${suffix}`;
    const sharedExternalId = `e2e-j07-shared-${suffix}`;
    const runtimeBaseUrl = 'http://camunda-mock.example.test:9080/e2e-shared-engine-rest';
    const externalIds: string[] = [];
    let apiClientId: string | null = null;
    let assignmentId: string | null = null;
    let externalApi: APIRequestContext | null = null;

    await login(page);
    const token = await csrfToken(page);

    try {
      const apiClientResult = await responseJson<{
        client: { id: string };
        token: string;
      }>(
        await page.request.post('/api/authz/api-clients', mutationOptions(token, {
          name: `e2e-journey-07-client-${suffix}`,
          scopes: ['engine:register'],
        })),
        'create journey 7 external-registration API client',
      );
      apiClientId = apiClientResult.client.id;
      const assignment = await responseJson<{ id: string }>(
        await page.request.post('/api/authz/role-assignments', mutationOptions(token, {
          principalType: 'api_client',
          principalId: apiClientId,
          roleId: 'system.api.engine_registrar',
          resourceType: 'platform',
          resourceId: null,
        })),
        'grant journey 7 external-registration role',
      );
      assignmentId = assignment.id;
      externalApi = await playwrightRequest.newContext({
        baseURL: apiUrl,
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: {
          Authorization: `Bearer ${apiClientResult.token}`,
          'Content-Type': 'application/json',
        },
      });

      const register = async (
        externalId: string,
        mode: 'dedicated' | 'shared',
      ): Promise<Record<string, unknown>> => {
        const response = await externalApi!.post('/engines-api/external/engines', {
          data: {
            name: `e2e-journey-07-external-${mode}-${suffix}`,
            baseUrl: runtimeBaseUrl,
            externalId,
            type: 'camunda7',
            connectionMode: 'direct',
            runtimeAccessScope: mode === 'dedicated' ? 'engine_wide' : 'resource_aware',
            metadataDiscoveryEnabled: true,
            deploymentDiscoveryEnabled: false,
            pipelineReceiptEnabled: false,
            tenancy: mode === 'dedicated'
              ? { mode: 'dedicated', tenantRef: { type: 'default' } }
              : {
                mode: 'shared',
                mappingStrategy: 'engine_tenant_id',
                unmappedPolicy: 'deny',
              },
          },
        });
        expect(response.status()).toBe(201);
        const result = await responseJson<{
          created: boolean;
          engine: Record<string, unknown>;
        }>(response, `externally create ${mode} journey 7 engine`);
        expect(result.created).toBe(true);
        externalIds.push(externalId);
        return result.engine;
      };

      const dedicated = await register(dedicatedExternalId, 'dedicated');
      expect(dedicated).toMatchObject({
        tenancyMode: 'dedicated',
        tenantId: 'tenant-default',
        tenantResolutionStatus: 'ready',
        runtimeAccessScope: 'engine_wide',
      });
      const dedicatedEngineId = String(dedicated.id);
      await responseJson(
        await page.request.post(
          `/engines-api/engines/${encodeURIComponent(dedicatedEngineId)}/runtime-resources/reconcile`,
          mutationOptions(token),
        ),
        'reconcile externally provisioned dedicated inventory',
      );
      const dedicatedResources = await responseJson<Array<Record<string, unknown>>>(
        await page.request.get(
          `/engines-api/engines/${encodeURIComponent(dedicatedEngineId)}/runtime-resources`,
        ),
        'read externally provisioned dedicated inventory',
      );
      expect(dedicatedResources.length).toBeGreaterThan(0);
      expect(new Set(dedicatedResources.map((resource) => resource.tenantId))).toEqual(
        new Set(['tenant-default']),
      );
      expect(new Set(dedicatedResources.map((resource) => resource.tenantResolutionStatus))).toEqual(
        new Set(['resolved']),
      );

      const shared = await register(sharedExternalId, 'shared');
      expect(shared).toMatchObject({
        tenancyMode: 'shared',
        tenantId: null,
        tenantMappingStrategy: 'engine_tenant_id',
        tenantResolutionStatus: 'incomplete',
        runtimeAccessScope: 'resource_aware',
      });
      const sharedEngineId = String(shared.id);
      await responseJson(
        await page.request.post(
          `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/runtime-resources/reconcile`,
          mutationOptions(token),
        ),
        'reconcile externally provisioned unmapped shared inventory',
      );
      const unmappedDiagnostics = await responseJson<Record<string, unknown>>(
        await page.request.get(
          `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/tenancy/diagnostics`,
        ),
        'inspect externally provisioned unmapped shared inventory',
      );
      expect(unmappedDiagnostics).toMatchObject({
        mode: 'shared',
        resolutionStatus: 'incomplete',
        mappedResourceCount: 0,
        conflictingResourceCount: 0,
      });
      expect(Number(unmappedDiagnostics.unmappedResourceCount)).toBeGreaterThan(0);
      expect(
        await responseJson<unknown[]>(
          await page.request.get(
            `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/runtime-resources`,
          ),
          'verify externally provisioned unmapped inventory is quarantined',
        ),
      ).toEqual([]);

      const expectedMappingVersion = Number(unmappedDiagnostics.mappingVersion);
      expect(Number.isSafeInteger(expectedMappingVersion)).toBe(true);
      const mappingRequest = {
        expectedMappingVersion,
        atomic: true,
        mappings: ['e2e-runtime-blue', 'e2e-runtime-green'].map((runtimeTenantId) => ({
          externalTenantId: runtimeTenantId,
          tenantRef: { type: 'default' },
          strategy: 'engine_tenant_id',
          sourceRef: `external:journey-07:${runtimeTenantId}:${suffix}`,
          active: true,
        })),
      };
      const mappingPath = `/engines-api/external/engines/${
        encodeURIComponent(sharedExternalId)
      }/tenant-mappings`;
      const mappingPreview = await responseJson<{
        dryRun: boolean;
        mappingVersion: number;
        created: number;
      }>(
        await externalApi.put(mappingPath, {
          data: { ...mappingRequest, dryRun: true },
        }),
        'preview external shared tenant mappings',
      );
      expect(mappingPreview).toMatchObject({
        dryRun: true,
        mappingVersion: expectedMappingVersion + 1,
        created: 2,
      });
      const mappingApply = await responseJson<{
        dryRun: boolean;
        mappingVersion: number;
        created: number;
      }>(
        await externalApi.put(mappingPath, {
          data: { ...mappingRequest, dryRun: false },
        }),
        'apply external shared tenant mappings',
      );
      expect(mappingApply).toMatchObject({
        dryRun: false,
        mappingVersion: expectedMappingVersion + 1,
        created: 2,
      });

      await responseJson(
        await page.request.post(
          `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/runtime-resources/reconcile`,
          mutationOptions(token),
        ),
        'reconcile externally mapped shared inventory',
      );
      const mappedDiagnostics = await responseJson<Record<string, unknown>>(
        await page.request.get(
          `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/tenancy/diagnostics`,
        ),
        'inspect externally mapped shared inventory',
      );
      expect(mappedDiagnostics).toMatchObject({
        mode: 'shared',
        mappingVersion: expectedMappingVersion + 1,
        resolutionStatus: 'ready',
        unmappedResourceCount: 0,
        conflictingResourceCount: 0,
      });
      const mappedResources = await responseJson<Array<Record<string, unknown>>>(
        await page.request.get(
          `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/runtime-resources`,
        ),
        'read externally mapped shared inventory',
      );
      expect(
        mappedResources.some((resource) => resource.runtimeTenantId === 'e2e-runtime-blue'),
      ).toBe(true);
      expect(
        mappedResources.some((resource) => resource.runtimeTenantId === 'e2e-runtime-green'),
      ).toBe(true);
      expect(new Set(mappedResources.map((resource) => resource.tenantId))).toEqual(
        new Set(['tenant-default']),
      );
      expect(new Set(mappedResources.map((resource) => resource.tenantResolutionStatus))).toEqual(
        new Set(['resolved']),
      );

      const observationDirectory = path.join(
        process.cwd(),
        'test/results/engine-tenancy-provisioning-observations',
      );
      await mkdir(observationDirectory, { recursive: true });
      await writeFile(
        path.join(observationDirectory, 'journey-07-external-api.json'),
        `${JSON.stringify({
          schemaVersion: 1,
          journeyId: 7,
          channel: 'external-api',
          status: 'passed',
          commit,
          sourceState,
          releaseCommitQualified: sourceState === 'clean',
          localhostOnly: true,
          realHttpService: true,
          persistentDatabase: true,
          authorizationEvaluator: true,
          userInterface: false,
          assertions: [
            'dedicated-inheritance',
            'shared-explicit-resolution',
            'unmapped-quarantine',
          ],
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
      if (externalApi) {
        for (const externalId of externalIds.reverse()) {
          const response = await externalApi.post('/engines-api/external/engines/decommission', {
            data: {
              externalId,
              reason: 'Disposable journey 7 external channel completed',
            },
          });
          expect([200, 404]).toContain(response.status());
        }
      }
      await externalApi?.dispose();
      if (assignmentId) {
        const response = await page.request.delete(
          `/api/authz/role-assignments/${encodeURIComponent(assignmentId)}`,
          mutationOptions(token),
        );
        expect([204, 404]).toContain(response.status());
      }
      if (apiClientId) {
        const response = await page.request.delete(
          `/api/authz/api-clients/${encodeURIComponent(apiClientId)}`,
          mutationOptions(token),
        );
        expect([204, 404]).toContain(response.status());
      }
    }
  });

  test('journey 7 configuration bundle runtime resource tenant resolution', async ({ page }) => {
    const commit = git(['rev-parse', 'HEAD']);
    const sourceState = git(['status', '--porcelain', '--untracked-files=no'])
      ? 'dirty-development-run'
      : 'clean';
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const bundleKey = `e2e.journey07.${suffix}`;
    const dedicatedKey = `engine.journey07.dedicated.${suffix}`;
    const sharedKey = `engine.journey07.shared.${suffix}`;
    const runtimeBaseUrl = 'http://camunda-mock:9080/e2e-shared-engine-rest';
    let removed = false;
    let accessRoleId: string | null = null;
    const accessAssignmentSourceRef = `e2e-journey-07-config-access:${suffix}`;
    const database = new Pool({
      host: process.env.POSTGRES_HOST,
      port: process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : 5432,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DATABASE,
      ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });
    const schema = process.env.POSTGRES_SCHEMA || 'main';

    await login(page);
    const token = await csrfToken(page);
    const currentUser = await responseJson<{ id: string }>(
      await page.request.get('/api/auth/me'),
      'resolve journey 7 configuration test principal',
    );
    const bundle = {
      apiVersion: 'enterpriseglue.ai/v1alpha1',
      kind: 'EnterpriseGlueConfigBundle',
      metadata: {
        key: bundleKey,
        owner: 'e2e',
      },
      tenantKey: 'default',
      mode: 'authoritative',
      settings: {},
      imports: ['./engines.json'],
    };
    const enginesFile = {
      engines: [
        {
          key: dedicatedKey,
          name: `e2e-journey-07-config-dedicated-${suffix}`,
          type: 'camunda7',
          baseUrl: runtimeBaseUrl,
          auth: {
            type: 'basic',
            username: 'e2e',
            passwordRef: 'E2E_ENGINE_PASSWORD',
          },
          connectionMode: 'direct',
          runtimeAccessScope: 'engine_wide',
          tenancy: {
            mode: 'dedicated',
            tenantRef: { type: 'default' },
          },
          metadataDiscoveryEnabled: true,
          deploymentDiscoveryEnabled: false,
          pipelineReceiptEnabled: false,
          ownershipMode: 'config_locked',
        },
        {
          key: sharedKey,
          name: `e2e-journey-07-config-shared-${suffix}`,
          type: 'camunda7',
          baseUrl: runtimeBaseUrl,
          auth: {
            type: 'basic',
            username: 'e2e',
            passwordRef: 'E2E_ENGINE_PASSWORD',
          },
          connectionMode: 'direct',
          runtimeAccessScope: 'resource_aware',
          tenancy: {
            mode: 'shared',
            mappingStrategy: 'engine_tenant_id',
          },
          metadataDiscoveryEnabled: true,
          deploymentDiscoveryEnabled: false,
          pipelineReceiptEnabled: false,
          ownershipMode: 'config_locked',
        },
      ],
    };
    const initialEnvelope = {
      bundle,
      files: {
        './engines.json': enginesFile,
      },
    };
    const mappingKeys = {
      blue: `engine-tenant-mapping.journey07.blue.${suffix}`,
      green: `engine-tenant-mapping.journey07.green.${suffix}`,
    };
    const mappedEnvelope = {
      bundle: {
        ...bundle,
        imports: [
          './engines.json',
          './engine-tenant-mappings.json',
        ],
      },
      files: {
        './engines.json': enginesFile,
        './engine-tenant-mappings.json': {
          engineTenantMappings: [
            {
              key: mappingKeys.blue,
              engineRef: { engineKey: sharedKey },
              externalTenantId: 'e2e-runtime-blue',
              tenantRef: { type: 'default' },
              strategy: 'engine_tenant_id',
              active: true,
              ownershipMode: 'config_locked',
            },
            {
              key: mappingKeys.green,
              engineRef: { engineKey: sharedKey },
              externalTenantId: 'e2e-runtime-green',
              tenantRef: { type: 'default' },
              strategy: 'engine_tenant_id',
              active: true,
              ownershipMode: 'config_locked',
            },
          ],
        },
      },
    };

    const applyBundle = async (
      envelope: Record<string, unknown>,
      idempotencyKey: string,
      operation: string,
    ): Promise<{
      canonicalHash: string;
      created: number;
      updated: number;
      archived: number;
      changes: Array<Record<string, unknown>>;
    }> => {
      const preview = await responseJson<{
        valid: boolean;
        canonicalHash: string;
        errors: unknown[];
      }>(
        await page.request.post(
          '/api/authz/config-bundles/preview',
          mutationOptions(token, envelope),
        ),
        `preview ${operation}`,
      );
      expect(preview).toMatchObject({
        valid: true,
        canonicalHash: expect.any(String),
        errors: [],
      });
      const diff = await responseJson<{
        valid: boolean;
        canonicalHash: string;
        requiredAcknowledgements: string[];
      }>(
        await page.request.post(
          '/api/authz/config-bundles/diff',
          mutationOptions(token, envelope),
        ),
        `diff ${operation}`,
      );
      expect(diff).toMatchObject({
        valid: true,
        canonicalHash: preview.canonicalHash,
      });
      return responseJson(
        await page.request.post(
          '/api/authz/config-bundles/apply',
          mutationOptions(token, {
            ...envelope,
            expectedPreviewHash: preview.canonicalHash,
            acknowledgements: diff.requiredAcknowledgements,
            idempotencyKey,
            identityReconciliationMode: 'none',
          }),
        ),
        `apply ${operation}`,
      );
    };

    try {
      const accessRole = await responseJson<{ id: string }>(
        await page.request.post('/api/authz/roles', mutationOptions(token, {
          name: 'Journey config inspector',
          description: 'Disposable role for real-service configuration channel evidence.',
          scope: 'engine',
          permissionIds: ['engine:edit', 'engine:instance:view'],
        })),
        'create journey 7 configuration inspection role',
      );
      accessRoleId = accessRole.id;

      const initialApply = await applyBundle(
        initialEnvelope,
        `journey-07-config-engines-${suffix}`,
        'journey 7 engine configuration',
      );
      expect(initialApply).toMatchObject({
        created: 2,
        updated: 0,
        archived: 0,
      });

      const stableApply = await applyBundle(
        initialEnvelope,
        `journey-07-config-engines-reapply-${suffix}`,
        'journey 7 idempotent engine configuration',
      );
      expect(stableApply).toMatchObject({
        created: 0,
        updated: 0,
        archived: 0,
      });
      const dedicatedEngineId = String(stableApply.changes.find(
        (change) => change.objectType === 'engine' && change.key === dedicatedKey,
      )?.currentId);
      const sharedEngineId = String(stableApply.changes.find(
        (change) => change.objectType === 'engine' && change.key === sharedKey,
      )?.currentId);
      expect(dedicatedEngineId).not.toBe('undefined');
      expect(sharedEngineId).not.toBe('undefined');

      for (const engineId of [dedicatedEngineId, sharedEngineId]) {
        const now = Date.now();
        const assignmentKey = canonicalRoleAssignmentKey({
          tenantId: 'tenant-default',
          principalType: 'user',
          principalId: currentUser.id,
          roleId: accessRoleId,
          scopeType: 'engine',
          scopeId: engineId,
          source: 'system',
          sourceRef: accessAssignmentSourceRef,
        });
        await database.query(
          `INSERT INTO ${schema}.role_assignments
            (id, tenant_id, principal_type, principal_id, assignment_key, role_id,
             scope_type, scope_id, source, source_ref, ownership_mode, source_hash,
             last_applied_at, drift_status, expires_at, last_seen_at, created_by_id,
             created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
          [
            randomUUID(), 'tenant-default', 'user', currentUser.id, assignmentKey,
            accessRoleId, 'engine', engineId, 'system', accessAssignmentSourceRef,
            'manual', null, null, null, null, null, currentUser.id, now, now,
          ],
        );
      }

      const dedicated = await responseJson<Record<string, unknown>>(
        await page.request.get(
          `/engines-api/engines/${encodeURIComponent(dedicatedEngineId)}`,
        ),
        'inspect configuration-provisioned dedicated engine',
      );
      const shared = await responseJson<Record<string, unknown>>(
        await page.request.get(
          `/engines-api/engines/${encodeURIComponent(sharedEngineId)}`,
        ),
        'inspect configuration-provisioned shared engine',
      );
      expect(dedicated).toMatchObject({
        configKey: dedicatedKey,
        tenancyMode: 'dedicated',
        tenantId: 'tenant-default',
        tenantResolutionStatus: 'ready',
        runtimeAccessScope: 'engine_wide',
      });
      expect(shared).toMatchObject({
        configKey: sharedKey,
        tenancyMode: 'shared',
        tenantId: null,
        tenantMappingStrategy: 'engine_tenant_id',
        tenantResolutionStatus: 'incomplete',
        runtimeAccessScope: 'resource_aware',
      });

      await responseJson(
        await page.request.post(
          `/engines-api/engines/${encodeURIComponent(dedicatedEngineId)}/runtime-resources/reconcile`,
          mutationOptions(token),
        ),
        'reconcile configuration-provisioned dedicated inventory',
      );
      const dedicatedResources = await responseJson<Array<Record<string, unknown>>>(
        await page.request.get(
          `/engines-api/engines/${encodeURIComponent(dedicatedEngineId)}/runtime-resources`,
        ),
        'read configuration-provisioned dedicated inventory',
      );
      expect(dedicatedResources.length).toBeGreaterThan(0);
      expect(new Set(dedicatedResources.map((resource) => resource.tenantId))).toEqual(
        new Set(['tenant-default']),
      );
      expect(new Set(dedicatedResources.map((resource) => resource.tenantResolutionStatus))).toEqual(
        new Set(['resolved']),
      );

      await responseJson(
        await page.request.post(
          `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/runtime-resources/reconcile`,
          mutationOptions(token),
        ),
        'reconcile configuration-provisioned unmapped shared inventory',
      );
      const unmappedDiagnostics = await responseJson<Record<string, unknown>>(
        await page.request.get(
          `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/tenancy/diagnostics`,
        ),
        'inspect configuration-provisioned unmapped shared inventory',
      );
      expect(unmappedDiagnostics).toMatchObject({
        mode: 'shared',
        resolutionStatus: 'incomplete',
        mappedResourceCount: 0,
        conflictingResourceCount: 0,
      });
      expect(Number(unmappedDiagnostics.unmappedResourceCount)).toBeGreaterThan(0);
      expect(
        await responseJson<unknown[]>(
          await page.request.get(
            `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/runtime-resources`,
          ),
          'verify configuration-provisioned unmapped inventory is quarantined',
        ),
      ).toEqual([]);

      const mappingApply = await applyBundle(
        mappedEnvelope,
        `journey-07-config-mappings-${suffix}`,
        'journey 7 shared mapping configuration',
      );
      expect(mappingApply).toMatchObject({
        created: 2,
        updated: 0,
        archived: 0,
      });
      expect(mappingApply.changes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          objectType: 'engine_tenant_mapping',
          key: mappingKeys.blue,
          operation: 'create',
        }),
        expect.objectContaining({
          objectType: 'engine_tenant_mapping',
          key: mappingKeys.green,
          operation: 'create',
        }),
      ]));

      await responseJson(
        await page.request.post(
          `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/runtime-resources/reconcile`,
          mutationOptions(token),
        ),
        'reconcile configuration-mapped shared inventory',
      );
      const mappedDiagnostics = await responseJson<Record<string, unknown>>(
        await page.request.get(
          `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/tenancy/diagnostics`,
        ),
        'inspect configuration-mapped shared inventory',
      );
      expect(mappedDiagnostics).toMatchObject({
        mode: 'shared',
        resolutionStatus: 'ready',
        unmappedResourceCount: 0,
        conflictingResourceCount: 0,
      });
      expect(Number(mappedDiagnostics.mappedResourceCount)).toBeGreaterThan(0);
      const mappedResources = await responseJson<Array<Record<string, unknown>>>(
        await page.request.get(
          `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/runtime-resources`,
        ),
        'read configuration-mapped shared inventory',
      );
      expect(
        mappedResources.some((resource) => resource.runtimeTenantId === 'e2e-runtime-blue'),
      ).toBe(true);
      expect(
        mappedResources.some((resource) => resource.runtimeTenantId === 'e2e-runtime-green'),
      ).toBe(true);
      expect(new Set(mappedResources.map((resource) => resource.tenantId))).toEqual(
        new Set(['tenant-default']),
      );
      expect(new Set(mappedResources.map((resource) => resource.tenantResolutionStatus))).toEqual(
        new Set(['resolved']),
      );

      const removalEnvelope = {
        bundle: mappedEnvelope.bundle,
        files: {
          './engines.json': { engines: [] },
          './engine-tenant-mappings.json': { engineTenantMappings: [] },
        },
      };
      const removal = await applyBundle(
        removalEnvelope,
        `journey-07-config-remove-${suffix}`,
        'journey 7 authoritative configuration removal',
      );
      expect(removal).toMatchObject({
        created: 0,
        updated: 0,
        archived: 4,
      });
      removed = true;

      const observationDirectory = path.join(
        process.cwd(),
        'test/results/engine-tenancy-provisioning-observations',
      );
      await mkdir(observationDirectory, { recursive: true });
      await writeFile(
        path.join(observationDirectory, 'journey-07-configuration-bundle.json'),
        `${JSON.stringify({
          schemaVersion: 1,
          journeyId: 7,
          channel: 'configuration-bundle',
          status: 'passed',
          commit,
          sourceState,
          releaseCommitQualified: sourceState === 'clean',
          localhostOnly: true,
          realHttpService: true,
          persistentDatabase: true,
          authorizationEvaluator: true,
          userInterface: false,
          assertions: [
            'dedicated-inheritance',
            'shared-explicit-resolution',
            'unmapped-quarantine',
          ],
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
      if (!removed) {
        const cleanupEnvelope = {
          bundle: mappedEnvelope.bundle,
          files: {
            './engines.json': { engines: [] },
            './engine-tenant-mappings.json': { engineTenantMappings: [] },
          },
        };
        const cleanupPreview = await page.request.post(
          '/api/authz/config-bundles/preview',
          mutationOptions(token, cleanupEnvelope),
        );
        if (cleanupPreview.ok()) {
          const previewBody = await cleanupPreview.json() as { canonicalHash?: string };
          const cleanupDiff = await page.request.post(
            '/api/authz/config-bundles/diff',
            mutationOptions(token, cleanupEnvelope),
          );
          if (cleanupDiff.ok() && previewBody.canonicalHash) {
            const diffBody = await cleanupDiff.json() as {
              requiredAcknowledgements?: string[];
            };
            await page.request.post(
              '/api/authz/config-bundles/apply',
              mutationOptions(token, {
                ...cleanupEnvelope,
                expectedPreviewHash: previewBody.canonicalHash,
                acknowledgements: diffBody.requiredAcknowledgements || [],
                idempotencyKey: `journey-07-config-cleanup-${suffix}`,
                identityReconciliationMode: 'none',
              }),
            );
          }
        }
      }
      await database.query(
        `DELETE FROM ${schema}.role_assignments WHERE source = $1 AND source_ref = $2`,
        ['system', accessAssignmentSourceRef],
      );
      if (accessRoleId) {
        const response = await page.request.delete(
          `/api/authz/roles/${encodeURIComponent(accessRoleId)}`,
          mutationOptions(token),
        );
        expect([204, 404]).toContain(response.status());
      }
      await database.end();
    }
  });
});
