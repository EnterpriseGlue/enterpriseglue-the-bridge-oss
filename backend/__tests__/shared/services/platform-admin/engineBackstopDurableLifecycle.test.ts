import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineBackstopSyncRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineBackstopSyncRun.js';
import { EngineBackstopSyncTask } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineBackstopSyncTask.js';
import { EngineBackstopSyncService } from '@enterpriseglue/shared/services/platform-admin/EngineBackstopSyncService.js';
import { EngineBackstopSyncRunService } from '@enterpriseglue/shared/services/platform-admin/EngineBackstopSyncRunService.js';
import { EngineBackstopSyncTaskService } from '@enterpriseglue/shared/services/platform-admin/EngineBackstopSyncTaskService.js';
import type { EngineBackstopProjection } from '@enterpriseglue/shared/schemas/platform-admin/engine-backstop.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/encryption.js', () => ({
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
  decrypt: vi.fn((value: string) => value.replace('encrypted:', '')),
  hash: vi.fn((value: string) => Buffer.from(value).toString('hex').padEnd(64, '0').slice(0, 64)),
  blindIndex: vi.fn((_domain: string, value: string) => Buffer.from(value).toString('hex').padEnd(64, '0').slice(0, 64)),
}));

const sourceHash = 'a'.repeat(64);
const desiredHash = 'b'.repeat(64);

function projection(): EngineBackstopProjection {
  return {
    classifications: [{
      sourceAssignmentId: 'assignment-1', principalType: 'group', disposition: 'proposed', reasonCodes: ['exact_group_read_projected'],
      resourceKind: 'process_definition', resourceKey: 'payments', nativeGroupId: 'native-operators', camundaResourceType: 6, permissions: ['READ'],
    }],
    desiredGrants: [{
      nativeGroupId: 'native-operators', resourceKind: 'process_definition', resourceKey: 'payments', camundaResourceType: 6, permissions: ['READ'], sourceAssignmentIds: ['assignment-1'],
    }],
  };
}

function setup() {
  const runs: any[] = [];
  const tasks: any[] = [];
  const runRepository = {
    insert: vi.fn(async (row) => runs.push({ ...row })),
    findOne: vi.fn(async ({ where }: any) => runs.find((row) => row.id === where.id) || null),
    find: vi.fn(async ({ where, take }: any = {}) => runs
      .filter((row) => !where || Object.entries(where).every(([key, value]) => row[key] === value))
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, take || runs.length)),
    update: vi.fn(async (criteria: any, values: any) => {
      const matched = runs.filter((row) => Object.entries(criteria).every(([key, value]) => row[key] === value));
      matched.forEach((row) => Object.assign(row, values));
      return { affected: matched.length };
    }),
  };
  const taskRepository = {
    findOne: vi.fn(async ({ where }: any) => tasks.find((row) => row.runId === where.runId) || null),
    insert: vi.fn(async (row) => {
      if (tasks.some((candidate) => candidate.runId === row.runId)) throw new Error('unique run_id constraint');
      tasks.push({ ...row });
    }),
    find: vi.fn(async ({ where }: any) => {
      const filters = Array.isArray(where) ? where : [where];
      return tasks.filter((row) => filters.some((filter) => {
        if (filter.runId && row.runId !== filter.runId) return false;
        if (filter.status && row.status !== filter.status) return false;
        return row.nextAttemptAt === null || row.nextAttemptAt <= Date.now();
      }));
    }),
    update: vi.fn(async (criteria: any, values: any) => {
      const leaseOperator = criteria.leaseExpiresAt as { _type?: string; _value?: number } | undefined;
      const matched = tasks.filter((row) => {
        if (criteria.id && row.id !== criteria.id) return false;
        if (criteria.runId && row.runId !== criteria.runId) return false;
        if (criteria.status && row.status !== criteria.status) return false;
        if (criteria.leaseId && row.leaseId !== criteria.leaseId) return false;
        if (leaseOperator?._type === 'lessThanOrEqual' && (row.leaseExpiresAt === null || row.leaseExpiresAt > Number(leaseOperator._value))) return false;
        if (leaseOperator?._type === 'moreThan' && (row.leaseExpiresAt === null || row.leaseExpiresAt <= Number(leaseOperator._value))) return false;
        return true;
      });
      matched.forEach((row) => Object.assign(row, values));
      return { affected: matched.length };
    }),
  };
  const engine = {
    id: 'engine-1',
    baseUrl: 'https://engine.example.test/engine-rest',
    type: 'operaton',
    connectionMode: 'customer_sidecar',
    authType: 'none',
    username: null,
    passwordEnc: null,
    oauthTokenUrl: null,
    oauthScopes: null,
    oauthAudience: null,
    lifecycleStatus: 'active',
  };
  const engineRepository = {
    update: vi.fn(async () => ({ affected: 1 })),
    createQueryBuilder: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getOne: vi.fn(async () => engine),
    })),
  };
  const getRepository = (entity: unknown) => {
      if (entity === EngineBackstopSyncRun) return runRepository;
      if (entity === EngineBackstopSyncTask) return taskRepository;
      if (entity === Engine) return engineRepository;
      throw new Error('Unexpected repository');
  };
  vi.mocked(getDataSource).mockResolvedValue({
    getRepository,
    transaction: async (callback: (manager: { getRepository: typeof getRepository }) => unknown) => callback({ getRepository }),
  } as any);
  return { runs, tasks, runRepository, taskRepository, engine };
}

describe('mirrored-backstop durable lifecycle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists a sanitized preview, collapses concurrent apply requests, and rolls back only recorded native IDs', async () => {
    const state = setup();
    let nativeAuthorizationIds: string[] = [];
    const nativeClient = {
      createAuthorization: vi.fn(async () => {
        nativeAuthorizationIds = ['native-auth-1'];
        return { id: 'native-auth-1' };
      }),
      deleteAuthorization: vi.fn(async (_engineId: string, id: string) => {
        nativeAuthorizationIds = nativeAuthorizationIds.filter((candidate) => candidate !== id);
      }),
      readAuthorization: vi.fn(async () => ({ type: 1, permissions: ['READ'], groupId: 'native-operators', resourceType: 6, resourceId: 'payments' })),
      listExactAuthorizationIds: vi.fn(async () => [...nativeAuthorizationIds]),
    };
    const service = new EngineBackstopSyncService({
      runService: new EngineBackstopSyncRunService(),
      taskService: new EngineBackstopSyncTaskService(),
      nativeClient,
      projectionBuilder: async () => ({
        engine: state.engine as any,
        tenantId: 'tenant-a', projection: projection(), sourceHash, desiredHash,
        capability: { nativeAuthorizationWrite: true, directTrustedEndpoint: false },
      }),
    });

    const preview = await service.preview({ engineId: 'engine-1', tenantId: 'tenant-a', actorId: 'user-1' });
    expect(JSON.stringify(preview)).not.toContain('native-operators');
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0].encryptedDetailedSnapshot).toContain('native-operators');

    const [firstApply, secondApply] = await Promise.all([
      service.apply({ engineId: 'engine-1', tenantId: 'tenant-a', runId: preview.id, request: { desiredHash, acknowledgeDirectIdentityBoundary: true } }),
      service.apply({ engineId: 'engine-1', tenantId: 'tenant-a', runId: preview.id, request: { desiredHash, acknowledgeDirectIdentityBoundary: true } }),
    ]);
    expect(nativeClient.createAuthorization).toHaveBeenCalledTimes(1);
    expect(state.tasks.filter((task) => task.runId === preview.id)).toHaveLength(1);
    expect([firstApply.run.status, secondApply.run.status]).toContain('succeeded');

    const rollback = await service.rollback({
      engineId: 'engine-1', tenantId: 'tenant-a', runId: preview.id,
      request: { acknowledgeOwnedGrantDeletion: true },
    });
    expect(rollback.run.status).toBe('rolled_back');
    expect(nativeClient.deleteAuthorization).toHaveBeenCalledTimes(1);
    expect(nativeClient.deleteAuthorization).toHaveBeenCalledWith('engine-1', 'native-auth-1');
    expect(state.tasks).toHaveLength(2);
  });
});
