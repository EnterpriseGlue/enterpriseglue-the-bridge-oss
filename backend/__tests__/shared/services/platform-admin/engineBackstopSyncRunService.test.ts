import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EngineBackstopSyncRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineBackstopSyncRun.js';
import { EngineBackstopSyncRunService } from '@enterpriseglue/shared/services/platform-admin/EngineBackstopSyncRunService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/encryption.js', () => ({
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
  decrypt: vi.fn((value: string) => value.replace('encrypted:', '')),
  hash: vi.fn((value: string) => value.includes('assignment-1') ? 'a'.repeat(64) : value.includes('camunda-operators') ? 'b'.repeat(64) : 'c'.repeat(64)),
}));

const service = new EngineBackstopSyncRunService();

function projection() {
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

function setup() {
  const rows: any[] = [];
  const repository = {
    insert: vi.fn(async (row) => rows.push(row)),
    findOne: vi.fn(async ({ where }) => rows.find((row) => row.id === where.id) || null),
    find: vi.fn(async () => [...rows]),
    update: vi.fn(async ({ id }, values) => {
      const row = rows.find((candidate) => candidate.id === id);
      if (row) Object.assign(row, values);
      return { affected: row ? 1 : 0 };
    }),
  };
  const dataSource = { getRepository: (entity: unknown) => {
    if (entity === EngineBackstopSyncRun) return repository;
    throw new Error('Unexpected repository');
  } };
  (getDataSource as unknown as Mock).mockResolvedValue(dataSource);
  return { rows, repository };
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
});
