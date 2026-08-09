import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EngineBackstopSyncRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineBackstopSyncRun.js';
import { EngineBackstopSyncTask } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineBackstopSyncTask.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineBackstopSyncRunService } from '@enterpriseglue/shared/services/platform-admin/EngineBackstopSyncRunService.js';
import type { EngineBackstopProjection } from '@enterpriseglue/shared/schemas/platform-admin/engine-backstop.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/encryption.js', () => ({
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
  decrypt: vi.fn((value: string) => value.replace('encrypted:', '')),
  hash: vi.fn((value: string) => value.includes('assignment-1') ? 'a'.repeat(64) : value.includes('camunda-operators') ? 'b'.repeat(64) : 'c'.repeat(64)),
  blindIndex: vi.fn((_domain: string, value: string) => value.includes('assignment-1') ? 'a'.repeat(64) : value.includes('camunda-operators') ? 'b'.repeat(64) : 'c'.repeat(64)),
}));

const service = new EngineBackstopSyncRunService();

function projection(): EngineBackstopProjection {
  return {
    classifications: [{
      sourceAssignmentId: 'assignment-1', principalType: 'group', disposition: 'proposed', reasonCodes: ['exact_group_read_projected'],
      resourceKind: 'process_definition', resourceKey: 'payments', nativeGroupId: 'camunda-operators', camundaResourceType: 6, permissions: ['READ'],
    }],
    desiredGrants: [{
      nativeGroupId: 'camunda-operators', resourceKind: 'process_definition', resourceKey: 'payments', camundaResourceType: 6, permissions: ['READ'], sourceAssignmentIds: ['assignment-1'],
    }],
  };
}

function setup(engineActive = true) {
  const rows: any[] = [];
  const tasks: any[] = [];
  const matches = (row: any, criteria: any) => Object.entries(criteria).every(([key, expected]: [string, any]) => {
    if (expected?._type === 'moreThan') return row[key] !== null && row[key] > Number(expected._value);
    if (expected?._type === 'lessThanOrEqual') return row[key] !== null && row[key] <= Number(expected._value);
    if (expected?._type === 'not') return row[key] !== null && row[key] !== undefined;
    return row[key] === expected;
  });
  const repository = {
    insert: vi.fn(async (row) => rows.push(row)),
    findOne: vi.fn(async ({ where }) => rows.find((row) => row.id === where.id) || null),
    find: vi.fn(async () => [...rows]),
    update: vi.fn(async (criteria, values) => {
      const matched = rows.filter((row) => matches(row, criteria));
      matched.forEach((row) => Object.assign(row, values));
      return { affected: matched.length };
    }),
  };
  const taskRepository = {
    update: vi.fn(async (criteria, values) => {
      const matched = tasks.filter((row) => matches(row, criteria));
      matched.forEach((row) => Object.assign(row, values));
      return { affected: matched.length };
    }),
  };
  const engineRepository = { update: vi.fn().mockResolvedValue({ affected: engineActive ? 1 : 0 }) };
  const getRepository = (entity: unknown) => {
    if (entity === EngineBackstopSyncRun) return repository;
    if (entity === EngineBackstopSyncTask) return taskRepository;
    if (entity === Engine) return engineRepository;
    throw new Error('Unexpected repository');
  };
  const dataSource = {
    getRepository,
    transaction: async (callback: (manager: { getRepository: typeof getRepository }) => unknown) => callback({ getRepository }),
  };
  (getDataSource as unknown as Mock).mockResolvedValue(dataSource);
  return { rows, tasks, repository, taskRepository, engineRepository };
}

describe('EngineBackstopSyncRunService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists a bounded encrypted projection but returns only sanitized receipts', async () => {
    const state = setup();
    const run = await service.createPreview({
      engineId: 'engine-1', tenantId: 'tenant-a', sourceHash: 'a'.repeat(64), desiredHash: 'b'.repeat(64),
      projection: projection(), capability: { nativeAuthorizationWrite: true }, actorId: 'user-1', now: 100,
    });
    expect(run).toMatchObject({
      engineId: 'engine-1', tenantId: 'tenant-a', status: 'previewed', detailedSnapshotAvailable: true,
      counts: { total: 1, proposed: 1, proposedGrantCount: 1 },
      classifications: [expect.objectContaining({
        sourceAssignmentReference: `backstop-assignment-${'a'.repeat(24)}`,
        nativeGroupReference: `camunda-group-${'b'.repeat(24)}`,
        resourceReference: `backstop-resource-${'c'.repeat(24)}`,
      })],
    });
    expect(JSON.stringify(run)).not.toContain('camunda-operators');
    expect(JSON.stringify(run)).not.toContain('payments');
    expect(state.rows[0].encryptedDetailedSnapshot).toContain('camunda-operators');
    await expect(service.getDetailedSnapshot(run.id, 101)).resolves.toEqual(expect.objectContaining({ projection: projection() }));
  });

  it('does not persist a preview after engine decommission wins the lifecycle claim', async () => {
    const state = setup(false);
    await expect(service.createPreview({
      engineId: 'engine-1', tenantId: 'tenant-a', sourceHash: 'a'.repeat(64), desiredHash: 'b'.repeat(64), projection: projection(),
    })).rejects.toThrow('active engine');
    expect(state.rows).toHaveLength(0);
  });

  it('updates only hash-bound run state and keeps detail unavailable after expiry', async () => {
    setup();
    const preview = await service.createPreview({
      engineId: 'engine-1', sourceHash: 'a'.repeat(64), desiredHash: 'b'.repeat(64), projection: projection(), now: 100, snapshotRetentionMs: 1,
    });
    await expect(service.updateRun({ id: preview.id, status: 'succeeded', resultHash: 'c'.repeat(64), completed: true, now: 120 }))
      .resolves.toMatchObject({ status: 'succeeded', resultHash: 'c'.repeat(64), completedAt: 120 });
    await expect(service.getDetailedSnapshot(preview.id, 101)).resolves.toBeNull();
    await expect(service.listForEngine({ engineId: 'engine-1' })).resolves.toHaveLength(1);
    await expect(service.listForEngine({ engineId: 'engine-1', limit: 101 })).rejects.toThrow('History limit');
  });

  it('retains unresolved native ownership journals beyond preview expiry and releases them after cleanup', async () => {
    const state = setup();
    const preview = await service.createPreview({
      engineId: 'engine-1', sourceHash: 'a'.repeat(64), desiredHash: 'b'.repeat(64), projection: projection(), now: 100, snapshotRetentionMs: 1,
    });
    await service.updateRun({
      id: preview.id,
      status: 'failed',
      now: 120,
      retainDetailedSnapshot: true,
      detailedSnapshot: {
        version: 1,
        ownershipForRunId: preview.id,
        connectionCommitment: 'c'.repeat(64),
        ownedGrants: [{ id: 'native-1', nativeGroupId: 'camunda-operators', camundaResourceType: 6, resourceKey: 'payments' }],
      },
    });

    await expect(service.purgeExpiredDetailedSnapshots(10_000)).resolves.toBe(0);
    await expect(service.getDetailedSnapshot(preview.id, 10_000)).resolves.toMatchObject({
      ownedGrants: [expect.objectContaining({ id: 'native-1' })],
    });

    await service.updateRun({
      id: preview.id,
      status: 'rolled_back',
      now: 20_000,
      retainDetailedSnapshot: false,
      detailedSnapshot: { version: 1, ownershipForRunId: preview.id, connectionCommitment: 'c'.repeat(64), ownedGrants: [] },
    });
    const releaseAt = 20_000 + 30 * 24 * 60 * 60 * 1000;
    await expect(service.purgeExpiredDetailedSnapshots(releaseAt)).resolves.toBe(1);
    expect(state.rows[0].encryptedDetailedSnapshot).toBeNull();
  });

  it('rejects a superseded worker run update under the task lease and preserves the successor state', async () => {
    const state = setup();
    const preview = await service.createPreview({
      engineId: 'engine-1', sourceHash: 'a'.repeat(64), desiredHash: 'b'.repeat(64), projection: projection(), now: 100,
    });
    state.tasks.push({ id: 'task-1', runId: preview.id, status: 'running', leaseId: 'successor-lease', leaseExpiresAt: 1_000, updatedAt: 100 });

    await expect(service.updateRunWithTaskLease({
      id: preview.id, taskId: 'task-1', leaseId: 'expired-worker-lease', status: 'failed', now: 200,
    })).resolves.toBeNull();
    expect(state.rows[0].status).toBe('previewed');

    await expect(service.updateRunWithTaskLease({
      id: preview.id, taskId: 'task-1', leaseId: 'successor-lease', status: 'succeeded', completed: true, now: 200,
    })).resolves.toMatchObject({ status: 'succeeded' });
    expect(state.rows[0].status).toBe('succeeded');
  });
});
