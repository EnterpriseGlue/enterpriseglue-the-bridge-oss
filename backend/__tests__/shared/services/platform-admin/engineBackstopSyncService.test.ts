import { describe, expect, it, vi } from 'vitest';
import { Camunda7BackstopNativeClient, EngineBackstopSyncService } from '@enterpriseglue/shared/services/platform-admin/EngineBackstopSyncService.js';
import { camundaDelete, camundaPost } from '@enterpriseglue/shared/services/bpmn-engine-client.js';

vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', () => ({
  camundaPost: vi.fn(),
  camundaDelete: vi.fn(),
}));

const sourceHash = 'a'.repeat(64);
const desiredHash = 'b'.repeat(64);

function projection(resourceKey = 'payments') {
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
    catalogVersion: 'camunda7-mirrored-backstop-v1', capability: {}, counts: {}, classifications: [], rollbackOfRunId: null,
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
  const nativeClient = { createAuthorization: vi.fn(async () => ({ id: 'native-auth-1' })), deleteAuthorization: vi.fn(async () => undefined) };
  const projectionBuilder = vi.fn(async () => ({
    engine: { id: 'engine-1', type: 'camunda7', lifecycleStatus: 'active' }, tenantId: 'tenant-a',
    projection: input.builtProjection || projection(), sourceHash: input.sourceHash || sourceHash, desiredHash: input.desiredHash || desiredHash,
    capability: { nativeAuthorizationWrite: true, directTrustedEndpoint: true },
  }));
  return { service: new EngineBackstopSyncService({ runService: runService as any, taskService: taskService as any, nativeClient, projectionBuilder }), currentRun, runService, taskService, nativeClient, projectionBuilder, getDetail: () => detail };
}

describe('EngineBackstopSyncService', () => {
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

  it('does not reach native transport after source or desired-hash drift', async () => {
    const state = setup({ desiredHash: 'c'.repeat(64) });
    await expect(state.service.apply({
      engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1',
      request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
    })).rejects.toMatchObject({ code: 'ENGINE_BACKSTOP_SOURCE_CHANGED' });
    expect(state.nativeClient.createAuthorization).not.toHaveBeenCalled();
    expect(state.taskService.enqueue).not.toHaveBeenCalled();
  });

  it('deletes only an earlier owned authorization when the exact desired grant changes', async () => {
    const previous = { id: 'owned-stale', nativeGroupId: 'camunda-operators', camundaResourceType: 6 as const, resourceKey: 'old-payments' };
    const state = setup({ existingOwned: [previous] });
    await state.service.apply({ engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1', request: { desiredHash, acknowledgeDirectIdentityBoundary: true } });
    expect(state.nativeClient.createAuthorization).toHaveBeenCalledTimes(1);
    expect(state.nativeClient.deleteAuthorization).toHaveBeenCalledWith('engine-1', 'owned-stale');
    expect(state.nativeClient.deleteAuthorization).not.toHaveBeenCalledWith('engine-1', expect.stringContaining('customer'));
  });
});

describe('Camunda7BackstopNativeClient', () => {
  it('uses only Camunda authorization create and id-specific delete endpoints', async () => {
    vi.mocked(camundaPost).mockResolvedValue({ id: 'native-auth-1' });
    vi.mocked(camundaDelete).mockResolvedValue(undefined as never);
    const client = new Camunda7BackstopNativeClient();
    await expect(client.createAuthorization('engine-1', { nativeGroupId: 'operators', camundaResourceType: 10, resourceKey: 'credit-score' }))
      .resolves.toEqual({ id: 'native-auth-1' });
    await client.deleteAuthorization('engine-1', 'native auth/1');
    expect(camundaPost).toHaveBeenCalledWith('engine-1', '/authorization/create', {
      type: 1, permissions: ['READ'], groupId: 'operators', resourceType: 10, resourceId: 'credit-score',
    });
    expect(camundaDelete).toHaveBeenCalledWith('engine-1', '/authorization/native%20auth%2F1');
  });
});
