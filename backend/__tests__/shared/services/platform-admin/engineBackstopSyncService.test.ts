import { describe, expect, it, vi } from 'vitest';
import { CamundaCompatibleBackstopNativeClient, CustomerSidecarBackstopNativeClient, EngineBackstopSyncService } from '@enterpriseglue/shared/services/platform-admin/EngineBackstopSyncService.js';
import { BpmnEngineOperationError, camundaDelete, camundaGet, camundaPost } from '@enterpriseglue/shared/services/bpmn-engine-client.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSetMaterialization.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
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
  let detail: any = { version: 1, projection: input.builtProjection || projection(), ownedGrants: input.existingOwned || [] };
  const runService = {
    createPreview: vi.fn(),
    getSummary: vi.fn(async () => currentRun),
    getDetailedSnapshot: vi.fn(async () => detail),
    listForEngine: vi.fn(async () => [currentRun]),
    updateRun: vi.fn(async (values) => {
      Object.assign(currentRun, values);
      if (values.detailedSnapshot !== undefined) detail = values.detailedSnapshot;
      return currentRun;
    }),
  };
  const taskService = {
    enqueue: vi.fn(async () => ({ id: 'task-1' })),
    runNext: vi.fn(async (execute) => {
      await execute({ id: 'task-1', engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1', sourceHash: currentRun.sourceHash, operation: 'apply' });
      return { taskId: 'task-1', runId: 'run-1', operation: 'apply', status: 'completed', attempts: 0, nextAttemptAt: null, lastError: null };
    }),
  };
  const nativeClient = {
    createAuthorization: vi.fn(async () => ({ id: 'native-auth-1' })),
    deleteAuthorization: vi.fn(async () => undefined),
    readAuthorization: vi.fn(async () => ({ type: 1, permissions: ['READ'], groupId: 'camunda-operators', resourceType: 6, resourceId: 'payments' })),
  };
  const projectionBuilder = vi.fn(async () => ({
    engine: { id: 'engine-1', type: 'camunda7', lifecycleStatus: 'active', connectionMode: 'direct' }, tenantId: 'tenant-a',
    projection: input.builtProjection || projection(), sourceHash: input.sourceHash || sourceHash, desiredHash: input.desiredHash || desiredHash,
    capability: { nativeAuthorizationWrite: true, directTrustedEndpoint: true },
  }));
  return { service: new EngineBackstopSyncService({ runService: runService as any, taskService: taskService as any, nativeClient, projectionBuilder }), currentRun, runService, taskService, nativeClient, projectionBuilder, getDetail: () => detail };
}

describe('EngineBackstopSyncService', () => {
  it('selects the customer-sidecar adapter from the previewed transport capability', async () => {
    const state = setup();
    state.currentRun.capability = { customerSidecarTransport: true, directTrustedEndpoint: false };
    const directNativeClient = {
      createAuthorization: vi.fn(async () => { throw new Error('direct transport must not be selected'); }),
      deleteAuthorization: vi.fn(), readAuthorization: vi.fn(),
    };
    const customerSidecarNativeClient = {
      createAuthorization: vi.fn(async () => ({ id: 'sidecar-native-auth-1' })),
      deleteAuthorization: vi.fn(async () => undefined),
      readAuthorization: vi.fn(),
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
      runService: { createPreview, getSummary: vi.fn(), getDetailedSnapshot: vi.fn(), listForEngine: vi.fn(), updateRun: vi.fn() } as any,
      taskService: { enqueue: vi.fn(), runNext: vi.fn() } as any,
      projectionBuilder: async () => ({
        engine: { id: 'engine-preview', type: 'operaton', lifecycleStatus: 'active', connectionMode } as any,
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
    const directNativeClient = {
      createAuthorization: vi.fn(async () => { throw new Error('the legacy engine-id lookup must not run'); }),
      deleteAuthorization: vi.fn(async () => undefined),
      readAuthorization: vi.fn(async () => null),
      createAuthorizationWithConnection: vi.fn(async () => ({ id: 'native-auth-connection' })),
    };
    const projectionBuilder = vi.fn(async () => ({
      engine: {
        id: 'engine-1', type: 'operaton', lifecycleStatus: 'active', baseUrl: 'https://operaton.example.test/engine-rest',
        connectionMode: 'direct', authType: 'basic', username: 'backstop', passwordEnc: 'encrypted',
        oauthTokenUrl: null, oauthScopes: null, oauthAudience: null,
      },
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

  it('blocks a shared-engine preview when a native authorization key is active in another tenant', async () => {
    const createPreview = vi.fn(async (input) => ({ id: 'shared-preview', ...input, status: 'previewed' }));
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
        if (entity === RbacRoleAssignment) return { find: vi.fn(async () => [{
          id: 'assignment-a', tenantId: 'tenant-a', roleId: 'role-a', principalType: 'group', principalId: 'authz-operators',
          expiresAt: null, scopeType: 'engine_runtime_resource', scopeId: 'resource-a',
        }]) };
        if (entity === RbacRolePermission) return { find: vi.fn(async () => [{ roleId: 'role-a', permissionId: 'engine:instance:view' }]) };
        if (entity === RuntimeResource) return { find: vi.fn(async () => resources) };
        if (entity === RuntimeResourceSetMaterialization || entity === EngineSetMaterialization) return { find: vi.fn(async () => []) };
        throw new Error('Unexpected repository');
      },
    } as any);
    const service = new EngineBackstopSyncService({
      mappingService: { activeProjectionMappings: vi.fn(async () => [{ authzGroupId: 'authz-operators', nativeGroupId: 'native-operators', isActive: true }]) },
      runService: { createPreview, getSummary: vi.fn(), getDetailedSnapshot: vi.fn(), listForEngine: vi.fn(), updateRun: vi.fn() } as any,
      taskService: { enqueue: vi.fn(), runNext: vi.fn() } as any,
    });

    await service.preview({ engineId: 'shared-engine', tenantId: 'tenant-a' });

    expect(createPreview).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      projection: expect.objectContaining({
        desiredGrants: [],
        classifications: [expect.objectContaining({
          disposition: 'blocked', reasonCodes: ['native_authorization_key_cross_tenant'],
        })],
      }),
    }));
  });

  it('deletes only an earlier owned authorization when the exact desired grant changes', async () => {
    const previous = { id: 'owned-stale', nativeGroupId: 'camunda-operators', camundaResourceType: 6 as const, resourceKey: 'old-payments' };
    const state = setup({ existingOwned: [previous] });
    await state.service.apply({ engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1', request: { desiredHash, acknowledgeDirectIdentityBoundary: true } });
    expect(state.nativeClient.createAuthorization).toHaveBeenCalledTimes(1);
    expect(state.nativeClient.deleteAuthorization).toHaveBeenCalledWith('engine-1', 'owned-stale');
    expect(state.nativeClient.deleteAuthorization).not.toHaveBeenCalledWith('engine-1', expect.stringContaining('customer'));
  });

  it('rolls back only native authorization IDs recorded by the successful backstop run', async () => {
    const sourceRun = run({ id: 'source-run', status: 'succeeded', resultHash: 'c'.repeat(64) });
    const rollbackRun = run({ id: 'rollback-run', status: 'previewed', rollbackOfRunId: null });
    const runs = new Map<string, any>([[sourceRun.id, sourceRun], [rollbackRun.id, rollbackRun]]);
    const details = new Map<string, any>([
      [sourceRun.id, { version: 1, projection: projection(), ownedGrants: [{ id: 'owned-1', nativeGroupId: 'camunda-operators', camundaResourceType: 6, resourceKey: 'payments' }] }],
    ]);
    const runService = {
      createPreview: vi.fn(async () => rollbackRun),
      getSummary: vi.fn(async (id) => runs.get(id) || null),
      getDetailedSnapshot: vi.fn(async (id) => details.get(id) || null),
      listForEngine: vi.fn(async () => [...runs.values()]),
      updateRun: vi.fn(async ({ id, detailedSnapshot, ...values }) => {
        const target = runs.get(id);
        Object.assign(target, values);
        if (detailedSnapshot !== undefined) details.set(id, detailedSnapshot);
        return target;
      }),
    };
    const nativeClient = { createAuthorization: vi.fn(), deleteAuthorization: vi.fn(async () => undefined), readAuthorization: vi.fn() };
    const taskService = {
      enqueue: vi.fn(async () => ({ id: 'task-rollback' })),
      runNext: vi.fn(async (execute) => {
        await execute({ id: 'task-rollback', engineId: 'engine-1', tenantId: 'tenant-a', runId: 'rollback-run', sourceHash, operation: 'rollback' });
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

  it.each([
    ['an unchanged owned grant', { type: 1, permissions: ['READ'], groupId: 'camunda-operators', resourceType: 6, resourceId: 'payments' }, 'succeeded'],
    ['an altered owned grant', { type: 1, permissions: ['READ'], groupId: 'camunda-operators', resourceType: 6, resourceId: 'changed-payments' }, 'out_of_sync'],
    ['a missing owned grant', null, 'out_of_sync'],
  ])('creates a separate read-only receipt for %s', async (_caseName, nativeGrant, expectedStatus) => {
    const sourceRun = run({ id: 'source-run', status: 'succeeded', resultHash: 'c'.repeat(64) });
    const observationRun = run({ id: 'observation-run', status: 'previewed' });
    const runs = new Map<string, any>([[sourceRun.id, sourceRun], [observationRun.id, observationRun]]);
    const details = new Map<string, any>([
      [sourceRun.id, { version: 1, projection: projection(), ownedGrants: [{ id: 'owned-1', nativeGroupId: 'camunda-operators', camundaResourceType: 6, resourceKey: 'payments' }] }],
    ]);
    const runService = {
      createPreview: vi.fn(async () => observationRun),
      getSummary: vi.fn(async (id) => runs.get(id) || null),
      getDetailedSnapshot: vi.fn(async (id) => details.get(id) || null),
      listForEngine: vi.fn(async () => [...runs.values()]),
      updateRun: vi.fn(async ({ id, detailedSnapshot, ...values }) => {
        const target = runs.get(id);
        Object.assign(target, values);
        if (detailedSnapshot !== undefined) details.set(id, detailedSnapshot);
        return target;
      }),
    };
    const nativeClient = {
      createAuthorization: vi.fn(), deleteAuthorization: vi.fn(),
      readAuthorization: vi.fn(async () => nativeGrant),
    };
    const taskService = {
      enqueue: vi.fn(async () => ({ id: 'task-drift' })),
      runNext: vi.fn(async (execute) => {
        await execute({ id: 'task-drift', engineId: 'engine-1', tenantId: 'tenant-a', runId: 'observation-run', sourceHash, operation: 'drift_check' });
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

  it('treats only a compatible-engine 404 as absent when checking an owned authorization', async () => {
    vi.mocked(camundaGet).mockRejectedValue(new BpmnEngineOperationError({ method: 'GET', path: '/authorization/missing-authorization', status: 404 }) as never);
    const client = new CustomerSidecarBackstopNativeClient();

    await expect(client.readAuthorization('engine-sidecar', 'missing-authorization')).resolves.toBeNull();
    expect(camundaGet).toHaveBeenCalledWith('engine-sidecar', '/authorization/missing-authorization');
  });
});
