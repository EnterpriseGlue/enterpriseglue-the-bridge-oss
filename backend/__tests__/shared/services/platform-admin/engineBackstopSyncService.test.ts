import { describe, expect, it, vi } from 'vitest';
import { CamundaCompatibleBackstopNativeClient, CustomerSidecarBackstopNativeClient, EngineBackstopSyncService, engineBackstopConnectionCommitment } from '@enterpriseglue/shared/services/platform-admin/EngineBackstopSyncService.js';
import { EngineBackstopTaskLeaseLostError } from '@enterpriseglue/shared/services/platform-admin/EngineBackstopSyncTaskService.js';
import { BpmnEngineOperationError, camundaDelete, camundaGet, camundaPost } from '@enterpriseglue/shared/services/bpmn-engine-client.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSetMaterialization.js';
import { EngineSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSet.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { RuntimeResourceSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSetMaterialization.js';
import type { EngineBackstopProjection } from '@enterpriseglue/shared/schemas/platform-admin/engine-backstop.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', () => ({
  BpmnEngineOperationError: class BpmnEngineOperationError extends Error {
    details: Record<string, unknown>;
    constructor(input: { details?: Record<string, unknown>; status?: number } = {}) {
      super('mock engine operation failed');
      this.details = input.details || (input.status === undefined ? {} : { engineStatus: input.status });
    }
  },
  camundaGet: vi.fn(),
  camundaPost: vi.fn(),
  camundaDelete: vi.fn(),
  camundaGetWithConnection: vi.fn(),
  camundaPostWithConnection: vi.fn(),
  camundaDeleteWithConnection: vi.fn(),
}));

const sourceHash = 'a'.repeat(64);
const desiredHash = 'b'.repeat(64);
const engineConnection = {
  id: 'engine-1', type: 'camunda7', lifecycleStatus: 'active', connectionMode: 'direct',
  baseUrl: 'https://engine.example.test/engine-rest', authType: 'basic', username: 'service-account', passwordEnc: 'encrypted',
  oauthTokenUrl: null, oauthScopes: null, oauthAudience: null,
} as const;
const connectionCommitment = engineBackstopConnectionCommitment(engineConnection as any);

function projection(resourceKey = 'payments'): EngineBackstopProjection {
  return {
    classifications: [{
      sourceAssignmentId: 'assignment-1', principalType: 'group', disposition: 'proposed', reasonCodes: ['exact_group_read_projected'],
      resourceKind: 'process_definition', resourceKey, nativeGroupId: 'camunda-operators', camundaResourceType: 6, permissions: ['READ'],
    }],
    desiredGrants: [{
      nativeGroupId: 'camunda-operators', resourceKind: 'process_definition', resourceKey, camundaResourceType: 6, permissions: ['READ'], sourceAssignmentIds: ['assignment-1'],
    }],
  };
}

const emptyProjection = (): EngineBackstopProjection => ({ classifications: [], desiredGrants: [] });

async function previewWithRepositories(input: {
  role?: Record<string, unknown>;
  assignment?: Record<string, unknown>;
  resources?: Record<string, unknown>[];
  resourceSets?: Record<string, unknown>[];
  resourceSetMaterializations?: Record<string, unknown>[];
  engineSets?: Record<string, unknown>[];
  engineSetMaterializations?: Record<string, unknown>[];
}) {
  const engine = {
    ...engineConnection,
    tenancyMode: 'dedicated', tenantId: 'tenant-a', runtimeAccessScope: 'resource_aware',
  };
  const role = {
    id: 'role-a', tenantId: 'tenant-a', kind: 'custom', isArchived: false,
    ...input.role,
  };
  const assignment = {
    id: 'assignment-a', tenantId: 'tenant-a', roleId: 'role-a', principalType: 'group', principalId: 'authz-operators',
    expiresAt: null, scopeType: 'engine_runtime_resource', scopeId: 'resource-a',
    ...input.assignment,
  };
  const resources = input.resources || [{
    id: 'resource-a', engineId: 'engine-1', resourceKind: 'process_definition', resourceKey: 'payments',
    tenantId: 'tenant-a', isActive: true, tenantResolutionStatus: 'resolved',
  }];
  const findByEntity = new Map<unknown, unknown[]>([
    [RbacRole, [role]],
    [RbacRoleAssignment, [assignment]],
    [RbacRolePermission, [{ roleId: 'role-a', permissionId: 'engine:instance:view' }]],
    [RuntimeResource, resources],
    [RuntimeResourceSet, input.resourceSets || []],
    [RuntimeResourceSetMaterialization, input.resourceSetMaterializations || []],
    [EngineSet, input.engineSets || []],
    [EngineSetMaterialization, input.engineSetMaterializations || []],
  ]);
  const repositoryFinds = new Map<unknown, ReturnType<typeof vi.fn>>();
  vi.mocked(getDataSource).mockResolvedValue({
    getRepository: (entity: unknown) => {
      if (entity === Engine) return { findOne: vi.fn(async () => engine) };
      const find = vi.fn(async () => findByEntity.get(entity) || []);
      repositoryFinds.set(entity, find);
      return { find };
    },
  } as any);
  let captured: any;
  const service = new EngineBackstopSyncService({
    mappingService: { activeProjectionMappings: vi.fn(async () => [{ authzGroupId: 'authz-operators', nativeGroupId: 'native-operators', isActive: true }]) },
    runService: {
      createPreview: vi.fn(async (values) => {
        captured = values;
        return run({
          id: `preview-${Math.random()}`, engineId: values.engineId, tenantId: values.tenantId,
          sourceHash: values.sourceHash, desiredHash: values.desiredHash,
          capability: values.capability, classifications: values.projection.classifications,
        });
      }),
      getSummary: vi.fn(), getDetailedSnapshot: vi.fn(), listForEngine: vi.fn(), getLatestSuccessfulApply: vi.fn(), updateRun: vi.fn(), updateRunWithTaskLease: vi.fn(),
    } as any,
    taskService: { enqueue: vi.fn(), runNext: vi.fn() } as any,
  });
  await service.preview({ engineId: 'engine-1', tenantId: 'tenant-a' });
  return { captured, repositoryFinds };
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1', engineId: 'engine-1', tenantId: 'tenant-a', status: 'previewed', sourceHash, desiredHash, resultHash: null,
    catalogVersion: 'camunda7-mirrored-backstop-v1', capability: {}, counts: {}, classifications: [], rollbackOfRunId: null, observedOfRunId: null,
    detailedSnapshotAvailable: true, detailedSnapshotExpiresAt: 10_000, completedAt: null, createdAt: 1, updatedAt: 1,
    ...overrides,
  } as any;
}

function setup(input: { builtProjection?: ReturnType<typeof projection>; sourceHash?: string; desiredHash?: string; existingOwned?: any[] } = {}) {
  const currentRun = run({ sourceHash: input.sourceHash || sourceHash, desiredHash: input.desiredHash || desiredHash });
  let detail: any = { version: 1, projection: input.builtProjection || projection(), connectionCommitment, ownedGrants: input.existingOwned || [] };
  const updateRun = vi.fn(async (values) => {
    Object.assign(currentRun, values);
    if (values.detailedSnapshot !== undefined) detail = values.detailedSnapshot;
    return currentRun;
  });
  const runService = {
    createPreview: vi.fn(),
    getSummary: vi.fn(async () => currentRun),
    getDetailedSnapshot: vi.fn(async (_id?: string) => detail),
    listForEngine: vi.fn(async () => [currentRun]),
    getLatestSuccessfulApply: vi.fn(async () => null),
    updateRun,
    updateRunWithTaskLease: vi.fn(async ({ taskId: _taskId, leaseId: _leaseId, taskRunId: _taskRunId, ...values }) => updateRun(values)),
  };
  const taskService = {
    enqueue: vi.fn(async () => ({ id: 'task-1' })),
    retryNow: vi.fn(async () => true),
    runNext: vi.fn(async (execute) => {
      await execute({ id: 'task-1', leaseId: 'lease-1', engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1', sourceHash: currentRun.sourceHash, operation: 'apply', assertLease: vi.fn(async () => undefined) });
      return { taskId: 'task-1', runId: 'run-1', operation: 'apply', status: 'completed', attempts: 0, nextAttemptAt: null, lastError: null };
    }),
  };
  let nativeAuthorizationIds: string[] = [];
  const nativeClient = {
    createAuthorization: vi.fn(async () => {
      nativeAuthorizationIds = [...nativeAuthorizationIds, 'native-auth-1'];
      return { id: 'native-auth-1' };
    }),
    deleteAuthorization: vi.fn(async (_engineId: string, id: string) => {
      nativeAuthorizationIds = nativeAuthorizationIds.filter((candidate) => candidate !== id);
    }),
    readAuthorization: vi.fn(async () => ({ type: 1, permissions: ['READ'], groupId: 'camunda-operators', resourceType: 6, resourceId: 'payments' })),
    listExactAuthorizationIds: vi.fn(async () => [...nativeAuthorizationIds]),
  };
  const projectionBuilder = vi.fn(async () => ({
    engine: engineConnection, tenantId: 'tenant-a',
    projection: input.builtProjection || projection(), sourceHash: input.sourceHash || sourceHash, desiredHash: input.desiredHash || desiredHash,
    capability: { nativeAuthorizationWrite: true, directTrustedEndpoint: true },
  }));
  return { service: new EngineBackstopSyncService({ runService: runService as any, taskService: taskService as any, nativeClient, projectionBuilder }), currentRun, runService, taskService, nativeClient, projectionBuilder, getDetail: () => detail };
}

function mockDurableEngineConnection(connection: Record<string, unknown> = engineConnection): void {
  vi.mocked(getDataSource).mockResolvedValue({
    getRepository: (entity: unknown) => {
      if (entity !== Engine) throw new Error('Unexpected durable connection repository');
      return {
        createQueryBuilder: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          getOne: vi.fn(async () => connection),
        })),
      };
    },
  } as any);
}

describe('EngineBackstopSyncService', () => {
  it('binds durable ownership to destination and authentication identity while allowing secret rotation', () => {
    const original = engineBackstopConnectionCommitment(engineConnection as any);
    const rotatedSecret = engineBackstopConnectionCommitment({
      ...engineConnection,
      passwordEnc: 'ref:docker://rotated-engine-password',
    } as any);
    const equivalentTrailingSlash = engineBackstopConnectionCommitment({
      ...engineConnection,
      baseUrl: `${engineConnection.baseUrl}/`,
    } as any);
    const replacement = engineBackstopConnectionCommitment({
      ...engineConnection,
      baseUrl: 'https://replacement.example.test/engine-rest',
    } as any);

    expect(rotatedSecret).toBe(original);
    expect(equivalentTrailingSlash).toBe(original);
    expect(replacement).not.toBe(original);
    for (const changedIdentity of [
      { authType: 'oauth2-client-credentials' },
      { username: 'rotated-service-account' },
      { oauthTokenUrl: 'https://identity.example.test/oauth/token' },
      { oauthScopes: 'engine.admin' },
      { oauthAudience: 'engine-api' },
      { connectionMode: 'customer_sidecar' },
    ]) {
      expect(engineBackstopConnectionCommitment({ ...engineConnection, ...changedIdentity } as any)).not.toBe(original);
    }
  });

  it('selects the customer-sidecar adapter from the previewed transport capability', async () => {
    const state = setup();
    state.currentRun.capability = { customerSidecarTransport: true, directTrustedEndpoint: false };
    const directNativeClient = {
      createAuthorization: vi.fn(async () => { throw new Error('direct transport must not be selected'); }),
      deleteAuthorization: vi.fn(), readAuthorization: vi.fn(), listExactAuthorizationIds: vi.fn(),
    };
    const customerSidecarNativeClient = {
      createAuthorization: vi.fn(async () => ({ id: 'sidecar-native-auth-1' })),
      deleteAuthorization: vi.fn(async () => undefined),
      readAuthorization: vi.fn(async () => ({ type: 1, permissions: ['READ'], groupId: 'camunda-operators', resourceType: 6, resourceId: 'payments' })),
      listExactAuthorizationIds: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValue(['sidecar-native-auth-1']),
    };
    const service = new EngineBackstopSyncService({
      runService: state.runService as any,
      taskService: state.taskService as any,
      projectionBuilder: state.projectionBuilder,
      directNativeClient,
      customerSidecarNativeClient,
    });

    await service.apply({
      engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1',
      request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
    });

    expect(customerSidecarNativeClient.createAuthorization).toHaveBeenCalledWith('engine-1', {
      nativeGroupId: 'camunda-operators', camundaResourceType: 6, resourceKey: 'payments',
    });
    expect(directNativeClient.createAuthorization).not.toHaveBeenCalled();
  });

  it.each([
    ['direct', 'direct', { nativeAuthorizationWrite: true, directTrustedEndpoint: true, customerSidecarTransport: false }],
    ['customer-sidecar', 'customer_sidecar', { nativeAuthorizationWrite: true, directTrustedEndpoint: false, customerSidecarTransport: true }],
  ] as const)('records %s transport capability on a newly created preview', async (_caseName, connectionMode, expectedCapability) => {
    const previewRun = run({ id: `${connectionMode}-preview` });
    const createPreview = vi.fn(async (input) => ({ ...previewRun, capability: input.capability }));
    const service = new EngineBackstopSyncService({
      runService: { createPreview, getSummary: vi.fn(), getDetailedSnapshot: vi.fn(), listForEngine: vi.fn(), getLatestSuccessfulApply: vi.fn(), updateRun: vi.fn() } as any,
      taskService: { enqueue: vi.fn(), runNext: vi.fn() } as any,
      projectionBuilder: async () => ({
        engine: {
          id: 'engine-preview', type: 'operaton', lifecycleStatus: 'active', connectionMode,
          baseUrl: 'https://engine.example.test/engine-rest', authType: 'basic', username: 'service-account', passwordEnc: 'encrypted',
          oauthTokenUrl: null, oauthScopes: null, oauthAudience: null,
        },
        tenantId: 'tenant-a', projection: projection(), sourceHash, desiredHash,
        capability: { nativeAuthorizationWrite: true },
      }),
    });

    await service.preview({ engineId: 'engine-preview', tenantId: 'tenant-a' });

    expect(createPreview).toHaveBeenCalledWith(expect.objectContaining({
      capability: expectedCapability,
    }));
  });

  it('rechecks source hashes, creates only exact group READ grants, and records owned native IDs before completing', async () => {
    const state = setup();
    const result = await state.service.apply({
      engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1',
      request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
    });
    expect(state.nativeClient.createAuthorization).toHaveBeenCalledWith('engine-1', {
      nativeGroupId: 'camunda-operators', camundaResourceType: 6, resourceKey: 'payments',
    });
    expect(state.nativeClient.deleteAuthorization).not.toHaveBeenCalled();
    expect(result.run).toMatchObject({ status: 'succeeded', resultHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(state.getDetail().ownedGrants).toEqual([{
      id: 'native-auth-1', nativeGroupId: 'camunda-operators', camundaResourceType: 6, resourceKey: 'payments',
    }]);
  });

  it('reuses the resolved Operaton connection for a native apply instead of looking the engine up again', async () => {
    const state = setup();
    const resolvedEngine = {
      id: 'engine-1', type: 'operaton', lifecycleStatus: 'active', baseUrl: 'https://operaton.example.test/engine-rest',
      connectionMode: 'direct', authType: 'basic', username: 'backstop', passwordEnc: 'encrypted',
      oauthTokenUrl: null, oauthScopes: null, oauthAudience: null,
    } as const;
    state.getDetail().connectionCommitment = engineBackstopConnectionCommitment(resolvedEngine as any);
    const directNativeClient = {
      createAuthorization: vi.fn(async () => { throw new Error('the legacy engine-id lookup must not run'); }),
      deleteAuthorization: vi.fn(async () => undefined),
      readAuthorization: vi.fn(async () => null),
      listExactAuthorizationIds: vi.fn(async () => { throw new Error('the legacy engine-id lookup must not run'); }),
      createAuthorizationWithConnection: vi.fn(async () => ({ id: 'native-auth-connection' })),
      readAuthorizationWithConnection: vi.fn(async () => ({ type: 1, permissions: ['READ'], groupId: 'camunda-operators', resourceType: 6, resourceId: 'payments' })),
      listExactAuthorizationIdsWithConnection: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValue(['native-auth-connection']),
    };
    const projectionBuilder = vi.fn(async () => ({
      engine: resolvedEngine,
      tenantId: 'tenant-a', projection: projection(), sourceHash, desiredHash,
      capability: { nativeAuthorizationWrite: true, directTrustedEndpoint: true },
    }));
    const service = new EngineBackstopSyncService({
      runService: state.runService as any,
      taskService: state.taskService as any,
      directNativeClient,
      projectionBuilder,
    });

    await service.apply({
      engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1',
      request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
    });

    expect(directNativeClient.createAuthorizationWithConnection).toHaveBeenCalledWith(expect.objectContaining({
      id: 'engine-1', baseUrl: 'https://operaton.example.test/engine-rest', authType: 'basic', username: 'backstop', passwordEnc: 'encrypted',
    }), {
      nativeGroupId: 'camunda-operators', camundaResourceType: 6, resourceKey: 'payments',
    });
    expect(directNativeClient.createAuthorization).not.toHaveBeenCalled();
  });

  it('does not reach native transport after source or desired-hash drift', async () => {
    const state = setup({ desiredHash: 'c'.repeat(64) });
    await expect(state.service.apply({
      engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1',
      request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
    })).rejects.toMatchObject({ code: 'ENGINE_BACKSTOP_SOURCE_CHANGED' });
    expect(state.nativeClient.createAuthorization).not.toHaveBeenCalled();
    expect(state.taskService.enqueue).not.toHaveBeenCalled();
  });

  it('allows a secret-only rotation after preview but blocks an authentication-identity change before apply', async () => {
    const secretRotation = setup();
    secretRotation.projectionBuilder.mockResolvedValue({
      engine: { ...engineConnection, passwordEnc: 'ref:file:///rotated/password' },
      tenantId: 'tenant-a', projection: projection(), sourceHash, desiredHash,
      capability: { nativeAuthorizationWrite: true, directTrustedEndpoint: true },
    } as any);
    await expect(secretRotation.service.apply({
      engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1',
      request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
    })).resolves.toMatchObject({ run: { status: 'succeeded' } });

    const identityChange = setup();
    identityChange.projectionBuilder.mockResolvedValue({
      engine: { ...engineConnection, username: 'replacement-principal' },
      tenantId: 'tenant-a', projection: projection(), sourceHash, desiredHash,
      capability: { nativeAuthorizationWrite: true, directTrustedEndpoint: true },
    } as any);
    await expect(identityChange.service.apply({
      engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1',
      request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
    })).rejects.toMatchObject({ code: 'ENGINE_BACKSTOP_SOURCE_CHANGED' });
    expect(identityChange.nativeClient.createAuthorization).not.toHaveBeenCalled();
  });

  it('blocks a shared-engine preview when a native authorization key is active in another tenant', async () => {
    let sharedRun: any;
    let sharedDetail: any;
    const createPreview = vi.fn(async (input) => {
      sharedRun = {
        id: 'shared-preview', ...input, status: 'previewed', resultHash: null, catalogVersion: 'camunda7-operaton-mirrored-backstop-v1',
        counts: {}, classifications: [], rollbackOfRunId: null, observedOfRunId: null, detailedSnapshotAvailable: true,
        detailedSnapshotExpiresAt: Date.now() + 60_000, completedAt: null, createdAt: Date.now(), updatedAt: Date.now(),
      };
      sharedDetail = { version: 1, projection: input.projection, connectionCommitment: input.connectionCommitment };
      return sharedRun;
    });
    const updateRun = vi.fn(async ({ detailedSnapshot, ...values }) => {
      Object.assign(sharedRun, values);
      if (detailedSnapshot !== undefined) sharedDetail = detailedSnapshot;
      return sharedRun;
    });
    const enqueue = vi.fn(async () => ({ id: 'shared-task' }));
    const engine = {
      id: 'shared-engine', type: 'operaton', lifecycleStatus: 'active', tenancyMode: 'shared', tenantId: null,
      connectionMode: 'customer_sidecar', runtimeAccessScope: 'resource_aware',
    };
    const resources = [
      { id: 'resource-a', engineId: 'shared-engine', resourceKind: 'process_definition', resourceKey: 'payments', tenantId: 'tenant-a', isActive: true, tenantResolutionStatus: 'resolved' },
      { id: 'resource-b', engineId: 'shared-engine', resourceKind: 'process_definition', resourceKey: 'payments', tenantId: 'tenant-b', isActive: true, tenantResolutionStatus: 'resolved' },
    ];
    vi.mocked(getDataSource).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return { findOne: vi.fn(async () => engine) };
        if (entity === RbacRole) return { find: vi.fn(async () => [{ id: 'role-a', tenantId: 'tenant-a', kind: 'custom', isArchived: false }]) };
        if (entity === RbacRoleAssignment) return { find: vi.fn(async () => [{
          id: 'assignment-a', tenantId: 'tenant-a', roleId: 'role-a', principalType: 'group', principalId: 'authz-operators',
          expiresAt: null, scopeType: 'engine_runtime_resource', scopeId: 'resource-a',
        }]) };
        if (entity === RbacRolePermission) return { find: vi.fn(async () => [{ roleId: 'role-a', permissionId: 'engine:instance:view' }]) };
        if (entity === RuntimeResource) return { find: vi.fn(async () => resources) };
        if (entity === RuntimeResourceSet || entity === RuntimeResourceSetMaterialization || entity === EngineSet || entity === EngineSetMaterialization) return { find: vi.fn(async () => []) };
        throw new Error('Unexpected repository');
      },
    } as any);
    const directNativeClient = { createAuthorization: vi.fn(), deleteAuthorization: vi.fn(), readAuthorization: vi.fn(), listExactAuthorizationIds: vi.fn(async () => []) };
    const customerSidecarNativeClient = { createAuthorization: vi.fn(), deleteAuthorization: vi.fn(), readAuthorization: vi.fn(), listExactAuthorizationIds: vi.fn(async () => []) };
    const service = new EngineBackstopSyncService({
      mappingService: { activeProjectionMappings: vi.fn(async () => [{ authzGroupId: 'authz-operators', nativeGroupId: 'native-operators', isActive: true }]) },
      runService: {
        createPreview,
        getSummary: vi.fn(async () => sharedRun),
        getDetailedSnapshot: vi.fn(async () => sharedDetail),
        listForEngine: vi.fn(async () => [sharedRun]),
        getLatestSuccessfulApply: vi.fn(async () => null),
        updateRun,
        updateRunWithTaskLease: vi.fn(async ({ taskId: _taskId, leaseId: _leaseId, taskRunId: _taskRunId, ...values }) => updateRun(values)),
      } as any,
      taskService: {
        enqueue,
        runNext: vi.fn(async (execute, { runId }) => {
          await execute({ id: 'shared-task', leaseId: 'shared-lease', engineId: 'shared-engine', tenantId: 'tenant-a', runId, sourceHash: sharedRun.sourceHash, operation: 'apply', assertLease: vi.fn(async () => undefined) });
          return { taskId: 'shared-task', runId, operation: 'apply', status: 'completed', attempts: 0, nextAttemptAt: null, lastError: null };
        }),
      } as any,
      directNativeClient,
      customerSidecarNativeClient,
    });

    const preview = await service.preview({ engineId: 'shared-engine', tenantId: 'tenant-a' });

    expect(createPreview).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      projection: expect.objectContaining({
        desiredGrants: [],
        classifications: [expect.objectContaining({
          disposition: 'blocked', reasonCodes: ['native_authorization_key_cross_tenant'],
        })],
      }),
    }));
    const result = await service.apply({
      engineId: 'shared-engine', tenantId: 'tenant-a', runId: preview.id,
      request: { desiredHash: preview.desiredHash, acknowledgeDirectIdentityBoundary: true },
    });
    expect(result.run.status).toBe('succeeded');
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(directNativeClient.createAuthorization).not.toHaveBeenCalled();
    expect(customerSidecarNativeClient.createAuthorization).not.toHaveBeenCalled();
  });

  it('deletes only an earlier owned authorization when the exact desired grant changes', async () => {
    const previous = { id: 'owned-stale', nativeGroupId: 'camunda-operators', camundaResourceType: 6 as const, resourceKey: 'old-payments' };
    const state = setup({ existingOwned: [previous] });
    await state.service.apply({ engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1', request: { desiredHash, acknowledgeDirectIdentityBoundary: true } });
    expect(state.nativeClient.createAuthorization).toHaveBeenCalledTimes(1);
    expect(state.nativeClient.deleteAuthorization).toHaveBeenCalledWith('engine-1', 'owned-stale');
    expect(state.nativeClient.deleteAuthorization).not.toHaveBeenCalledWith('engine-1', expect.stringContaining('customer'));
  });

  it('retires the prior owned authorization when the canonical projection becomes empty', async () => {
    const previous = { id: 'owned-expired', nativeGroupId: 'camunda-operators', camundaResourceType: 6 as const, resourceKey: 'payments' };
    const state = setup({ builtProjection: emptyProjection(), existingOwned: [previous] });

    await state.service.apply({
      engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1',
      request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
    });

    expect(state.nativeClient.createAuthorization).not.toHaveBeenCalled();
    expect(state.nativeClient.deleteAuthorization).toHaveBeenCalledWith('engine-1', 'owned-expired');
    expect(state.getDetail().ownedGrants).toEqual([]);
  });

  it('filters archived and cross-tenant repository state before building a native projection', async () => {
    const baseline = await previewWithRepositories({});
    expect(baseline.captured.projection.desiredGrants).toHaveLength(1);

    const invalidRoleCases = [
      { role: { isArchived: true } },
      { role: { tenantId: 'tenant-b' } },
      { assignment: { tenantId: 'tenant-b' } },
    ];
    for (const invalid of invalidRoleCases) {
      const result = await previewWithRepositories(invalid);
      expect(result.captured.projection.desiredGrants).toEqual([]);
    }

    const activeResourceSet = await previewWithRepositories({
      assignment: { scopeType: 'engine_runtime_resource_set', scopeId: 'resource-set-a' },
      resourceSets: [{ id: 'resource-set-a', engineId: 'engine-1', tenantId: 'tenant-a', isArchived: false }],
      resourceSetMaterializations: [{ runtimeResourceSetId: 'resource-set-a', runtimeResourceId: 'resource-a' }],
    });
    expect(activeResourceSet.captured.projection.desiredGrants).toHaveLength(1);
    expect(activeResourceSet.repositoryFinds.get(RuntimeResourceSet)).toHaveBeenCalledWith({ where: { engineId: 'engine-1', isArchived: false } });

    for (const resourceSets of [
      [],
      [{ id: 'resource-set-a', engineId: 'engine-1', tenantId: 'tenant-b', isArchived: false }],
    ]) {
      const result = await previewWithRepositories({
        assignment: { scopeType: 'engine_runtime_resource_set', scopeId: 'resource-set-a' },
        resourceSets,
        resourceSetMaterializations: [{ runtimeResourceSetId: 'resource-set-a', runtimeResourceId: 'resource-a' }],
      });
      expect(result.captured.projection.desiredGrants).toEqual([]);
    }

    const activeEngineSet = await previewWithRepositories({
      assignment: { scopeType: 'engine_set', scopeId: 'engine-set-a' },
      engineSets: [{ id: 'engine-set-a', tenantId: 'tenant-a', isArchived: false }],
      engineSetMaterializations: [{ engineSetId: 'engine-set-a', engineId: 'engine-1', tenantId: 'tenant-a' }],
    });
    expect(activeEngineSet.captured.projection.classifications).toHaveLength(1);
    expect(activeEngineSet.repositoryFinds.get(EngineSet)).toHaveBeenCalledWith({ where: { isArchived: false } });

    for (const engineSetCase of [
      { engineSets: [], engineSetMaterializations: [{ engineSetId: 'engine-set-a', engineId: 'engine-1', tenantId: 'tenant-a' }] },
      { engineSets: [{ id: 'engine-set-a', tenantId: 'tenant-b', isArchived: false }], engineSetMaterializations: [{ engineSetId: 'engine-set-a', engineId: 'engine-1', tenantId: 'tenant-a' }] },
      { engineSets: [{ id: 'engine-set-a', tenantId: 'tenant-a', isArchived: false }], engineSetMaterializations: [{ engineSetId: 'engine-set-a', engineId: 'engine-1', tenantId: 'tenant-b' }] },
    ]) {
      const result = await previewWithRepositories({
        assignment: { scopeType: 'engine_set', scopeId: 'engine-set-a' },
        ...engineSetCase,
      });
      expect(result.captured.projection.classifications).toEqual([]);
      expect(result.captured.sourceHash).not.toBe(activeEngineSet.captured.sourceHash);
    }
  });

  it('changes the real projection commitment and removes the desired grant when an assignment expires', async () => {
    const active = await previewWithRepositories({ assignment: { expiresAt: Date.now() + 60_000 } });
    const expired = await previewWithRepositories({ assignment: { expiresAt: Date.now() - 1 } });

    expect(active.captured.projection.desiredGrants).toHaveLength(1);
    expect(expired.captured.projection.desiredGrants).toEqual([]);
    expect(expired.captured.projection.classifications).toEqual([
      expect.objectContaining({ disposition: 'blocked', reasonCodes: ['assignment_expired'] }),
    ]);
    expect(expired.captured.sourceHash).not.toBe(active.captured.sourceHash);
  });

  it('builds the same source commitment when repository materialization order changes', async () => {
    const resources = [
      { id: 'resource-a', engineId: 'engine-1', resourceKind: 'process_definition', resourceKey: 'payments', tenantId: 'tenant-a', isActive: true, tenantResolutionStatus: 'resolved' },
      { id: 'resource-b', engineId: 'engine-1', resourceKind: 'decision_definition', resourceKey: 'credit-score', tenantId: 'tenant-a', isActive: true, tenantResolutionStatus: 'resolved' },
    ];
    const materializations = [
      { runtimeResourceSetId: 'resource-set-a', runtimeResourceId: 'resource-a' },
      { runtimeResourceSetId: 'resource-set-a', runtimeResourceId: 'resource-b' },
    ];
    const common = {
      assignment: { scopeType: 'engine_runtime_resource_set', scopeId: 'resource-set-a' },
      resourceSets: [{ id: 'resource-set-a', engineId: 'engine-1', tenantId: 'tenant-a', isArchived: false }],
    };
    const forward = await previewWithRepositories({ ...common, resources, resourceSetMaterializations: materializations });
    const reversed = await previewWithRepositories({
      ...common, resources: [...resources].reverse(), resourceSetMaterializations: [...materializations].reverse(),
    });

    expect(forward.captured.projection.desiredGrants).toHaveLength(2);
    expect(reversed.captured.projection.desiredGrants).toHaveLength(2);
    expect(reversed.captured.sourceHash).toBe(forward.captured.sourceHash);
    expect(reversed.captured.desiredHash).toBe(forward.captured.desiredHash);
  });

  it('retains a failed delete in durable evidence and retires it on retry without recreating the desired grant', async () => {
    const stale = { id: 'owned-stale', nativeGroupId: 'camunda-operators', camundaResourceType: 6 as const, resourceKey: 'old-payments' };
    const state = setup({ existingOwned: [stale] });
    state.nativeClient.deleteAuthorization.mockRejectedValueOnce(new Error('temporary engine failure')).mockResolvedValue(undefined);

    await expect(state.service.apply({
      engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1',
      request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
    })).rejects.toThrow('temporary engine failure');
    expect(state.getDetail().ownedGrants).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'owned-stale' }), expect.objectContaining({ id: 'native-auth-1' })]));

    await state.service.apply({
      engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1',
      request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
    });
    expect(state.nativeClient.createAuthorization).toHaveBeenCalledTimes(1);
    expect(state.nativeClient.deleteAuthorization).toHaveBeenCalledTimes(2);
    expect(state.getDetail().ownedGrants).toEqual([expect.objectContaining({ id: 'native-auth-1' })]);
  });

  it('resumes a pending delete after lease loss without forgetting the still-recorded native id', async () => {
    const stale = { id: 'owned-stale', nativeGroupId: 'camunda-operators', camundaResourceType: 6 as const, resourceKey: 'old-payments' };
    const state = setup({ existingOwned: [stale] });
    let attempt = 0;
    state.taskService.runNext.mockImplementation(async (execute: any) => {
      attempt += 1;
      let leaseChecks = 0;
      try {
        await execute({
          id: 'task-1', leaseId: `lease-${attempt}`, engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1', sourceHash: state.currentRun.sourceHash, operation: 'apply',
          assertLease: vi.fn(async () => {
            leaseChecks += 1;
            if (attempt === 1 && leaseChecks === 7) throw new EngineBackstopTaskLeaseLostError();
          }),
        });
      } catch (error) {
        if (error instanceof EngineBackstopTaskLeaseLostError) state.currentRun.status = 'failed';
        throw error;
      }
      return { taskId: 'task-1', runId: 'run-1', operation: 'apply', status: 'completed', attempts: 0, nextAttemptAt: null, lastError: null };
    });

    await expect(state.service.apply({ engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1', request: { desiredHash, acknowledgeDirectIdentityBoundary: true } }))
      .rejects.toThrow('lease was lost');
    expect(state.getDetail().ownedGrants).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'owned-stale' })]));

    await state.service.apply({ engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1', request: { desiredHash, acknowledgeDirectIdentityBoundary: true } });
    expect(state.nativeClient.createAuthorization).toHaveBeenCalledTimes(1);
    expect(state.nativeClient.deleteAuthorization).toHaveBeenCalledTimes(2);
    expect(state.getDetail().ownedGrants).toEqual([expect.objectContaining({ id: 'native-auth-1' })]);
  });

  it('retains a timed-out create intent and adopts the uniquely committed native grant on retry', async () => {
    const state = setup();
    let exactAuthorizationIds: string[] = [];
    state.nativeClient.listExactAuthorizationIds.mockImplementation(async () => exactAuthorizationIds);
    state.nativeClient.createAuthorization.mockImplementationOnce(async () => {
      exactAuthorizationIds = ['native-committed-before-timeout'];
      throw new Error('transport timed out after commit');
    });

    await expect(state.service.apply({
      engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1',
      request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
    })).rejects.toThrow('transport timed out after commit');
    expect(state.getDetail().pendingCreate).toEqual([expect.objectContaining({
      nativeGroupId: 'camunda-operators', beforeAuthorizationIds: [],
    })]);

    const retried = await state.service.apply({
      engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1',
      request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
    });

    expect(retried.run.status).toBe('succeeded');
    expect(state.nativeClient.createAuthorization).toHaveBeenCalledTimes(1);
    expect(state.getDetail().pendingCreate).toBeUndefined();
    expect(state.getDetail().ownedGrants).toEqual([expect.objectContaining({ id: 'native-committed-before-timeout' })]);
  });

  it('fails closed and retains the create journal when interrupted-create recovery is ambiguous', async () => {
    const state = setup();
    state.currentRun.status = 'failed';
    Object.assign(state.getDetail(), {
      pendingCreate: [{
        nativeGroupId: 'camunda-operators', camundaResourceType: 6, resourceKey: 'payments', beforeAuthorizationIds: [],
      }],
    });
    state.nativeClient.listExactAuthorizationIds.mockResolvedValue(['native-1', 'native-2']);

    await expect(state.service.apply({
      engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1',
      request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
    })).rejects.toMatchObject({ code: 'ENGINE_BACKSTOP_PREVIEW_NOT_USABLE' });

    expect(state.nativeClient.createAuthorization).not.toHaveBeenCalled();
    expect(state.getDetail().pendingCreate).toHaveLength(1);
  });

  it('never claims a pre-existing authorization id returned by an engine or sidecar', async () => {
    const state = setup();
    state.nativeClient.listExactAuthorizationIds.mockResolvedValue(['manual-native-auth']);
    state.nativeClient.createAuthorization.mockResolvedValue({ id: 'manual-native-auth' });

    await expect(state.service.apply({
      engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1',
      request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
    })).rejects.toMatchObject({ code: 'ENGINE_BACKSTOP_PREVIEW_NOT_USABLE' });

    expect(state.nativeClient.readAuthorization).not.toHaveBeenCalled();
    expect(state.nativeClient.deleteAuthorization).not.toHaveBeenCalled();
    expect(state.getDetail().ownedGrants).toEqual([]);
    expect(state.getDetail().pendingCreate).toHaveLength(1);
  });

  it('retains a non-destructive journal when the returned authorization does not match the exact READ tuple', async () => {
    const state = setup();
    state.nativeClient.listExactAuthorizationIds
      .mockResolvedValueOnce([])
      .mockResolvedValue(['native-auth-untrusted']);
    state.nativeClient.createAuthorization.mockResolvedValue({ id: 'native-auth-untrusted' });
    state.nativeClient.readAuthorization.mockResolvedValue({
      type: 1, permissions: ['DELETE'], groupId: 'camunda-operators', resourceType: 6, resourceId: 'payments',
    });

    await expect(state.service.apply({
      engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1',
      request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
    })).rejects.toMatchObject({ code: 'ENGINE_BACKSTOP_PREVIEW_NOT_USABLE' });

    expect(state.nativeClient.deleteAuthorization).not.toHaveBeenCalled();
    expect(state.getDetail().ownedGrants).toEqual([]);
    expect(state.getDetail().pendingCreate).toHaveLength(1);
  });

  it('does not scan back to an older connection receipt after the latest ownership generation changed', async () => {
    const state = setup();
    const replacementConnection = engineBackstopConnectionCommitment({
      ...engineConnection, baseUrl: 'https://replacement.example.test/engine-rest', updatedAt: 2,
    } as any);
    const latestReplacement = run({ id: 'latest-replacement', status: 'succeeded', createdAt: 300, updatedAt: 300 });
    const olderMatching = run({ id: 'older-matching', status: 'succeeded', createdAt: 200, updatedAt: 200 });
    state.runService.listForEngine.mockResolvedValue([state.currentRun, latestReplacement, olderMatching]);
    state.runService.getLatestSuccessfulApply.mockResolvedValue(latestReplacement);
    state.runService.getDetailedSnapshot.mockImplementation(async (id?: string) => {
      if (id === 'latest-replacement') return {
        version: 1, connectionCommitment: replacementConnection,
        ownedGrants: [{ id: 'replacement-owned', nativeGroupId: 'camunda-operators', camundaResourceType: 6, resourceKey: 'payments' }],
      };
      if (id === 'older-matching') return {
        version: 1, connectionCommitment,
        ownedGrants: [{ id: 'old-matching-owned', nativeGroupId: 'camunda-operators', camundaResourceType: 6, resourceKey: 'payments' }],
      };
      return state.getDetail();
    });

    await expect(state.service.apply({
      engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1',
      request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
    })).rejects.toMatchObject({ code: 'ENGINE_BACKSTOP_SOURCE_CHANGED' });

    expect(state.nativeClient.createAuthorization).not.toHaveBeenCalled();
    expect(state.nativeClient.deleteAuthorization).not.toHaveBeenCalled();
  });

  it('loads the latest ownership apply directly even after more than one hundred observation receipts', async () => {
    const state = setup();
    const prior = run({ id: 'ownership-run', status: 'succeeded', createdAt: 100, updatedAt: 100 });
    const priorOwned = { id: 'owned-native-1', nativeGroupId: 'camunda-operators', camundaResourceType: 6 as const, resourceKey: 'payments' };
    state.runService.listForEngine.mockResolvedValue(Array.from({ length: 100 }, (_, index) => run({
      id: `observation-${index}`, status: 'succeeded', observedOfRunId: 'ownership-run', createdAt: 1_000 - index,
    })));
    state.runService.getLatestSuccessfulApply.mockResolvedValue(prior);
    state.runService.getDetailedSnapshot.mockImplementation(async (id?: string) => id === prior.id
      ? { version: 1, ownershipForRunId: prior.id, connectionCommitment, ownedGrants: [priorOwned] }
      : state.getDetail());

    const result = await state.service.apply({
      engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1',
      request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
    });

    expect(result.run.status).toBe('succeeded');
    expect(state.runService.getLatestSuccessfulApply).toHaveBeenCalledWith({
      engineId: 'engine-1', tenantId: 'tenant-a', excludeRunId: 'run-1',
    });
    expect(state.nativeClient.createAuthorization).not.toHaveBeenCalled();
    expect(state.getDetail().ownedGrants).toEqual([expect.objectContaining({ id: 'owned-native-1' })]);
  });

  it('compensates grants from a failed run before rejecting a source-drifted public retry', async () => {
    const state = setup();
    const created = { id: 'native-created-by-failed-run', nativeGroupId: 'camunda-operators', camundaResourceType: 6 as const, resourceKey: 'payments' };
    state.currentRun.status = 'failed';
    Object.assign(state.getDetail(), { ownedGrants: [created], createdByRun: [created], pendingDelete: [] });
    state.projectionBuilder.mockImplementation(async () => ({
      engine: {
        id: 'engine-1', type: 'operaton', lifecycleStatus: 'active', connectionMode: 'direct',
        baseUrl: 'https://engine.example.test/engine-rest', authType: 'basic', username: 'service-account', passwordEnc: 'encrypted',
        oauthTokenUrl: null, oauthScopes: null, oauthAudience: null,
      },
      tenantId: 'tenant-a', projection: projection('changed-payments'), sourceHash: 'c'.repeat(64), desiredHash: 'd'.repeat(64),
      capability: { nativeAuthorizationWrite: true, directTrustedEndpoint: true },
    } as any));

    await expect(state.service.apply({
      engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1',
      request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
    })).rejects.toMatchObject({ code: 'ENGINE_BACKSTOP_SOURCE_CHANGED' });

    expect(state.taskService.retryNow).toHaveBeenCalledWith('run-1');
    expect(state.nativeClient.deleteAuthorization).toHaveBeenCalledWith('engine-1', created.id);
    expect(state.getDetail().ownedGrants).toEqual([]);
    expect(state.getDetail().createdByRun).toEqual([]);
  });

  it('rolls back only native authorization IDs recorded by the successful backstop run', async () => {
    mockDurableEngineConnection();
    const sourceRun = run({ id: 'source-run', status: 'succeeded', resultHash: 'c'.repeat(64) });
    const rollbackRun = run({ id: 'rollback-run', status: 'previewed', rollbackOfRunId: null });
    const runs = new Map<string, any>([[sourceRun.id, sourceRun], [rollbackRun.id, rollbackRun]]);
    const details = new Map<string, any>([
      [sourceRun.id, { version: 1, projection: projection(), connectionCommitment, ownedGrants: [{ id: 'owned-1', nativeGroupId: 'camunda-operators', camundaResourceType: 6, resourceKey: 'payments' }] }],
    ]);
    const runService = {
      createPreview: vi.fn(async () => rollbackRun),
      getSummary: vi.fn(async (id) => runs.get(id) || null),
      getDetailedSnapshot: vi.fn(async (id) => details.get(id) || null),
      listForEngine: vi.fn(async () => [...runs.values()]),
      getLatestSuccessfulApply: vi.fn(async () => null),
      updateRun: vi.fn(async ({ id, detailedSnapshot, ...values }) => {
        const target = runs.get(id);
        Object.assign(target, values);
        if (detailedSnapshot !== undefined) details.set(id, detailedSnapshot);
        return target;
      }),
    };
    (runService as any).updateRunWithTaskLease = vi.fn(async ({ taskId: _taskId, leaseId: _leaseId, taskRunId: _taskRunId, ...values }) => runService.updateRun(values));
    const nativeClient = { createAuthorization: vi.fn(), deleteAuthorization: vi.fn(async () => undefined), readAuthorization: vi.fn(), listExactAuthorizationIds: vi.fn(async () => []) };
    const taskService = {
      enqueue: vi.fn(async () => ({ id: 'task-rollback' })),
      runNext: vi.fn(async (execute) => {
        await execute({ id: 'task-rollback', leaseId: 'lease-rollback', engineId: 'engine-1', tenantId: 'tenant-a', runId: 'rollback-run', sourceHash, operation: 'rollback', assertLease: vi.fn(async () => undefined) });
        return { taskId: 'task-rollback', runId: 'rollback-run', operation: 'rollback', status: 'completed', attempts: 0, nextAttemptAt: null, lastError: null };
      }),
    };
    const service = new EngineBackstopSyncService({ runService: runService as any, taskService: taskService as any, nativeClient });

    const result = await service.rollback({ engineId: 'engine-1', tenantId: 'tenant-a', runId: 'source-run', request: { acknowledgeOwnedGrantDeletion: true } });
    expect(nativeClient.createAuthorization).not.toHaveBeenCalled();
    expect(nativeClient.deleteAuthorization).toHaveBeenCalledTimes(1);
    expect(nativeClient.deleteAuthorization).toHaveBeenCalledWith('engine-1', 'owned-1');
    expect(result.run).toMatchObject({ id: 'rollback-run', status: 'rolled_back', rollbackOfRunId: 'source-run' });
    expect(sourceRun.status).toBe('rolled_back');
  });

  it.each(['rollback', 'drift_check'] as const)('blocks %s before native I/O when the authentication identity changed', async (operation) => {
    mockDurableEngineConnection({ ...engineConnection, username: 'replacement-principal' });
    const sourceRun = run({ id: 'source-run', status: 'succeeded', resultHash: 'c'.repeat(64) });
    const operationRun = run({ id: `${operation}-run`, status: 'previewed' });
    const runs = new Map<string, any>([[sourceRun.id, sourceRun], [operationRun.id, operationRun]]);
    const details = new Map<string, any>([[sourceRun.id, {
      version: 1, projection: projection(), connectionCommitment,
      ownedGrants: [{ id: 'owned-1', nativeGroupId: 'camunda-operators', camundaResourceType: 6, resourceKey: 'payments' }],
    }]]);
    const runService = {
      createPreview: vi.fn(async () => operationRun),
      getSummary: vi.fn(async (id) => runs.get(id) || null),
      getDetailedSnapshot: vi.fn(async (id) => details.get(id) || null),
      listForEngine: vi.fn(async () => [...runs.values()]),
      getLatestSuccessfulApply: vi.fn(async () => null),
      updateRun: vi.fn(async ({ id, detailedSnapshot, ...values }) => {
        const target = runs.get(id);
        Object.assign(target, values);
        if (detailedSnapshot !== undefined) details.set(id, detailedSnapshot);
        return target;
      }),
    };
    (runService as any).updateRunWithTaskLease = vi.fn(async ({ taskId: _taskId, leaseId: _leaseId, taskRunId: _taskRunId, ...values }) => runService.updateRun(values));
    const nativeClient = {
      createAuthorization: vi.fn(), deleteAuthorization: vi.fn(), readAuthorization: vi.fn(), listExactAuthorizationIds: vi.fn(),
    };
    const taskService = {
      enqueue: vi.fn(async () => ({ id: `task-${operation}` })),
      runNext: vi.fn(async (execute) => {
        await execute({
          id: `task-${operation}`, leaseId: `lease-${operation}`, engineId: 'engine-1', tenantId: 'tenant-a', runId: operationRun.id,
          sourceHash, operation, assertLease: vi.fn(async () => undefined),
        });
        return { taskId: `task-${operation}`, runId: operationRun.id, operation, status: 'completed', attempts: 0, nextAttemptAt: null, lastError: null };
      }),
    };
    const service = new EngineBackstopSyncService({ runService: runService as any, taskService: taskService as any, nativeClient });

    const action = operation === 'rollback'
      ? service.rollback({ engineId: 'engine-1', tenantId: 'tenant-a', runId: sourceRun.id, request: { acknowledgeOwnedGrantDeletion: true } })
      : service.driftCheck({ engineId: 'engine-1', tenantId: 'tenant-a', runId: sourceRun.id });
    await expect(action).rejects.toMatchObject({ code: 'ENGINE_BACKSTOP_SOURCE_CHANGED' });
    expect(nativeClient.deleteAuthorization).not.toHaveBeenCalled();
    expect(nativeClient.readAuthorization).not.toHaveBeenCalled();
  });

  it('retries a partially failed rollback without leaving the remaining native grant active', async () => {
    mockDurableEngineConnection();
    const sourceRun = run({ id: 'source-run', status: 'succeeded', resultHash: 'c'.repeat(64) });
    const ownedGrants = [
      { id: 'owned-1', nativeGroupId: 'camunda-operators', camundaResourceType: 6, resourceKey: 'payments' },
      { id: 'owned-2', nativeGroupId: 'camunda-operators', camundaResourceType: 6, resourceKey: 'refunds' },
    ];
    const runs = new Map<string, any>([[sourceRun.id, sourceRun]]);
    const details = new Map<string, any>([[sourceRun.id, { version: 1, projection: projection(), connectionCommitment, ownedGrants }]]);
    let rollbackNumber = 0;
    let currentRollbackId = '';
    const runService = {
      createPreview: vi.fn(async () => {
        currentRollbackId = `rollback-run-${++rollbackNumber}`;
        const created = run({ id: currentRollbackId, status: 'previewed', rollbackOfRunId: null });
        runs.set(created.id, created);
        return created;
      }),
      getSummary: vi.fn(async (id) => runs.get(id) || null),
      getDetailedSnapshot: vi.fn(async (id) => details.get(id) || null),
      listForEngine: vi.fn(async () => [...runs.values()]),
      getLatestSuccessfulApply: vi.fn(async () => null),
      updateRun: vi.fn(async ({ id, detailedSnapshot, ...values }) => {
        const target = runs.get(id);
        Object.assign(target, values);
        if (detailedSnapshot !== undefined) details.set(id, detailedSnapshot);
        return target;
      }),
    };
    (runService as any).updateRunWithTaskLease = vi.fn(async ({ taskId: _taskId, leaseId: _leaseId, taskRunId: _taskRunId, ...values }) => runService.updateRun(values));
    let failSecondGrantOnce = true;
    const deleted = new Set<string>();
    const nativeClient = {
      createAuthorization: vi.fn(),
      deleteAuthorization: vi.fn(async (_engineId: string, authorizationId: string) => {
        if (authorizationId === 'owned-2' && failSecondGrantOnce) {
          failSecondGrantOnce = false;
          throw new Error('temporary engine failure');
        }
        // The adapter contract treats an already-absent ID as success.
        deleted.add(authorizationId);
      }),
      readAuthorization: vi.fn(),
      listExactAuthorizationIds: vi.fn(async () => []),
    };
    const taskService = {
      enqueue: vi.fn(async () => ({ id: `task-${currentRollbackId}` })),
      runNext: vi.fn(async (execute) => {
        await execute({
          id: `task-${currentRollbackId}`, leaseId: `lease-${currentRollbackId}`, engineId: 'engine-1', tenantId: 'tenant-a', runId: currentRollbackId,
          sourceHash, operation: 'rollback', assertLease: vi.fn(async () => undefined),
        });
        return { taskId: `task-${currentRollbackId}`, runId: currentRollbackId, operation: 'rollback', status: 'completed', attempts: 0, nextAttemptAt: null, lastError: null };
      }),
    };
    const service = new EngineBackstopSyncService({ runService: runService as any, taskService: taskService as any, nativeClient });

    await expect(service.rollback({
      engineId: 'engine-1', tenantId: 'tenant-a', runId: sourceRun.id,
      request: { acknowledgeOwnedGrantDeletion: true },
    })).rejects.toThrow('temporary engine failure');
    expect(details.get('rollback-run-1').ownedGrants).toEqual([expect.objectContaining({ id: 'owned-2' })]);

    const retried = await service.rollback({
      engineId: 'engine-1', tenantId: 'tenant-a', runId: sourceRun.id,
      request: { acknowledgeOwnedGrantDeletion: true },
    });

    expect(deleted).toEqual(new Set(['owned-1', 'owned-2']));
    expect(details.get('rollback-run-2').ownedGrants).toEqual([]);
    expect(retried.run).toMatchObject({ id: 'rollback-run-2', status: 'rolled_back' });
  });

  it.each([
    ['an unchanged owned grant', { type: 1, permissions: ['READ'], groupId: 'camunda-operators', resourceType: 6, resourceId: 'payments' }, 'succeeded'],
    ['an altered owned grant', { type: 1, permissions: ['READ'], groupId: 'camunda-operators', resourceType: 6, resourceId: 'changed-payments' }, 'out_of_sync'],
    ['a missing owned grant', null, 'out_of_sync'],
  ])('creates a separate read-only receipt for %s', async (_caseName, nativeGrant, expectedStatus) => {
    mockDurableEngineConnection();
    const sourceRun = run({ id: 'source-run', status: 'succeeded', resultHash: 'c'.repeat(64) });
    const observationRun = run({ id: 'observation-run', status: 'previewed' });
    const runs = new Map<string, any>([[sourceRun.id, sourceRun], [observationRun.id, observationRun]]);
    const details = new Map<string, any>([
      [sourceRun.id, { version: 1, projection: projection(), connectionCommitment, ownedGrants: [{ id: 'owned-1', nativeGroupId: 'camunda-operators', camundaResourceType: 6, resourceKey: 'payments' }] }],
    ]);
    const runService = {
      createPreview: vi.fn(async () => observationRun),
      getSummary: vi.fn(async (id) => runs.get(id) || null),
      getDetailedSnapshot: vi.fn(async (id) => details.get(id) || null),
      listForEngine: vi.fn(async () => [...runs.values()]),
      getLatestSuccessfulApply: vi.fn(async () => null),
      updateRun: vi.fn(async ({ id, detailedSnapshot, ...values }) => {
        const target = runs.get(id);
        Object.assign(target, values);
        if (detailedSnapshot !== undefined) details.set(id, detailedSnapshot);
        return target;
      }),
    };
    (runService as any).updateRunWithTaskLease = vi.fn(async ({ taskId: _taskId, leaseId: _leaseId, taskRunId: _taskRunId, ...values }) => runService.updateRun(values));
    const nativeClient = {
      createAuthorization: vi.fn(), deleteAuthorization: vi.fn(),
      readAuthorization: vi.fn(async () => nativeGrant),
      listExactAuthorizationIds: vi.fn(async () => []),
    };
    const taskService = {
      enqueue: vi.fn(async () => ({ id: 'task-drift' })),
      runNext: vi.fn(async (execute) => {
        await execute({ id: 'task-drift', leaseId: 'lease-drift', engineId: 'engine-1', tenantId: 'tenant-a', runId: 'observation-run', sourceHash, operation: 'drift_check', assertLease: vi.fn(async () => undefined) });
        return { taskId: 'task-drift', runId: 'observation-run', operation: 'drift_check', status: 'completed', attempts: 0, nextAttemptAt: null, lastError: null };
      }),
    };
    const service = new EngineBackstopSyncService({ runService: runService as any, taskService: taskService as any, nativeClient });

    const result = await service.driftCheck({ engineId: 'engine-1', tenantId: 'tenant-a', runId: 'source-run' });

    expect(nativeClient.readAuthorization).toHaveBeenCalledWith('engine-1', 'owned-1');
    expect(nativeClient.createAuthorization).not.toHaveBeenCalled();
    expect(nativeClient.deleteAuthorization).not.toHaveBeenCalled();
    expect(result.run).toMatchObject({ id: 'observation-run', status: expectedStatus, observedOfRunId: 'source-run' });
  });
});

describe('CamundaCompatibleBackstopNativeClient', () => {
  it('uses only compatible authorization create and ID-specific read/delete endpoints', async () => {
    vi.mocked(camundaGet).mockResolvedValue({ id: 'native-auth-1' });
    vi.mocked(camundaPost).mockResolvedValue({ id: 'native-auth-1' });
    vi.mocked(camundaDelete).mockResolvedValue(undefined as never);
    const client = new CamundaCompatibleBackstopNativeClient();
    await expect(client.createAuthorization('engine-1', { nativeGroupId: 'operators', camundaResourceType: 10, resourceKey: 'credit-score' }))
      .resolves.toEqual({ id: 'native-auth-1' });
    await client.deleteAuthorization('engine-1', 'native auth/1');
    await client.readAuthorization('engine-1', 'native auth/1');
    expect(camundaPost).toHaveBeenCalledWith('engine-1', '/authorization/create', {
      type: 1, permissions: ['READ'], groupId: 'operators', resourceType: 10, resourceId: 'credit-score',
    });
    expect(camundaDelete).toHaveBeenCalledWith('engine-1', '/authorization/native%20auth%2F1');
    expect(camundaGet).toHaveBeenCalledWith('engine-1', '/authorization/native%20auth%2F1');
  });

  it('uses the same bounded authorization contract through the generic customer-sidecar adapter', async () => {
    vi.mocked(camundaPost).mockResolvedValue({ id: 'native-auth-sidecar' });
    const client = new CustomerSidecarBackstopNativeClient();

    await expect(client.createAuthorization('engine-sidecar', { nativeGroupId: 'operators', camundaResourceType: 6, resourceKey: 'payments' }))
      .resolves.toEqual({ id: 'native-auth-sidecar' });

    expect(camundaPost).toHaveBeenCalledWith('engine-sidecar', '/authorization/create', {
      type: 1, permissions: ['READ'], groupId: 'operators', resourceType: 6, resourceId: 'payments',
    });
  });

  it.each([
    ['direct', new CamundaCompatibleBackstopNativeClient()],
    ['customer sidecar', new CustomerSidecarBackstopNativeClient()],
  ])('rejects a %s exact-match recovery response above the 1,000-row contract limit', async (_transport, client) => {
    vi.mocked(camundaGet).mockResolvedValue(Array.from({ length: 1_001 }, (_, index) => ({
      id: `native-${index}`, type: 1, permissions: ['READ'], groupId: 'operators', resourceType: 6, resourceId: 'payments',
    })));

    await expect(client.listExactAuthorizationIds('engine-1', {
      nativeGroupId: 'operators', camundaResourceType: 6, resourceKey: 'payments',
    })).rejects.toThrow('exceeded the safety limit');
  });

  it('treats only a compatible-engine 404 as absent when checking an owned authorization', async () => {
    vi.mocked(camundaGet).mockRejectedValue(new BpmnEngineOperationError({ method: 'GET', path: '/authorization/missing-authorization', status: 404 }) as never);
    const client = new CustomerSidecarBackstopNativeClient();

    await expect(client.readAuthorization('engine-sidecar', 'missing-authorization')).resolves.toBeNull();
    expect(camundaGet).toHaveBeenCalledWith('engine-sidecar', '/authorization/missing-authorization');
  });

  it('treats a compatible-engine 404 delete as an idempotent success for fenced retries', async () => {
    vi.mocked(camundaDelete).mockRejectedValue(new BpmnEngineOperationError({ method: 'DELETE', path: '/authorization/already-absent', status: 404 }) as never);
    const client = new CamundaCompatibleBackstopNativeClient();

    await expect(client.deleteAuthorization('engine-1', 'already-absent')).resolves.toBeUndefined();
    expect(camundaDelete).toHaveBeenCalledWith('engine-1', '/authorization/already-absent');
  });
});
