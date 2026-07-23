import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { canonicalRoleAssignmentKey } from '../../packages/shared/src/authz/role-assignment-identity';
import {
  getE2ECredentials,
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
const apiUrl = process.env.ENGINE_TENANCY_API_URL || 'http://localhost:8787';
const mockCamundaControlUrl = process.env.CAMUNDA_MOCK_CONTROL_URL || 'http://localhost:59080';
const enabled = process.env.ENGINE_TENANCY_PROVISIONING_EVIDENCE === 'true'
  && isLocalUrl(baseUrl)
  && isLocalUrl(apiUrl)
  && isLocalUrl(mockCamundaControlUrl)
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

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login?local=1');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
}

async function login(page: Page): Promise<void> {
  const { email, password } = getE2ECredentials();
  if (!email || !password) throw new Error('Disposable local test credentials are unavailable');
  await loginAs(page, email, password);
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

type ProvisioningJourneyChannel =
  | 'manual-ui'
  | 'external-api'
  | 'configuration-bundle';

async function proveTopologyTransitionAndRollback(input: {
  page: Page;
  csrf: string;
  engineId: string;
  channel: ProvisioningJourneyChannel;
  suffix: string;
  commit: string;
  sourceState: string;
}): Promise<void> {
  const {
    page,
    csrf,
    engineId,
    channel,
    suffix,
    commit,
    sourceState,
  } = input;
  const fixture = getE2EFineGrainedFixture();
  expect(fixture.scopedUserId, 'Journey 12 requires the seeded direct user').toBeTruthy();
  let assignmentId: string | null = null;
  let restrictedContext: BrowserContext | null = null;

  const transitionPath =
    `/engines-api/engines/${encodeURIComponent(engineId)}/tenancy`;
  const sharedTenancy = {
    mode: 'shared',
    mappingStrategy: 'engine_tenant_id',
    unmappedPolicy: 'deny',
  };
  const dedicatedTenancy = {
    mode: 'dedicated',
    tenantRef: { type: 'default' },
  };

  try {
    const assignment = await responseJson<{ id: string }>(
      await page.request.post('/api/authz/role-assignments', mutationOptions(csrf, {
        principalType: 'user',
        principalId: fixture.scopedUserId,
        roleId: 'system.engine.operator',
        resourceType: 'engine',
        resourceId: engineId,
      })),
      `assign Journey 12 ${channel} dedicated engine role`,
    );
    assignmentId = assignment.id;

    const browser = page.context().browser();
    if (!browser) throw new Error('Journey 12 requires a browser-backed Playwright page');
    restrictedContext = await browser.newContext({
      baseURL: baseUrl,
      ignoreHTTPSErrors: true,
    });
    const restrictedPage = await restrictedContext.newPage();
    await loginAs(restrictedPage, fixture.email!, fixture.password!);
    const definitionsPath =
      `/mission-control-api/process-definitions?engineId=${encodeURIComponent(engineId)}`;
    const browserDefinitions = async (): Promise<{
      status: number;
      keys: string[];
    }> => restrictedPage.evaluate(async (url) => {
      const response = await fetch(url, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const body = await response.json().catch(() => []);
      return {
        status: response.status,
        keys: Array.isArray(body)
          ? body.map((definition: { key?: unknown }) => String(definition.key)).sort()
          : [],
      };
    }, definitionsPath);

    const beforeTransition = await browserDefinitions();
    expect(beforeTransition.status).toBe(200);
    expect(beforeTransition.keys).toContain('invoice-process');

    const preview = await responseJson<{
      previewHash: string;
      previewExpiresAt: number;
      requiredAcknowledgements: string[];
      kind: string;
    }>(
      await page.request.post(
        `${transitionPath}/preview`,
        mutationOptions(csrf, { tenancy: sharedTenancy }),
      ),
      `preview Journey 12 ${channel} dedicated-to-shared transition`,
    );
    expect(preview).toMatchObject({
      previewHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      previewExpiresAt: expect.any(Number),
      kind: 'dedicated_to_shared',
    });
    expect(preview.requiredAcknowledgements.length).toBeGreaterThan(0);

    const missingAcknowledgement = await page.request.post(
      `${transitionPath}/apply`,
      mutationOptions(csrf, {
        tenancy: sharedTenancy,
        previewHash: preview.previewHash,
        previewExpiresAt: preview.previewExpiresAt,
        acknowledgements: [],
      }),
    );
    expect(missingAcknowledgement.status()).toBe(400);
    expect(await missingAcknowledgement.json()).toEqual(expect.objectContaining({
      code: 'ENGINE_TENANCY_ACKNOWLEDGEMENT_REQUIRED',
    }));

    const engineBeforeConflict = await responseJson<Record<string, unknown>>(
      await page.request.get(`/engines-api/engines/${encodeURIComponent(engineId)}`),
      `read Journey 12 ${channel} engine before concurrency conflict`,
    );
    const conflictUpdate = await page.request.put(
      `/engines-api/engines/${encodeURIComponent(engineId)}`,
      mutationOptions(csrf, {
        name: `${String(engineBeforeConflict.name)} j12-${suffix}`,
      }),
    );
    expect(conflictUpdate.status()).toBe(200);

    const staleApply = await page.request.post(
      `${transitionPath}/apply`,
      mutationOptions(csrf, {
        tenancy: sharedTenancy,
        previewHash: preview.previewHash,
        previewExpiresAt: preview.previewExpiresAt,
        acknowledgements: preview.requiredAcknowledgements,
      }),
    );
    expect(staleApply.status()).toBe(409);
    expect(await staleApply.json()).toEqual(expect.objectContaining({
      code: 'ENGINE_TENANCY_PREVIEW_STALE',
    }));

    const currentPreview = await responseJson<{
      previewHash: string;
      previewExpiresAt: number;
      requiredAcknowledgements: string[];
    }>(
      await page.request.post(
        `${transitionPath}/preview`,
        mutationOptions(csrf, { tenancy: sharedTenancy }),
      ),
      `refresh Journey 12 ${channel} dedicated-to-shared preview`,
    );
    const applied = await responseJson<{
      applied: boolean;
      transition: {
        proposed: Record<string, unknown>;
      };
    }>(
      await page.request.post(
        `${transitionPath}/apply`,
        mutationOptions(csrf, {
          tenancy: sharedTenancy,
          previewHash: currentPreview.previewHash,
          previewExpiresAt: currentPreview.previewExpiresAt,
          acknowledgements: currentPreview.requiredAcknowledgements,
        }),
      ),
      `apply Journey 12 ${channel} dedicated-to-shared transition`,
    );
    expect(applied).toMatchObject({
      applied: true,
      transition: {
        proposed: {
          mode: 'shared',
          tenantId: null,
          runtimeAccessScope: 'resource_aware',
          resolutionStatus: 'incomplete',
        },
      },
    });
    expect(await browserDefinitions()).toEqual({ status: 403, keys: [] });

    const rollbackPreview = await responseJson<{
      previewHash: string;
      previewExpiresAt: number;
      requiredAcknowledgements: string[];
      kind: string;
    }>(
      await page.request.post(
        `${transitionPath}/preview`,
        mutationOptions(csrf, { tenancy: dedicatedTenancy }),
      ),
      `preview Journey 12 ${channel} shared-to-dedicated rollback`,
    );
    expect(rollbackPreview.kind).toBe('shared_to_dedicated');
    const rolledBack = await responseJson<{
      applied: boolean;
      transition: {
        proposed: Record<string, unknown>;
      };
    }>(
      await page.request.post(
        `${transitionPath}/apply`,
        mutationOptions(csrf, {
          tenancy: dedicatedTenancy,
          previewHash: rollbackPreview.previewHash,
          previewExpiresAt: rollbackPreview.previewExpiresAt,
          acknowledgements: rollbackPreview.requiredAcknowledgements,
        }),
      ),
      `apply Journey 12 ${channel} shared-to-dedicated rollback`,
    );
    expect(rolledBack).toMatchObject({
      applied: true,
      transition: {
        proposed: {
          mode: 'dedicated',
          tenantId: 'tenant-default',
          runtimeAccessScope: 'resource_aware',
          resolutionStatus: 'ready',
        },
      },
    });
    const afterRollback = await browserDefinitions();
    expect(afterRollback.status).toBe(200);
    expect(afterRollback.keys).toEqual(beforeTransition.keys);

    const observationDirectory = path.join(
      process.cwd(),
      'test/results/engine-tenancy-provisioning-observations',
    );
    await mkdir(observationDirectory, { recursive: true });
    await writeFile(
      path.join(observationDirectory, `journey-12-${channel}.json`),
      `${JSON.stringify({
        schemaVersion: 1,
        journeyId: 12,
        channel,
        status: 'passed',
        commit,
        sourceState,
        releaseCommitQualified: sourceState === 'clean',
        localhostOnly: true,
        realHttpService: true,
        persistentDatabase: true,
        authorizationEvaluator: true,
        userInterface: channel === 'manual-ui',
        assertions: [
          'preview',
          'acknowledgement',
          'concurrency-conflict',
          'apply',
          'cache-invalidation',
          'rollback',
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
    await restrictedContext?.close();
    if (assignmentId) {
      const response = await page.request.delete(
        `/api/authz/role-assignments/${encodeURIComponent(assignmentId)}`,
        mutationOptions(csrf),
      );
      expect([204, 404]).toContain(response.status());
    }
  }
}

async function proveCredentialRotation(input: {
  page: Page;
  engineId: string;
  channel: ProvisioningJourneyChannel;
  suffix: string;
  commit: string;
  sourceState: string;
  rotateCredential: (input: {
    secret: string;
    reference: string;
  }) => Promise<unknown>;
  verifyChannelState?: (input: {
    secret: string;
    reference: string;
  }) => Promise<void>;
}): Promise<{ rotatedReference: string }> {
  const {
    page,
    engineId,
    channel,
    suffix,
    commit,
    sourceState,
    rotateCredential,
    verifyChannelState,
  } = input;
  const database = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : 5432,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DATABASE,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  const schema = process.env.POSTGRES_SCHEMA || 'main';
  const marker = suffix.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
  const initial = {
    secret: `e2e-j13-initial-${suffix}`,
    reference: `E2E_J13_INITIAL_${marker}`,
  };
  const rotated = {
    secret: `e2e-j13-rotated-${suffix}`,
    reference: `E2E_J13_ROTATED_${marker}`,
  };

  const storedCredential = async (): Promise<string | null> => {
    const result = await database.query(
      `SELECT password_enc FROM ${schema}.engines WHERE id = $1`,
      [engineId],
    );
    expect(result.rowCount).toBe(1);
    return result.rows[0]?.password_enc ?? null;
  };

  try {
    const before = await responseJson<Record<string, unknown>>(
      await page.request.get(`/engines-api/engines/${encodeURIComponent(engineId)}`),
      `read Journey 13 ${channel} ownership before credential rotation`,
    );
    const ownership = {
      tenantId: before.tenantId,
      tenancyMode: before.tenancyMode,
      tenantMappingStrategy: before.tenantMappingStrategy,
      tenantMappingVersion: before.tenantMappingVersion,
      tenantResolutionStatus: before.tenantResolutionStatus,
    };

    const initialResult = await rotateCredential(initial);
    expect(JSON.stringify(initialResult)).not.toContain(initial.secret);
    const initialStoredCredential = await storedCredential();
    expect(initialStoredCredential).toBeTruthy();
    expect(initialStoredCredential).not.toBe(initial.secret);

    const rotatedResult = await rotateCredential(rotated);
    expect(JSON.stringify(rotatedResult)).not.toContain(rotated.secret);
    expect(JSON.stringify(rotatedResult)).not.toContain(initial.secret);
    const rotatedStoredCredential = await storedCredential();
    expect(rotatedStoredCredential).toBeTruthy();
    expect(rotatedStoredCredential).not.toBe(initialStoredCredential);
    expect(rotatedStoredCredential).not.toBe(rotated.secret);

    const after = await responseJson<Record<string, unknown>>(
      await page.request.get(`/engines-api/engines/${encodeURIComponent(engineId)}`),
      `read Journey 13 ${channel} ownership after credential rotation`,
    );
    expect(after).toMatchObject({
      ...ownership,
      passwordEnc: null,
      hasCredential: true,
    });
    expect(JSON.stringify(after)).not.toContain(initial.secret);
    expect(JSON.stringify(after)).not.toContain(rotated.secret);
    await verifyChannelState?.(rotated);

    const observationDirectory = path.join(
      process.cwd(),
      'test/results/engine-tenancy-provisioning-observations',
    );
    await mkdir(observationDirectory, { recursive: true });
    await writeFile(
      path.join(observationDirectory, `journey-13-${channel}.json`),
      `${JSON.stringify({
        schemaVersion: 1,
        journeyId: 13,
        channel,
        status: 'passed',
        commit,
        sourceState,
        releaseCommitQualified: sourceState === 'clean',
        localhostOnly: true,
        realHttpService: true,
        persistentDatabase: true,
        authorizationEvaluator: true,
        userInterface: channel === 'manual-ui',
        assertions: [
          'credential-rotation',
          'tenant-ownership-unchanged',
          'secret-redaction',
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
    return { rotatedReference: rotated.reference };
  } finally {
    await database.end();
  }
}

async function proveDecommissionWithoutResurrection(input: {
  page: Page;
  csrf: string;
  engineId: string;
  runtimeResource: Record<string, unknown>;
  channel: ProvisioningJourneyChannel;
  suffix: string;
  commit: string;
  sourceState: string;
  retiredEngineState: 'absent' | 'decommissioned';
  decommission: () => Promise<void>;
  recreate: () => Promise<string>;
  cleanupRecreated: (engineId: string) => Promise<void>;
}): Promise<void> {
  const {
    page,
    csrf,
    engineId,
    runtimeResource,
    channel,
    suffix,
    commit,
    sourceState,
    retiredEngineState,
    decommission,
    recreate,
    cleanupRecreated,
  } = input;
  const fixture = getE2EFineGrainedFixture();
  expect(fixture.scopedUserId, 'Journey 14 requires the seeded direct user').toBeTruthy();
  const runtimeResourceId = String(runtimeResource.id);
  const resourceKey = String(runtimeResource.resourceKey);
  expect(runtimeResourceId).not.toBe('undefined');
  expect(resourceKey).not.toBe('undefined');

  const database = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : 5432,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DATABASE,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  const schema = process.env.POSTGRES_SCHEMA || 'main';
  let roleId: string | null = null;
  let assignmentId: string | null = null;
  let restrictedContext: BrowserContext | null = null;
  let activeApiSession: APIRequestContext | null = null;
  let recreatedEngineId: string | null = null;

  const scalarCount = async (sql: string, values: unknown[]): Promise<number> => {
    const result = await database.query(sql, values);
    return Number(result.rows[0]?.count || 0);
  };

  try {
    const role = await responseJson<{ id: string }>(
      await page.request.post('/api/authz/roles', mutationOptions(csrf, {
        name: `Journey 14 retired-engine reader ${channel} ${suffix}`,
        description: 'Disposable role proving decommission invalidates live sessions.',
        scope: 'engine',
        permissionIds: ['engine:instance:view'],
      })),
      `create Journey 14 ${channel} role`,
    );
    roleId = role.id;
    const assignment = await responseJson<{ id: string }>(
      await page.request.post('/api/authz/role-assignments', mutationOptions(csrf, {
        principalType: 'user',
        principalId: fixture.scopedUserId,
        roleId,
        resourceType: 'engine_runtime_resource',
        resourceId: runtimeResourceId,
      })),
      `assign Journey 14 ${channel} runtime role`,
    );
    assignmentId = assignment.id;

    expect(await scalarCount(
      `SELECT COUNT(*) FROM ${schema}.role_assignments WHERE id = $1`,
      [assignmentId],
    )).toBe(1);
    expect(await scalarCount(
      `SELECT COUNT(*) FROM ${schema}.engine_tenant_mappings
       WHERE engine_id = $1 AND is_active = TRUE`,
      [engineId],
    )).toBeGreaterThan(0);
    expect(await scalarCount(
      `SELECT COUNT(*) FROM ${schema}.runtime_resources
       WHERE engine_id = $1 AND is_active = TRUE`,
      [engineId],
    )).toBeGreaterThan(0);

    const browser = page.context().browser();
    if (!browser) throw new Error('Journey 14 requires a browser-backed Playwright page');
    restrictedContext = await browser.newContext({
      baseURL: baseUrl,
      ignoreHTTPSErrors: true,
    });
    const restrictedPage = await restrictedContext.newPage();
    await loginAs(restrictedPage, fixture.email!, fixture.password!);
    activeApiSession = await playwrightRequest.newContext({
      baseURL: baseUrl,
      ignoreHTTPSErrors: true,
      storageState: await restrictedContext.storageState(),
    });
    const definitionsPath =
      `/mission-control-api/process-definitions?engineId=${encodeURIComponent(engineId)}`;
    const browserDefinitions = async (): Promise<{ status: number; keys: string[] }> =>
      restrictedPage.evaluate(async (url) => {
        const response = await fetch(url, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        const body = await response.json().catch(() => []);
        return {
          status: response.status,
          keys: Array.isArray(body)
            ? body.map((definition: { key?: unknown }) => String(definition.key))
            : [],
        };
      }, definitionsPath);
    const apiDefinitions = async (): Promise<{ status: number; keys: string[] }> => {
      const response = await activeApiSession!.get(definitionsPath);
      const body = await response.json().catch(() => []);
      return {
        status: response.status(),
        keys: Array.isArray(body)
          ? body.map((definition: { key?: unknown }) => String(definition.key))
          : [],
      };
    };

    expect(await browserDefinitions()).toEqual({ status: 200, keys: [resourceKey] });
    expect(await apiDefinitions()).toEqual({ status: 200, keys: [resourceKey] });

    await decommission();

    const remainingAssignmentCount = await scalarCount(
      `SELECT COUNT(*) FROM ${schema}.role_assignments WHERE id = $1`,
      [assignmentId],
    );
    if (remainingAssignmentCount === 0) assignmentId = null;
    expect(remainingAssignmentCount).toBe(0);
    expect(await scalarCount(
      `SELECT COUNT(*) FROM ${schema}.engine_tenant_mappings
       WHERE engine_id = $1 AND is_active = TRUE`,
      [engineId],
    )).toBe(0);
    expect(await scalarCount(
      `SELECT COUNT(*) FROM ${schema}.runtime_resources
       WHERE engine_id = $1 AND is_active = TRUE`,
      [engineId],
    )).toBe(0);
    const retiredEngine = await database.query(
      `SELECT lifecycle_status FROM ${schema}.engines WHERE id = $1`,
      [engineId],
    );
    if (retiredEngineState === 'absent') {
      expect(retiredEngine.rowCount).toBe(0);
    } else {
      expect(retiredEngine.rows).toEqual([
        expect.objectContaining({ lifecycle_status: 'decommissioned' }),
      ]);
    }

    const browserDenied = await browserDefinitions();
    const apiDenied = await apiDefinitions();
    expect([403, 404]).toContain(browserDenied.status);
    expect(browserDenied.keys).toEqual([]);
    expect([403, 404]).toContain(apiDenied.status);
    expect(apiDenied.keys).toEqual([]);

    recreatedEngineId = await recreate();
    expect(recreatedEngineId).toBeTruthy();
    expect(recreatedEngineId).not.toBe(engineId);
    expect(await scalarCount(
      `SELECT COUNT(*) FROM ${schema}.engines
       WHERE id = $1 AND lifecycle_status = 'active'`,
      [recreatedEngineId],
    )).toBe(1);

    const browserStillDenied = await browserDefinitions();
    const apiStillDenied = await apiDefinitions();
    expect([403, 404]).toContain(browserStillDenied.status);
    expect(browserStillDenied.keys).toEqual([]);
    expect([403, 404]).toContain(apiStillDenied.status);
    expect(apiStillDenied.keys).toEqual([]);

    const observationDirectory = path.join(
      process.cwd(),
      'test/results/engine-tenancy-provisioning-observations',
    );
    await mkdir(observationDirectory, { recursive: true });
    await writeFile(
      path.join(observationDirectory, `journey-14-${channel}.json`),
      `${JSON.stringify({
        schemaVersion: 1,
        journeyId: 14,
        channel,
        status: 'passed',
        commit,
        sourceState,
        releaseCommitQualified: sourceState === 'clean',
        localhostOnly: true,
        realHttpService: true,
        persistentDatabase: true,
        authorizationEvaluator: true,
        userInterface: channel === 'manual-ui',
        assertions: [
          'decommission',
          'assignments-inactive',
          'mappings-inactive',
          'inventory-inactive',
          'cached-access-denied',
          'recreation-uses-new-stable-id',
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
    if (recreatedEngineId) await cleanupRecreated(recreatedEngineId);
    await activeApiSession?.dispose();
    await restrictedContext?.close();
    if (assignmentId) {
      const response = await page.request.delete(
        `/api/authz/role-assignments/${encodeURIComponent(assignmentId)}`,
        mutationOptions(csrf),
      );
      expect([204, 404]).toContain(response.status());
    }
    if (roleId) {
      const response = await page.request.delete(
        `/api/authz/roles/${encodeURIComponent(roleId)}`,
        mutationOptions(csrf),
      );
      expect([204, 404]).toContain(response.status());
    }
    await database.end();
  }
}

async function provePrincipalRoleAssignmentMatrix(input: {
  page: Page;
  csrf: string;
  engineId: string;
  runtimeResource: Record<string, unknown>;
  deniedRuntimeResource: Record<string, unknown>;
  channel: ProvisioningJourneyChannel;
  suffix: string;
  commit: string;
  sourceState: string;
  setRuntimeTenantMappingActive: (input: {
    runtimeTenantId: string;
    active: boolean;
  }) => Promise<void>;
}): Promise<void> {
  const {
    page,
    csrf,
    engineId,
    runtimeResource,
    deniedRuntimeResource,
    channel,
    suffix,
    commit,
    sourceState,
    setRuntimeTenantMappingActive,
  } = input;
  const fixture = getE2EFineGrainedFixture();
  expect(fixture.scopedUserId, 'Journey 8 requires the seeded direct user').toBeTruthy();
  expect(fixture.groupScopedUserId, 'Journey 8 requires the seeded group member').toBeTruthy();
  expect(fixture.groupScopedGroupId, 'Journey 8 requires the seeded authorization group').toBeTruthy();

  let roleId: string | null = null;
  let apiClientId: string | null = null;
  let serviceAccountId: string | null = null;
  let restrictedContext: BrowserContext | null = null;
  let activeApiSession: APIRequestContext | null = null;
  let mockControl: APIRequestContext | null = null;
  const assignmentIds: string[] = [];

  try {
    const customRole = await responseJson<{ id: string }>(
      await page.request.post('/api/authz/roles', mutationOptions(csrf, {
        name: `Journey 8 engine reader ${channel} ${suffix}`,
        description: `Disposable ${channel} principal matrix role`,
        scope: 'engine',
        permissionIds: [
          'engine:instance:view',
          'engine:process:modify',
          'engine:deploy:view',
        ],
      })),
      `create Journey 8 ${channel} custom role`,
    );
    roleId = customRole.id;

    const apiClient = await responseJson<{
      client: { id: string; tokenPrefix: string; scopes: string[] };
      token: string;
    }>(
      await page.request.post('/api/authz/api-clients', mutationOptions(csrf, {
        name: `e2e-j08-client-${channel}-${suffix}`,
        scopes: ['deployment:execute'],
      })),
      `create Journey 8 ${channel} API client`,
    );
    apiClientId = apiClient.client.id;
    expect(apiClient.token).toBeTruthy();
    expect(apiClient.client.tokenPrefix).toBeTruthy();
    expect(apiClient.client.scopes).toEqual(['deployment:execute']);

    const serviceAccount = await responseJson<{
      account: { id: string; tokenPrefix: string; scopes: string[] };
      token: string;
    }>(
      await page.request.post('/api/authz/service-accounts', mutationOptions(csrf, {
        name: `e2e-j08-service-${channel}-${suffix}`,
        description: `Disposable ${channel} principal matrix account`,
        scopes: ['deployment:execute'],
      })),
      `create Journey 8 ${channel} service account`,
    );
    serviceAccountId = serviceAccount.account.id;
    expect(serviceAccount.token).toBeTruthy();
    expect(serviceAccount.account.tokenPrefix).toBeTruthy();
    expect(serviceAccount.account.scopes).toEqual(['deployment:execute']);

    const assignments = [
      {
        principalType: 'user',
        principalId: fixture.scopedUserId!,
        roleId,
      },
      {
        principalType: 'group',
        principalId: fixture.groupScopedGroupId!,
        roleId: 'system.engine.operator',
      },
      {
        principalType: 'api_client',
        principalId: apiClientId,
        roleId,
      },
      {
        principalType: 'service_account',
        principalId: serviceAccountId,
        roleId: 'system.engine.operator',
      },
    ] as const;

    for (const assignment of assignments) {
      const created = await responseJson<{ id: string; warnings?: string[] }>(
        await page.request.post('/api/authz/role-assignments', mutationOptions(csrf, {
          ...assignment,
          resourceType: 'engine',
          resourceId: engineId,
        })),
        `assign Journey 8 ${channel} ${assignment.principalType} role`,
      );
      assignmentIds.push(created.id);
      expect(created.warnings ?? []).toEqual([]);
    }

    const directEvaluation = await responseJson<{
      allowed: boolean;
      sources: Array<Record<string, unknown>>;
    }>(
      await page.request.post('/api/authz/evaluate', mutationOptions(csrf, {
        userId: fixture.scopedUserId,
        permission: 'engine:instance:view',
        resourceType: 'engine',
        resourceId: engineId,
      })),
      `evaluate Journey 8 ${channel} direct-user custom role`,
    );
    expect(directEvaluation.allowed).toBe(true);
    expect(directEvaluation.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        principalType: 'user',
        principalId: fixture.scopedUserId,
        roleId,
        scopeType: 'engine',
        scopeId: engineId,
      }),
    ]));

    const groupEvaluation = await responseJson<{
      allowed: boolean;
      sources: Array<Record<string, unknown>>;
    }>(
      await page.request.post('/api/authz/evaluate', mutationOptions(csrf, {
        userId: fixture.groupScopedUserId,
        permission: 'engine:instance:view',
        resourceType: 'engine',
        resourceId: engineId,
      })),
      `evaluate Journey 8 ${channel} group predefined role`,
    );
    expect(groupEvaluation.allowed).toBe(true);
    expect(groupEvaluation.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        principalType: 'group',
        principalId: fixture.groupScopedGroupId,
        roleId: 'system.engine.operator',
        scopeType: 'engine',
        scopeId: engineId,
      }),
    ]));

    const persistedAssignments = await responseJson<Array<Record<string, unknown>>>(
      await page.request.get(
        `/api/authz/role-assignments?resourceType=engine&resourceId=${encodeURIComponent(engineId)}`,
      ),
      `list Journey 8 ${channel} persisted assignments`,
    );
    for (const assignment of assignments) {
      expect(persistedAssignments).toEqual(expect.arrayContaining([
        expect.objectContaining({
          principalType: assignment.principalType,
          principalId: assignment.principalId,
          roleId: assignment.roleId,
          resourceType: 'engine',
          resourceId: engineId,
          scopeType: 'engine',
          scopeId: engineId,
        }),
      ]));
    }

    const runtimeResourceId = String(runtimeResource.id);
    const resourceKind = String(runtimeResource.resourceKind);
    const resourceKey = String(runtimeResource.resourceKey);
    const runtimeTenantId = String(runtimeResource.runtimeTenantId);
    const tenantId = String(runtimeResource.tenantId);
    const tenantMappingId = String(runtimeResource.tenantMappingId);
    const tenantMappingVersion = Number(runtimeResource.tenantMappingVersion);
    expect(runtimeResourceId).not.toBe('undefined');
    expect(['process_definition', 'decision_definition']).toContain(resourceKind);
    expect(resourceKey).not.toBe('undefined');
    expect(runtimeTenantId).not.toBe('undefined');
    expect(tenantId).toBe('tenant-default');
    expect(tenantMappingId).not.toBe('undefined');
    expect(tenantMappingVersion).toBeGreaterThan(0);

    const expiresAt = Date.now() + 300_000;
    const expiringAssignment = await responseJson<{ id: string; warnings?: string[] }>(
      await page.request.post('/api/authz/role-assignments', mutationOptions(csrf, {
        principalType: 'user',
        principalId: fixture.scopedUserId,
        roleId,
        resourceType: 'engine_runtime_resource',
        resourceId: runtimeResourceId,
        expiresAt,
      })),
      `assign Journey 9 ${channel} expiring runtime role`,
    );
    assignmentIds.push(expiringAssignment.id);
    expect(expiringAssignment.warnings ?? []).toEqual([]);

    const runtimeEvaluation = await responseJson<{
      allowed: boolean;
      resolvedRuntimeResource: Record<string, unknown>;
      sources: Array<Record<string, unknown>>;
    }>(
      await page.request.post('/api/authz/evaluate', mutationOptions(csrf, {
        userId: fixture.scopedUserId,
        permission: 'engine:instance:view',
        resourceType: 'engine_runtime_resource',
        runtimeResource: {
          engineId,
          resourceKind,
          resourceKey,
          runtimeTenantId,
        },
      })),
      `evaluate Journey 9 ${channel} runtime lineage`,
    );
    expect(runtimeEvaluation.allowed).toBe(true);
    expect(runtimeEvaluation.resolvedRuntimeResource).toMatchObject({
      id: runtimeResourceId,
      engineId,
      resourceKind,
      resourceKey,
      runtimeTenantId,
      tenantId: 'tenant-default',
      tenantResolutionStatus: 'resolved',
      tenantMappingId,
      tenantMappingVersion,
    });
    expect(runtimeEvaluation.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        assignmentId: expiringAssignment.id,
        roleId,
        principalType: 'user',
        principalId: fixture.scopedUserId,
        tenantId: 'tenant-default',
        expiresAt,
        scopeType: 'engine_runtime_resource',
        scopeId: runtimeResourceId,
        runtimeTenantResolution: expect.objectContaining({
          tenantId: 'tenant-default',
          status: 'resolved',
          mappingId: tenantMappingId,
          mappingVersion: tenantMappingVersion,
          engineTenancyMode: 'shared',
        }),
      }),
    ]));

    expect(resourceKind).toBe('process_definition');
    const allowedDefinitionId = String(runtimeResource.engineResourceId);
    const deniedDefinitionId = String(deniedRuntimeResource.engineResourceId);
    const deniedResourceKind = String(deniedRuntimeResource.resourceKind);
    const deniedResourceKey = String(deniedRuntimeResource.resourceKey);
    expect(allowedDefinitionId).not.toBe('undefined');
    expect(deniedDefinitionId).not.toBe('undefined');
    expect(deniedResourceKind).toBe('process_definition');
    expect(deniedResourceKey).not.toBe(resourceKey);

    const browser = page.context().browser();
    if (!browser) throw new Error('Journey 10 requires a browser-backed Playwright page');
    restrictedContext = await browser.newContext({
      baseURL: baseUrl,
      ignoreHTTPSErrors: true,
    });
    const restrictedPage = await restrictedContext.newPage();
    await loginAs(restrictedPage, fixture.email!, fixture.password!);
    const restrictedCsrf = await csrfToken(restrictedPage);
    mockControl = await playwrightRequest.newContext({
      baseURL: mockCamundaControlUrl,
    });

    const definitions = await responseJson<Array<Record<string, unknown>>>(
      await restrictedPage.request.get(
        `/mission-control-api/process-definitions?engineId=${encodeURIComponent(engineId)}`,
      ),
      `list Journey 10 ${channel} filtered definitions`,
    );
    expect(definitions.map((definition) => definition.key)).toEqual([resourceKey]);

    const processInstances = await responseJson<Array<Record<string, unknown>>>(
      await restrictedPage.request.get(
        `/mission-control-api/process-instances?engineId=${encodeURIComponent(engineId)}&active=true`,
      ),
      `list Journey 10 ${channel} filtered process instances`,
    );
    expect(processInstances.length).toBeGreaterThan(0);
    expect(new Set(processInstances.map((instance) => instance.processDefinitionKey))).toEqual(
      new Set([resourceKey]),
    );
    const allowedInstanceId = String(processInstances[0].id);

    const previewCount = await restrictedPage.request.post(
      '/mission-control-api/process-instances/preview-count',
      mutationOptions(restrictedCsrf, { engineId }),
    );
    expect(previewCount.status()).toBe(403);
    expect(await previewCount.json()).toEqual(expect.objectContaining({
      error: expect.stringContaining('Resource-aware process-instance preview counts are not supported'),
    }));

    const allowedDetail = await responseJson<Record<string, unknown>>(
      await restrictedPage.request.get(
        `/mission-control-api/process-definitions/${encodeURIComponent(allowedDefinitionId)}?engineId=${encodeURIComponent(engineId)}`,
      ),
      `read Journey 10 ${channel} authorized definition`,
    );
    expect(allowedDetail.key).toBe(resourceKey);

    const resetLedger = await mockControl.post('/__e2e/requests/reset');
    expect(resetLedger.status()).toBe(204);
    const deniedDetail = await restrictedPage.request.get(
      `/mission-control-api/process-definitions/${encodeURIComponent(deniedDefinitionId)}?engineId=${encodeURIComponent(engineId)}`,
    );
    expect(deniedDetail.status()).toBe(403);
    const deniedLedger = await responseJson<{
      total: number;
      requests: Array<{ request: string; count: number }>;
    }>(
      await mockControl.get('/__e2e/requests'),
      `read Journey 10 ${channel} denied-request ledger`,
    );
    const deniedUpstreamRequest =
      `GET /engine-rest/process-definition/${encodeURIComponent(deniedDefinitionId)}`;
    expect(deniedLedger.requests).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ request: deniedUpstreamRequest }),
    ]));

    const mutation = await restrictedPage.request.put(
      `/mission-control-api/process-instances/${encodeURIComponent(allowedInstanceId)}/suspend`,
      mutationOptions(restrictedCsrf, { engineId }),
    );
    expect(mutation.status()).toBe(204);

    const deniedBatch = await restrictedPage.request.post(
      '/mission-control-api/batches/process-instances/suspend',
      mutationOptions(restrictedCsrf, {
        engineId,
        processInstanceQuery: { processDefinitionKey: resourceKey },
      }),
    );
    expect(deniedBatch.status()).toBe(403);
    expect(await deniedBatch.json()).toEqual(expect.objectContaining({
      error: expect.stringContaining('require explicit processInstanceIds'),
    }));

    const jobs = await responseJson<Array<Record<string, unknown>>>(
      await restrictedPage.request.get(
        `/mission-control-api/jobs?engineId=${encodeURIComponent(engineId)}`,
      ),
      `list Journey 10 ${channel} filtered jobs`,
    );
    expect(jobs).toEqual([]);

    const tasks = await responseJson<Array<Record<string, unknown>>>(
      await restrictedPage.request.get(
        `/mission-control-api/tasks?engineId=${encodeURIComponent(engineId)}`,
      ),
      `list Journey 10 ${channel} filtered tasks`,
    );
    expect(tasks.length).toBeGreaterThan(0);
    expect(new Set(tasks.map((task) => task.processDefinitionKey))).toEqual(
      new Set([resourceKey]),
    );

    const incidents = await responseJson<Array<Record<string, unknown>>>(
      await restrictedPage.request.get(
        `/mission-control-api/process-instances/${encodeURIComponent(allowedInstanceId)}/incidents?engineId=${encodeURIComponent(engineId)}`,
      ),
      `list Journey 10 ${channel} authorized incidents`,
    );
    expect(incidents).toEqual([]);

    const history = await responseJson<Array<Record<string, unknown>>>(
      await restrictedPage.request.get(
        `/mission-control-api/history/process-instances?engineId=${encodeURIComponent(engineId)}`,
      ),
      `list Journey 10 ${channel} filtered history`,
    );
    expect(history.length).toBeGreaterThan(0);
    expect(new Set(history.map((instance) => instance.processDefinitionKey))).toEqual(
      new Set([resourceKey]),
    );

    const deploymentHistory = await responseJson<Array<Record<string, unknown>>>(
      await restrictedPage.request.get(
        `/engines-api/engines/${encodeURIComponent(engineId)}/deployment-history`,
      ),
      `list Journey 10 ${channel} authorized deployment history`,
    );
    expect(deploymentHistory).toEqual([]);

    activeApiSession = await playwrightRequest.newContext({
      baseURL: baseUrl,
      ignoreHTTPSErrors: true,
      storageState: await restrictedContext.storageState(),
    });
    const definitionsPath =
      `/mission-control-api/process-definitions?engineId=${encodeURIComponent(engineId)}`;
    const browserDefinitionKeys = async (): Promise<{
      status: number;
      keys: string[];
    }> => restrictedPage.evaluate(async (url) => {
      const response = await fetch(url, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const body = await response.json().catch(() => []);
      return {
        status: response.status,
        keys: Array.isArray(body)
          ? body.map((definition: { key?: unknown }) => String(definition.key))
          : [],
      };
    }, definitionsPath);
    const apiDefinitionKeys = async (): Promise<{
      status: number;
      keys: string[];
    }> => {
      const response = await activeApiSession!.get(definitionsPath);
      const body = await response.json().catch(() => []);
      return {
        status: response.status(),
        keys: Array.isArray(body)
          ? body.map((definition: { key?: unknown }) => String(definition.key))
          : [],
      };
    };

    expect(await browserDefinitionKeys()).toEqual({
      status: 200,
      keys: [resourceKey],
    });
    expect(await apiDefinitionKeys()).toEqual({
      status: 200,
      keys: [resourceKey],
    });

    const removeExpiringAssignment = await page.request.delete(
      `/api/authz/role-assignments/${encodeURIComponent(expiringAssignment.id)}`,
      mutationOptions(csrf),
    );
    expect(removeExpiringAssignment.status()).toBe(204);
    assignmentIds.splice(assignmentIds.indexOf(expiringAssignment.id), 1);

    expect(await browserDefinitionKeys()).toEqual({ status: 403, keys: [] });
    expect(await apiDefinitionKeys()).toEqual({ status: 403, keys: [] });

    const restoredAssignment = await responseJson<{ id: string; warnings?: string[] }>(
      await page.request.post('/api/authz/role-assignments', mutationOptions(csrf, {
        principalType: 'user',
        principalId: fixture.scopedUserId,
        roleId,
        resourceType: 'engine_runtime_resource',
        resourceId: runtimeResourceId,
        expiresAt,
      })),
      `restore Journey 11 ${channel} runtime role`,
    );
    assignmentIds.push(restoredAssignment.id);
    expect(restoredAssignment.warnings ?? []).toEqual([]);
    expect(await browserDefinitionKeys()).toEqual({
      status: 200,
      keys: [resourceKey],
    });
    expect(await apiDefinitionKeys()).toEqual({
      status: 200,
      keys: [resourceKey],
    });

    await setRuntimeTenantMappingActive({
      runtimeTenantId,
      active: false,
    });
    await responseJson(
      await page.request.post(
        `/engines-api/engines/${encodeURIComponent(engineId)}/runtime-resources/reconcile`,
        mutationOptions(csrf),
      ),
      `reconcile Journey 11 ${channel} removed mapping`,
    );
    expect(await browserDefinitionKeys()).toEqual({ status: 403, keys: [] });
    expect(await apiDefinitionKeys()).toEqual({ status: 403, keys: [] });

    await setRuntimeTenantMappingActive({
      runtimeTenantId,
      active: true,
    });
    await responseJson(
      await page.request.post(
        `/engines-api/engines/${encodeURIComponent(engineId)}/runtime-resources/reconcile`,
        mutationOptions(csrf),
      ),
      `reconcile Journey 11 ${channel} restored mapping`,
    );
    expect(await browserDefinitionKeys()).toEqual({
      status: 200,
      keys: [resourceKey],
    });
    expect(await apiDefinitionKeys()).toEqual({
      status: 200,
      keys: [resourceKey],
    });

    const removeRestoredAssignment = await page.request.delete(
      `/api/authz/role-assignments/${encodeURIComponent(restoredAssignment.id)}`,
      mutationOptions(csrf),
    );
    expect(removeRestoredAssignment.status()).toBe(204);
    assignmentIds.splice(assignmentIds.indexOf(restoredAssignment.id), 1);

    const expiredAssignment = await responseJson<{ id: string }>(
      await page.request.post('/api/authz/role-assignments', mutationOptions(csrf, {
        principalType: 'user',
        principalId: fixture.scopedUserId,
        roleId,
        resourceType: 'engine_runtime_resource',
        resourceId: runtimeResourceId,
        expiresAt: Date.now() - 1,
      })),
      `assign Journey 9 ${channel} expired runtime role`,
    );
    assignmentIds.push(expiredAssignment.id);

    const expiredEvaluation = await responseJson<{
      allowed: boolean;
      reason: string;
      sources: Array<Record<string, unknown>>;
    }>(
      await page.request.post('/api/authz/evaluate', mutationOptions(csrf, {
        userId: fixture.scopedUserId,
        permission: 'engine:instance:view',
        resourceType: 'engine_runtime_resource',
        runtimeResource: {
          engineId,
          resourceKind,
          resourceKey,
          runtimeTenantId,
        },
      })),
      `evaluate Journey 9 ${channel} expired runtime role`,
    );
    expect(expiredEvaluation).toMatchObject({
      allowed: false,
      reason: 'no-permission',
      sources: [],
    });

    const observationDirectory = path.join(
      process.cwd(),
      'test/results/engine-tenancy-provisioning-observations',
    );
    await mkdir(observationDirectory, { recursive: true });
    await writeFile(
      path.join(observationDirectory, `journey-08-${channel}.json`),
      `${JSON.stringify({
        schemaVersion: 1,
        journeyId: 8,
        channel,
        status: 'passed',
        commit,
        sourceState,
        releaseCommitQualified: sourceState === 'clean',
        localhostOnly: true,
        realHttpService: true,
        persistentDatabase: true,
        authorizationEvaluator: true,
        userInterface: channel === 'manual-ui',
        assertions: [
          'user',
          'group',
          'api-client',
          'service-account',
          'predefined-role',
          'custom-role',
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
    await writeFile(
      path.join(observationDirectory, `journey-09-${channel}.json`),
      `${JSON.stringify({
        schemaVersion: 1,
        journeyId: 9,
        channel,
        status: 'passed',
        commit,
        sourceState,
        releaseCommitQualified: sourceState === 'clean',
        localhostOnly: true,
        realHttpService: true,
        persistentDatabase: true,
        authorizationEvaluator: true,
        userInterface: channel === 'manual-ui',
        assertions: [
          'source',
          'tenant-lineage',
          'expiry',
          'mapping-version',
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
    await writeFile(
      path.join(observationDirectory, `journey-10-${channel}.json`),
      `${JSON.stringify({
        schemaVersion: 1,
        journeyId: 10,
        channel,
        status: 'passed',
        commit,
        sourceState,
        releaseCommitQualified: sourceState === 'clean',
        localhostOnly: true,
        realHttpService: true,
        persistentDatabase: true,
        authorizationEvaluator: true,
        userInterface: channel === 'manual-ui',
        assertions: [
          'list',
          'count',
          'detail',
          'mutation',
          'batch',
          'job',
          'task',
          'incident',
          'history',
          'deployment',
          'no-upstream-call-after-denial',
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
    await writeFile(
      path.join(observationDirectory, `journey-11-${channel}.json`),
      `${JSON.stringify({
        schemaVersion: 1,
        journeyId: 11,
        channel,
        status: 'passed',
        commit,
        sourceState,
        releaseCommitQualified: sourceState === 'clean',
        localhostOnly: true,
        realHttpService: true,
        persistentDatabase: true,
        authorizationEvaluator: true,
        userInterface: channel === 'manual-ui',
        assertions: [
          'active-browser-session',
          'active-api-session',
          'assignment-revocation',
          'mapping-removal',
          'cache-invalidation',
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
    await mockControl?.dispose();
    await activeApiSession?.dispose();
    await restrictedContext?.close();
    for (const assignmentId of assignmentIds.reverse()) {
      const response = await page.request.delete(
        `/api/authz/role-assignments/${encodeURIComponent(assignmentId)}`,
        mutationOptions(csrf),
      );
      expect([204, 404]).toContain(response.status());
    }
    if (serviceAccountId) {
      const response = await page.request.delete(
        `/api/authz/service-accounts/${encodeURIComponent(serviceAccountId)}`,
        mutationOptions(csrf),
      );
      expect([204, 404]).toContain(response.status());
    }
    if (apiClientId) {
      const response = await page.request.delete(
        `/api/authz/api-clients/${encodeURIComponent(apiClientId)}`,
        mutationOptions(csrf),
      );
      expect([204, 404]).toContain(response.status());
    }
    if (roleId) {
      const response = await page.request.delete(
        `/api/authz/roles/${encodeURIComponent(roleId)}`,
        mutationOptions(csrf),
      );
      expect([204, 404]).toContain(response.status());
    }
  }
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
      await expect(page.getByText('Engine created', { exact: true }).last()).toBeVisible();

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
      await expect(page.getByText('Engine created', { exact: true }).last()).toBeVisible();
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
      await proveTopologyTransitionAndRollback({
        page,
        csrf: token,
        engineId: dedicatedEngineId,
        channel: 'manual-ui',
        suffix,
        commit,
        sourceState,
      });
      await proveCredentialRotation({
        page,
        engineId: dedicatedEngineId,
        channel: 'manual-ui',
        suffix,
        commit,
        sourceState,
        rotateCredential: async ({ secret }) => responseJson(
          await page.request.put(
            `/engines-api/engines/${encodeURIComponent(dedicatedEngineId)}`,
            mutationOptions(token, { passwordEnc: secret }),
          ),
          'rotate Journey 13 manual engine credential',
        ),
      });

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

      const setManualRuntimeTenantMappingActive = async ({
        runtimeTenantId,
        active,
      }: {
        runtimeTenantId: string;
        active: boolean;
      }): Promise<void> => {
        const result = await responseJson<{
          dryRun: boolean;
          mappingVersion: number;
        }>(
          await page.request.put(
            `/engines-api/engines/${encodeURIComponent(sharedEngineId)}/tenant-mappings`,
            mutationOptions(token, {
              expectedMappingVersion,
              atomic: true,
              dryRun: false,
              mappings: [{
                externalTenantId: runtimeTenantId,
                tenantRef: { type: 'default' },
                strategy: 'engine_tenant_id',
                sourceRef: `manual:journey-07:${runtimeTenantId}:${suffix}`,
                active,
              }],
            }),
          ),
          `${active ? 'restore' : 'remove'} Journey 11 manual runtime mapping`,
        );
        expect(result).toMatchObject({
          dryRun: false,
          mappingVersion: expectedMappingVersion + 1,
        });
        expectedMappingVersion = result.mappingVersion;
      };

      await provePrincipalRoleAssignmentMatrix({
        page,
        csrf: token,
        engineId: sharedEngineId,
        runtimeResource: mappedResources.find(
          (resource) =>
            resource.runtimeTenantId === 'e2e-runtime-blue'
            && resource.resourceKind === 'process_definition'
            && resource.resourceKey === 'invoice-process',
        )!,
        deniedRuntimeResource: mappedResources.find(
          (resource) =>
            resource.runtimeTenantId === 'e2e-runtime-green'
            && resource.resourceKind === 'process_definition'
            && resource.resourceKey === 'invoice-sequential-review',
        )!,
        channel: 'manual-ui',
        suffix,
        commit,
        sourceState,
        setRuntimeTenantMappingActive: setManualRuntimeTenantMappingActive,
      });

      await proveDecommissionWithoutResurrection({
        page,
        csrf: token,
        engineId: sharedEngineId,
        runtimeResource: mappedResources.find(
          (resource) =>
            resource.runtimeTenantId === 'e2e-runtime-blue'
            && resource.resourceKind === 'process_definition'
            && resource.resourceKey === 'invoice-process',
        )!,
        channel: 'manual-ui',
        suffix,
        commit,
        sourceState,
        retiredEngineState: 'absent',
        decommission: async () => {
          await editModal.getByRole('button', { name: 'Cancel', exact: true }).click();
          await expect(editModal).not.toBeVisible();
          const mappedSharedRow = page.getByRole('row').filter({ hasText: sharedName });
          await expect(mappedSharedRow).toBeVisible();
          await mappedSharedRow.getByRole('button', { name: 'Options' }).click();
          const deleteResponsePromise = page.waitForResponse(
            (response) =>
              response.request().method() === 'DELETE'
              && new URL(response.url()).pathname.endsWith(
                `/engines-api/engines/${encodeURIComponent(sharedEngineId)}`,
              ),
          );
          await page.getByRole('menuitem', { name: /^Delete/ }).click();
          expect((await deleteResponsePromise).status()).toBe(204);
          const cleanupIndex = createdEngineIds.indexOf(sharedEngineId);
          expect(cleanupIndex).toBeGreaterThanOrEqual(0);
          createdEngineIds.splice(cleanupIndex, 1);
          await expect(page.getByText('Engine deleted', { exact: true })).toBeVisible();
          await expect(page.getByRole('row').filter({ hasText: sharedName })).toHaveCount(0);
        },
        recreate: async () => String((await createEngineThroughUi(sharedName, 'shared')).id),
        cleanupRecreated: async (recreatedEngineId) => {
          const response = await page.request.delete(
            `/engines-api/engines/${encodeURIComponent(recreatedEngineId)}`,
            mutationOptions(token),
          );
          expect(response.status()).toBe(204);
          const cleanupIndex = createdEngineIds.indexOf(recreatedEngineId);
          expect(cleanupIndex).toBeGreaterThanOrEqual(0);
          createdEngineIds.splice(cleanupIndex, 1);
        },
      });

      const observationDirectory = path.join(
        process.cwd(),
        'test/results/engine-tenancy-provisioning-observations',
      );
      await mkdir(observationDirectory, { recursive: true });
      await writeFile(
        path.join(observationDirectory, 'journey-04-manual-ui.json'),
        `${JSON.stringify({
          schemaVersion: 1,
          journeyId: 4,
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
            'create',
            'map-two-tenants',
            'reconcile',
            'disjoint-inventory',
            'remove',
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
            managementMode: 'hybrid',
            fieldOwnership: { tenancy: 'manual' },
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
        if (!externalIds.includes(externalId)) externalIds.push(externalId);
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
      await proveTopologyTransitionAndRollback({
        page,
        csrf: token,
        engineId: dedicatedEngineId,
        channel: 'external-api',
        suffix,
        commit,
        sourceState,
      });
      await proveCredentialRotation({
        page,
        engineId: dedicatedEngineId,
        channel: 'external-api',
        suffix,
        commit,
        sourceState,
        rotateCredential: async ({ secret }) => {
          const current = await responseJson<Record<string, unknown>>(
            await page.request.get(
              `/engines-api/engines/${encodeURIComponent(dedicatedEngineId)}`,
            ),
            'read Journey 13 external engine before credential update',
          );
          return responseJson(
            await externalApi!.post('/engines-api/external/engines', {
              data: {
                name: current.name,
                baseUrl: runtimeBaseUrl,
                externalId: dedicatedExternalId,
                type: 'camunda7',
                connectionMode: 'direct',
                managementMode: 'hybrid',
                fieldOwnership: { tenancy: 'manual' },
                runtimeAccessScope: current.runtimeAccessScope,
                metadataDiscoveryEnabled: true,
                deploymentDiscoveryEnabled: false,
                pipelineReceiptEnabled: false,
                passwordEnc: secret,
                tenancy: {
                  mode: 'dedicated',
                  tenantRef: { type: 'default' },
                },
              },
            }),
            'rotate Journey 13 external engine credential',
          );
        },
      });

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

      let currentMappingVersion = mappingApply.mappingVersion;
      const setExternalRuntimeTenantMappingActive = async ({
        runtimeTenantId,
        active,
      }: {
        runtimeTenantId: string;
        active: boolean;
      }): Promise<void> => {
        const result = await responseJson<{
          dryRun: boolean;
          mappingVersion: number;
        }>(
          await externalApi!.put(mappingPath, {
            data: {
              expectedMappingVersion: currentMappingVersion,
              atomic: true,
              dryRun: false,
              mappings: [{
                externalTenantId: runtimeTenantId,
                tenantRef: { type: 'default' },
                strategy: 'engine_tenant_id',
                sourceRef: `external:journey-07:${runtimeTenantId}:${suffix}`,
                active,
              }],
            },
          }),
          `${active ? 'restore' : 'remove'} Journey 11 external runtime mapping`,
        );
        expect(result).toMatchObject({
          dryRun: false,
          mappingVersion: currentMappingVersion + 1,
        });
        currentMappingVersion = result.mappingVersion;
      };

      await provePrincipalRoleAssignmentMatrix({
        page,
        csrf: token,
        engineId: sharedEngineId,
        runtimeResource: mappedResources.find(
          (resource) =>
            resource.runtimeTenantId === 'e2e-runtime-blue'
            && resource.resourceKind === 'process_definition'
            && resource.resourceKey === 'invoice-process',
        )!,
        deniedRuntimeResource: mappedResources.find(
          (resource) =>
            resource.runtimeTenantId === 'e2e-runtime-green'
            && resource.resourceKind === 'process_definition'
            && resource.resourceKey === 'invoice-sequential-review',
        )!,
        channel: 'external-api',
        suffix,
        commit,
        sourceState,
        setRuntimeTenantMappingActive: setExternalRuntimeTenantMappingActive,
      });

      await proveDecommissionWithoutResurrection({
        page,
        csrf: token,
        engineId: sharedEngineId,
        runtimeResource: mappedResources.find(
          (resource) =>
            resource.runtimeTenantId === 'e2e-runtime-blue'
            && resource.resourceKind === 'process_definition'
            && resource.resourceKey === 'invoice-process',
        )!,
        channel: 'external-api',
        suffix,
        commit,
        sourceState,
        retiredEngineState: 'decommissioned',
        decommission: async () => {
          const decommissioned = await responseJson<{
            decommissioned: boolean;
            engineId: string;
            lifecycleStatus: string;
          }>(
            await externalApi!.post('/engines-api/external/engines/decommission', {
              data: {
                externalId: sharedExternalId,
                reason: 'Journey 14 external engine decommission',
              },
            }),
            'decommission Journey 14 external shared engine',
          );
          expect(decommissioned).toEqual(expect.objectContaining({
            decommissioned: true,
            engineId: sharedEngineId,
            lifecycleStatus: 'decommissioned',
          }));
        },
        recreate: async () => String((await register(sharedExternalId, 'shared')).id),
        cleanupRecreated: async (recreatedEngineId) => {
          const decommissioned = await responseJson<{ engineId: string }>(
            await externalApi!.post('/engines-api/external/engines/decommission', {
              data: {
                externalId: sharedExternalId,
                reason: 'Journey 14 recreated external engine cleanup',
              },
            }),
            'clean up Journey 14 recreated external shared engine',
          );
          expect(decommissioned.engineId).toBe(recreatedEngineId);
          const cleanupIndex = externalIds.indexOf(sharedExternalId);
          expect(cleanupIndex).toBeGreaterThanOrEqual(0);
          externalIds.splice(cleanupIndex, 1);
        },
      });

      const observationDirectory = path.join(
        process.cwd(),
        'test/results/engine-tenancy-provisioning-observations',
      );
      await mkdir(observationDirectory, { recursive: true });
      await writeFile(
        path.join(observationDirectory, 'journey-05-external-api.json'),
        `${JSON.stringify({
          schemaVersion: 1,
          journeyId: 5,
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
            'create',
            'mapping-preview',
            'mapping-apply',
            'reconcile',
            'decommission',
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
          ownershipMode: 'config_warn',
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
      await proveTopologyTransitionAndRollback({
        page,
        csrf: token,
        engineId: dedicatedEngineId,
        channel: 'configuration-bundle',
        suffix,
        commit,
        sourceState,
      });

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
        updated: 1,
        archived: 0,
      });
      expect(mappingApply.changes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          objectType: 'engine',
          key: dedicatedKey,
          operation: 'update',
          currentId: dedicatedEngineId,
        }),
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

      let mappingChangeSequence = 0;
      const setConfigRuntimeTenantMappingActive = async ({
        runtimeTenantId,
        active,
      }: {
        runtimeTenantId: string;
        active: boolean;
      }): Promise<void> => {
        mappingChangeSequence += 1;
        const engineTenantMappings = mappedEnvelope.files[
          './engine-tenant-mappings.json'
        ].engineTenantMappings.map((mapping) => ({
          ...mapping,
          active: mapping.externalTenantId === runtimeTenantId ? active : mapping.active,
        }));
        const result = await applyBundle(
          {
            bundle: mappedEnvelope.bundle,
            files: {
              './engines.json': mappedEnvelope.files['./engines.json'],
              './engine-tenant-mappings.json': { engineTenantMappings },
            },
          },
          `journey-11-config-mapping-${mappingChangeSequence}-${suffix}`,
          `${active ? 'restore' : 'remove'} Journey 11 configuration runtime mapping`,
        );
        expect(result.changes).toEqual(expect.arrayContaining([
          expect.objectContaining({
            objectType: 'engine_tenant_mapping',
            key: mappingKeys.blue,
            operation: 'update',
          }),
        ]));
      };

      await provePrincipalRoleAssignmentMatrix({
        page,
        csrf: token,
        engineId: sharedEngineId,
        runtimeResource: mappedResources.find(
          (resource) =>
            resource.runtimeTenantId === 'e2e-runtime-blue'
            && resource.resourceKind === 'process_definition'
            && resource.resourceKey === 'invoice-process',
        )!,
        deniedRuntimeResource: mappedResources.find(
          (resource) =>
            resource.runtimeTenantId === 'e2e-runtime-green'
            && resource.resourceKind === 'process_definition'
            && resource.resourceKey === 'invoice-sequential-review',
        )!,
        channel: 'configuration-bundle',
        suffix,
        commit,
        sourceState,
        setRuntimeTenantMappingActive: setConfigRuntimeTenantMappingActive,
      });

      const configCredentialRotation = await proveCredentialRotation({
        page,
        engineId: dedicatedEngineId,
        channel: 'configuration-bundle',
        suffix,
        commit,
        sourceState,
        rotateCredential: async ({ reference }) => {
          const rotatedEngines = enginesFile.engines.map((engine) => engine.key === dedicatedKey
            ? {
                ...engine,
                auth: {
                  ...engine.auth,
                  passwordRef: reference,
                },
              }
            : engine);
          return applyBundle(
            {
              bundle: mappedEnvelope.bundle,
              files: {
                './engines.json': { engines: rotatedEngines },
                './engine-tenant-mappings.json':
                  mappedEnvelope.files['./engine-tenant-mappings.json'],
              },
            },
            `journey-13-config-credential-${reference}-${suffix}`,
            'Journey 13 configuration credential rotation',
          );
        },
        verifyChannelState: async ({ secret, reference }) => {
          const currentExport = await responseJson<{
            files: Record<string, {
              engines?: Array<Record<string, unknown>>;
            }>;
          }>(
            await page.request.get(
              `/api/authz/config-bundles/export?bundleKey=${encodeURIComponent(bundleKey)}&tenantKey=default`,
            ),
            'verify Journey 13 configuration credential reference',
          );
          expect(currentExport.files['./engines.json']?.engines).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                key: dedicatedKey,
                auth: expect.objectContaining({ passwordRef: reference }),
              }),
            ]),
          );
          expect(JSON.stringify(currentExport)).not.toContain(secret);
        },
      });

      const exported = await responseJson<{
        bundle: Record<string, unknown>;
        files: Record<string, {
          engines?: Array<Record<string, unknown>>;
          engineTenantMappings?: Array<Record<string, unknown>>;
        }>;
      }>(
        await page.request.get(
          `/api/authz/config-bundles/export?bundleKey=${encodeURIComponent(bundleKey)}&tenantKey=default`,
        ),
        'export configuration-mapped shared lifecycle',
      );
      expect(exported.bundle).toMatchObject({
        apiVersion: 'enterpriseglue.ai/v1alpha1',
        kind: 'EnterpriseGlueConfigBundle',
        metadata: { key: bundleKey },
        tenantKey: 'default',
        mode: 'authoritative',
        imports: expect.arrayContaining([
          './engines.json',
          './engine-tenant-mappings.json',
        ]),
      });
      expect(exported.files['./engines.json']?.engines).toEqual(expect.arrayContaining([
        expect.objectContaining({
          key: dedicatedKey,
          tenancy: {
            mode: 'dedicated',
            tenantRef: { type: 'id', id: 'tenant-default' },
          },
          auth: expect.objectContaining({
            passwordRef: configCredentialRotation.rotatedReference,
          }),
          ownershipMode: 'config_warn',
        }),
        expect.objectContaining({
          key: sharedKey,
          tenancy: {
            mode: 'shared',
            mappingStrategy: 'engine_tenant_id',
            unmappedPolicy: 'deny',
          },
          ownershipMode: 'config_locked',
        }),
      ]));
      expect(
        exported.files['./engine-tenant-mappings.json']?.engineTenantMappings,
      ).toEqual(expect.arrayContaining([
        expect.objectContaining({
          key: mappingKeys.blue,
          engineRef: { engineKey: sharedKey },
          externalTenantId: 'e2e-runtime-blue',
          active: true,
          ownershipMode: 'config_locked',
        }),
        expect.objectContaining({
          key: mappingKeys.green,
          engineRef: { engineKey: sharedKey },
          externalTenantId: 'e2e-runtime-green',
          active: true,
          ownershipMode: 'config_locked',
        }),
      ]));

      const exportedReapply = await applyBundle(
        exported as unknown as Record<string, unknown>,
        `journey-06-config-reapply-${suffix}`,
        'journey 6 exported shared configuration',
      );
      expect(exportedReapply).toMatchObject({
        created: 0,
        updated: 0,
        archived: 0,
      });
      expect(exportedReapply.changes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          objectType: 'engine',
          key: sharedKey,
          operation: 'noop',
          currentId: sharedEngineId,
        }),
        expect.objectContaining({
          objectType: 'engine_tenant_mapping',
          key: mappingKeys.blue,
          operation: 'noop',
        }),
        expect.objectContaining({
          objectType: 'engine_tenant_mapping',
          key: mappingKeys.green,
          operation: 'noop',
        }),
      ]));

      const currentEngines = enginesFile.engines.map((engine) => engine.key === dedicatedKey
        ? {
            ...engine,
            auth: {
              ...engine.auth,
              passwordRef: configCredentialRotation.rotatedReference,
            },
          }
        : engine);
      const sharedRetirementEnvelope = {
        bundle: mappedEnvelope.bundle,
        files: {
          './engines.json': {
            engines: currentEngines.filter((engine) => engine.key === dedicatedKey),
          },
          './engine-tenant-mappings.json': { engineTenantMappings: [] },
        },
      };
      const recreationEnvelope = {
        bundle: mappedEnvelope.bundle,
        files: {
          './engines.json': { engines: currentEngines },
          './engine-tenant-mappings.json':
            mappedEnvelope.files['./engine-tenant-mappings.json'],
        },
      };
      const removalEnvelope = {
        bundle: mappedEnvelope.bundle,
        files: {
          './engines.json': { engines: [] },
          './engine-tenant-mappings.json': { engineTenantMappings: [] },
        },
      };
      await proveDecommissionWithoutResurrection({
        page,
        csrf: token,
        engineId: sharedEngineId,
        runtimeResource: mappedResources.find(
          (resource) =>
            resource.runtimeTenantId === 'e2e-runtime-blue'
            && resource.resourceKind === 'process_definition'
            && resource.resourceKey === 'invoice-process',
        )!,
        channel: 'configuration-bundle',
        suffix,
        commit,
        sourceState,
        retiredEngineState: 'decommissioned',
        decommission: async () => {
          const retirement = await applyBundle(
            sharedRetirementEnvelope,
            `journey-14-config-retire-${suffix}`,
            'Journey 14 configuration shared-engine retirement',
          );
          expect(retirement).toMatchObject({
            created: 0,
            updated: 0,
            archived: 3,
          });
        },
        recreate: async () => {
          const recreation = await applyBundle(
            recreationEnvelope,
            `journey-14-config-recreate-${suffix}`,
            'Journey 14 configuration shared-engine recreation',
          );
          expect(recreation.created).toBeGreaterThanOrEqual(1);
          const result = await database.query(
            `SELECT id FROM ${schema}.engines
             WHERE config_key = $1 AND lifecycle_status = 'active'
             ORDER BY created_at DESC LIMIT 1`,
            [sharedKey],
          );
          expect(result.rowCount).toBe(1);
          return String(result.rows[0].id);
        },
        cleanupRecreated: async (recreatedEngineId) => {
          const removal = await applyBundle(
            removalEnvelope,
            `journey-14-config-cleanup-${suffix}`,
            'Journey 14 configuration recreated-engine cleanup',
          );
          expect(removal.archived).toBeGreaterThanOrEqual(2);
          const result = await database.query(
            `SELECT lifecycle_status FROM ${schema}.engines WHERE id = $1`,
            [recreatedEngineId],
          );
          expect(result.rows).toEqual([
            expect.objectContaining({ lifecycle_status: 'decommissioned' }),
          ]);
          removed = true;
        },
      });

      const afterRemoval = await responseJson<{
        bundle: Record<string, unknown>;
        files: Record<string, unknown>;
      }>(
        await page.request.get(
          `/api/authz/config-bundles/export?bundleKey=${encodeURIComponent(bundleKey)}&tenantKey=default`,
        ),
        'verify removed shared configuration is absent from export',
      );
      expect(afterRemoval.bundle).toMatchObject({
        metadata: { key: bundleKey },
        imports: [],
      });
      expect(afterRemoval.files['./engines.json']).toBeUndefined();
      expect(afterRemoval.files['./engine-tenant-mappings.json']).toBeUndefined();

      const observationDirectory = path.join(
        process.cwd(),
        'test/results/engine-tenancy-provisioning-observations',
      );
      await mkdir(observationDirectory, { recursive: true });
      await writeFile(
        path.join(observationDirectory, 'journey-06-configuration-bundle.json'),
        `${JSON.stringify({
          schemaVersion: 1,
          journeyId: 6,
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
