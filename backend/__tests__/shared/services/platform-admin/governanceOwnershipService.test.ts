import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ConfigBundleApplyRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/ConfigBundleApplyRun.js';
import { PlatformSettings } from '@enterpriseglue/shared/infrastructure/persistence/entities/PlatformSettings.js';
import { governanceOwnershipService } from '@enterpriseglue/shared/services/platform-admin/GovernanceOwnershipService.js';
import { platformSettingsService } from '@enterpriseglue/shared/services/platform-admin/PlatformSettingsService.js';
import { GovernanceOwnershipRequestSchema } from '@enterpriseglue/shared/schemas/platform-admin/config-bundle.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/platform-admin/PlatformSettingsService.js', () => ({
  platformSettingsService: {
    get: vi.fn(),
    update: vi.fn(),
  },
}));

const baseSettings = {
  id: 'default',
  accessGovernanceSourceRef: 'config_bundle:old-owner',
  accessGovernanceOwnershipMode: 'config_locked',
  accessGovernanceSourceHash: 'old-hash',
  accessGovernanceLastAppliedAt: 100,
  accessGovernanceDriftStatus: 'in_sync',
  updatedAt: 100,
  updatedById: 'actor-old',
};

function setup() {
  let settingsRow: any = { ...baseSettings };
  const runs: any[] = [];
  const requestedEntities: unknown[] = [];
  let transactions = 0;
  const settingsRepo = {
    findOneBy: vi.fn().mockImplementation(() => Promise.resolve(settingsRow)),
    insert: vi.fn(),
    update: vi.fn().mockImplementation((_where, updates) => {
      settingsRow = { ...settingsRow, ...updates };
      return Promise.resolve({ affected: 1 });
    }),
    createQueryBuilder: vi.fn(() => ({
      where: vi.fn().mockReturnThis(),
      setLock: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockImplementation(() => Promise.resolve(settingsRow)),
    })),
  };
  const runRepo = {
    findOne: vi.fn().mockImplementation(({ where }) => Promise.resolve(
      runs.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) || null,
    )),
    find: vi.fn().mockImplementation(({ where, take }) => Promise.resolve(
      runs.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value)).slice(0, take),
    )),
    insert: vi.fn().mockImplementation((row) => {
      if (runs.some((candidate) => candidate.tenantScopeKey === row.tenantScopeKey && candidate.idempotencyKey === row.idempotencyKey)) {
        return Promise.reject(new Error('unique idempotency key'));
      }
      runs.push({ ...row });
      return Promise.resolve({});
    }),
  };
  const getRepository = (entity: unknown) => {
    requestedEntities.push(entity);
    if (entity === PlatformSettings) return settingsRepo;
    if (entity === ConfigBundleApplyRun) return runRepo;
    throw new Error(`Unexpected repository ${String((entity as { name?: string })?.name)}`);
  };
  const manager = { getRepository };
  const dataSource = {
    options: { type: 'sqlite' },
    getRepository,
    transaction: vi.fn(async (callback) => {
      transactions += 1;
      return callback(manager);
    }),
  };
  vi.mocked(getDataSource).mockResolvedValue(dataSource as any);
  vi.mocked(platformSettingsService.get).mockImplementation(async () => ({
    accessGovernanceSourceRef: settingsRow.accessGovernanceSourceRef,
    accessGovernanceOwnershipMode: settingsRow.accessGovernanceOwnershipMode,
    accessGovernanceSourceHash: settingsRow.accessGovernanceSourceHash,
    accessGovernanceLastAppliedAt: settingsRow.accessGovernanceLastAppliedAt,
    accessGovernanceDriftStatus: settingsRow.accessGovernanceDriftStatus,
  } as any));
  vi.mocked(platformSettingsService.update).mockImplementation(async (_data, actorId, options) => {
    settingsRow = {
      ...settingsRow,
      accessGovernanceSourceRef: options?.sourceRef,
      accessGovernanceOwnershipMode: options?.ownershipMode,
      accessGovernanceSourceHash: options?.sourceHash,
      accessGovernanceLastAppliedAt: options?.lastAppliedAt,
      accessGovernanceDriftStatus: options?.driftStatus,
      updatedById: actorId,
    };
  });
  return {
    runs,
    requestedEntities,
    settingsRepo,
    runRepo,
    get settingsRow() { return settingsRow; },
    set settingsRow(value: any) { settingsRow = value; },
    get transactions() { return transactions; },
  };
}

const transferRequest = {
  operation: 'transfer' as const,
  expectedCurrentSourceRef: 'config_bundle:old-owner',
  desiredBundleKey: 'new-owner',
  desiredOwnershipMode: 'config_warn' as const,
  reason: 'Move governance ownership to the replacement platform bundle.',
};

describe('GovernanceOwnershipService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('previews a settings-only transfer with explicit preservation guarantees', async () => {
    setup();
    const preview = await governanceOwnershipService.preview(transferRequest);

    expect(preview.current.sourceRef).toBe('config_bundle:old-owner');
    expect(preview.desired).toMatchObject({
      sourceRef: 'config_bundle:new-owner',
      ownershipMode: 'config_warn',
      sourceHash: null,
      driftStatus: 'drifted',
    });
    expect(preview.affectedFields).toHaveLength(5);
    expect(preview.preservedObjectTypes).toEqual(expect.arrayContaining([
      'engines',
      'roles',
      'role_assignments',
      'identity_providers',
      'identity_mappings',
      'project_engine_targets',
    ]));
    expect(preview.requiredAcknowledgements).toContain('governance.transfer-to-new-bundle');
    expect(preview.previewHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reports an owner mismatch without mutating state', async () => {
    setup();
    const preview = await governanceOwnershipService.preview({
      ...transferRequest,
      expectedCurrentSourceRef: 'config_bundle:not-the-owner',
    });

    expect(preview.conflicts).toContainEqual(expect.objectContaining({
      code: 'governance_source_owner_mismatch',
    }));
    expect(platformSettingsService.update).not.toHaveBeenCalled();
  });

  it('applies the exact preview and writes one immutable receipt without touching managed-object repositories', async () => {
    const state = setup();
    const preview = await governanceOwnershipService.preview(transferRequest);
    const receipt = await governanceOwnershipService.apply({
      ...transferRequest,
      previewHash: preview.previewHash,
      previewExpiresAt: preview.previewExpiresAt,
      acknowledgements: preview.requiredAcknowledgements,
      idempotencyKey: 'transfer-request-0001',
    }, { tenantId: 'tenant-1', actorId: 'admin-1' });

    expect(receipt.desired.sourceRef).toBe('config_bundle:new-owner');
    expect(state.settingsRow).toMatchObject({
      accessGovernanceSourceRef: 'config_bundle:new-owner',
      accessGovernanceOwnershipMode: 'config_warn',
      accessGovernanceSourceHash: null,
      accessGovernanceLastAppliedAt: null,
      accessGovernanceDriftStatus: 'drifted',
      updatedById: 'admin-1',
    });
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0]).toMatchObject({
      bundleApiVersion: 'governance-ownership/v1',
      status: 'succeeded',
      canonicalHash: preview.previewHash,
    });
    expect(new Set(state.requestedEntities)).toEqual(new Set([PlatformSettings, ConfigBundleApplyRun]));
  });

  it('fails closed when the source owner changes after preview', async () => {
    const state = setup();
    const preview = await governanceOwnershipService.preview(transferRequest);
    state.settingsRow = { ...state.settingsRow, accessGovernanceSourceRef: 'config_bundle:concurrent-owner' };

    await expect(governanceOwnershipService.apply({
      ...transferRequest,
      previewHash: preview.previewHash,
      previewExpiresAt: preview.previewExpiresAt,
      acknowledgements: preview.requiredAcknowledgements,
      idempotencyKey: 'transfer-request-0002',
    }, { tenantId: 'tenant-1', actorId: 'admin-1' })).rejects.toMatchObject({ statusCode: 409 });
    expect(platformSettingsService.update).not.toHaveBeenCalled();
    expect(state.runs).toHaveLength(0);
  });

  it('requires every consequence acknowledgement', async () => {
    setup();
    const preview = await governanceOwnershipService.preview(transferRequest);
    await expect(governanceOwnershipService.apply({
      ...transferRequest,
      previewHash: preview.previewHash,
      previewExpiresAt: preview.previewExpiresAt,
      acknowledgements: ['governance.settings-only'],
      idempotencyKey: 'transfer-request-0003',
    }, { tenantId: 'tenant-1', actorId: 'admin-1' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('replays the same receipt on idempotent retry and rejects key reuse for a different preview', async () => {
    const state = setup();
    const preview = await governanceOwnershipService.preview(transferRequest);
    const apply = {
      ...transferRequest,
      previewHash: preview.previewHash,
      previewExpiresAt: preview.previewExpiresAt,
      acknowledgements: preview.requiredAcknowledgements,
      idempotencyKey: 'transfer-request-0004',
    };
    const first = await governanceOwnershipService.apply(apply, { tenantId: 'tenant-1', actorId: 'admin-1' });
    const retry = await governanceOwnershipService.apply(apply, { tenantId: 'tenant-1', actorId: 'admin-1' });

    expect(retry).toMatchObject({ id: first.id, idempotent: true });
    expect(state.transactions).toBe(1);
    await expect(governanceOwnershipService.apply({
      ...apply,
      previewHash: 'f'.repeat(64),
    }, { tenantId: 'tenant-1', actorId: 'admin-1' })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('releases or retires only governance provenance to manual ownership', async () => {
    setup();
    for (const operation of ['release', 'retire'] as const) {
      const preview = await governanceOwnershipService.preview({
        operation,
        expectedCurrentSourceRef: 'config_bundle:old-owner',
        reason: `${operation} the previous bundle ownership without deleting managed objects.`,
      });
      expect(preview.desired).toEqual({
        sourceRef: null,
        ownershipMode: 'manual',
        sourceHash: null,
        lastAppliedAt: null,
        driftStatus: null,
      });
      expect(preview.requiredAcknowledgements).toContain(operation === 'release'
        ? 'governance.release-to-manual'
        : 'governance.retire-bundle-without-deleting-objects');
    }
  });

  it('rejects ambiguous and unknown request fields', () => {
    expect(GovernanceOwnershipRequestSchema.safeParse({
      ...transferRequest,
      unexpected: true,
    }).success).toBe(false);
    expect(GovernanceOwnershipRequestSchema.safeParse({
      operation: 'release',
      expectedCurrentSourceRef: 'config_bundle:old-owner',
      desiredBundleKey: 'not-allowed',
      reason: 'Release governance ownership safely to portal administrators.',
    }).success).toBe(false);
  });
});
