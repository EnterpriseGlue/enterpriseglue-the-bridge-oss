import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import {
  Engine,
  EngineSet,
  EngineSetMaterialization,
  ExternalEngineRegistration,
} from '@enterpriseglue/shared/db/entities/index.js';
import { engineSetKeyIdentity, engineSetService } from '@enterpriseglue/shared/services/platform-admin/EngineSetService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

function queryBuilder(result: unknown) {
  return {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue(result),
    getOne: vi.fn().mockResolvedValue(result),
  };
}

describe('engineSetService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires acknowledgement before creating broad Engine Sets', async () => {
    await expect(engineSetService.createEngineSet({
      name: 'All Engines',
      selector: { mode: 'all' },
    })).rejects.toThrow('High-risk Engine Set selector requires acknowledgement');

    expect(getDataSource).not.toHaveBeenCalled();
  });

  it('writes and checks a non-null canonical identity for a tenant Engine Set key', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EngineSet) return { findOneBy: vi.fn().mockResolvedValue(null), insert };
        throw new Error('Unexpected repository');
      },
    });
    vi.spyOn(engineSetService, 'materializeEngineSet').mockResolvedValueOnce({
      engineSetId: 'set-a', selectorFingerprint: 'fingerprint', matched: 0, created: 0, updated: 0, removed: 0, materializations: [],
    });

    await engineSetService.createEngineSet({
      tenantId: 'tenant-a', key: 'operators', name: 'Operators', selector: { mode: 'engine_ids', engineIds: ['engine-1'] },
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a', key: 'operators', engineSetKeyIdentity: 'tenant-a:operators',
    }));
    expect(engineSetKeyIdentity(null, 'operators')).toBe('platform:operators');
  });

  it('returns risk reasons and warnings when previewing broad selectors', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return {
          find: vi.fn().mockResolvedValue([
            { id: 'engine-prod', name: 'Prod Engine', labelsJson: JSON.stringify({ environment: 'prod' }), externalId: null, tenantId: null },
          ]),
        };
        if (entity === ExternalEngineRegistration) return { find: vi.fn().mockResolvedValue([]) };
        throw new Error('Unexpected repository');
      },
    });

    const result = await engineSetService.previewSelector({ mode: 'all' });

    expect(result.riskReasons).toEqual(['all_engines_selector']);
    expect(result.warnings).toContain('This selector includes every active engine visible to the tenant.');
    expect(result.matchedEngines).toEqual([
      expect.objectContaining({ engineId: 'engine-prod', engineName: 'Prod Engine' }),
    ]);
  });

  it('requires acknowledgement before updating broad Engine Set selectors', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EngineSet) return {
          findOneBy: vi.fn().mockResolvedValue({
            id: 'set-prod',
            tenantId: null,
            key: 'prod-engines',
            name: 'Prod Engines',
            description: null,
            selectorJson: JSON.stringify({ mode: 'labels', labels: { environment: 'prod' }, labelMatch: 'all' }),
            selectorFingerprint: 'old-fingerprint',
            source: 'manual',
            sourceRef: null,
            isArchived: false,
            createdById: 'admin-1',
            lastMaterializedAt: null,
            materializationStatus: 'ok',
            materializationError: null,
            createdAt: 1,
            updatedAt: 1,
          }),
          update,
        };
        throw new Error('Unexpected repository');
      },
    });

    await expect(engineSetService.updateEngineSet('set-prod', {
      selector: {
        mode: 'labels',
        labels: { environment: 'prod', region: 'eu' },
        labelMatch: 'any',
      },
    })).rejects.toThrow('High-risk Engine Set selector requires acknowledgement');

    expect(update).not.toHaveBeenCalled();
  });

  it('rejects manual mutation of configuration-managed Engine Sets', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EngineSet) return {
          findOneBy: vi.fn().mockResolvedValue({
            id: 'set-config', tenantId: null, key: 'configured-engines', name: 'Configured engines',
            description: null, selectorJson: JSON.stringify({ mode: 'all' }), source: 'config',
            sourceRef: 'config_bundle:acme.authz', isArchived: false,
          }),
          update,
        };
        throw new Error('Unexpected repository');
      },
    });

    await expect(engineSetService.updateEngineSet('set-config', { name: 'Changed' })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Engine Set is managed by config (config_bundle:acme.authz) and cannot be changed through manual Engine Set management',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('allows configuration apply to replace a config-owned Engine Set in its transaction without materializing mid-apply', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const store = {
      getRepository(entity: unknown) {
        if (entity === EngineSet) return {
          findOneBy: vi.fn().mockResolvedValue({
            id: 'set-config', tenantId: 'tenant-a', key: 'configured-engines', name: 'Before', description: null,
            selectorJson: JSON.stringify({ mode: 'engine_ids', engineIds: ['engine-1'] }), selectorFingerprint: 'old',
            source: 'config', sourceRef: 'config_bundle:acme.authz', ownershipMode: 'config_locked', sourceHash: 'old-hash',
            lastAppliedAt: 1, driftStatus: 'in_sync', isArchived: false,
          }),
          update,
        };
        throw new Error('Unexpected repository');
      },
    };

    await engineSetService.updateEngineSet('set-config', {
      tenantId: 'tenant-a', name: 'After', selector: { mode: 'engine_ids', engineIds: ['engine-2'] },
      ownershipMode: 'config_warn', sourceHash: 'new-hash', lastAppliedAt: 2, driftStatus: 'in_sync',
      allowSourceOwnedMutation: true,
    }, store as any, true);

    expect(update).toHaveBeenCalledWith({ id: 'set-config' }, expect.objectContaining({
      name: 'After', ownershipMode: 'config_warn', sourceHash: 'new-hash', lastAppliedAt: 2,
      driftStatus: 'in_sync', materializationStatus: 'pending', selectorJson: '{"engineIds":["engine-2"],"mode":"engine_ids"}',
    }));

    await engineSetService.updateEngineSet('set-config', {
      tenantId: 'tenant-a', isArchived: true, sourceHash: 'archive-hash', lastAppliedAt: 3,
      driftStatus: 'in_sync', allowSourceOwnedMutation: true,
    }, store as any, true);

    expect(update).toHaveBeenLastCalledWith({ id: 'set-config' }, expect.objectContaining({
      isArchived: true, sourceHash: 'archive-hash', lastAppliedAt: 3, materializationStatus: 'archived',
    }));
    expect(getDataSource).not.toHaveBeenCalled();
  });

  it('allows config-warning Engine Set edits and marks drift', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const materializationRepo = { delete: vi.fn() };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EngineSet) return {
          findOneBy: vi.fn().mockResolvedValue({
            id: 'set-warning', tenantId: null, key: 'engines.warning', name: 'Warning', description: null,
            selectorJson: JSON.stringify({ mode: 'engine_ids', engineIds: ['engine-1'] }), selectorFingerprint: 'old',
            source: 'config', sourceRef: 'config_bundle:acme.authz', ownershipMode: 'config_warn', isArchived: false,
          }),
          update,
        };
        if (entity === EngineSetMaterialization) return materializationRepo;
        throw new Error('Unexpected repository');
      },
    });
    vi.spyOn(engineSetService, 'materializeEngineSet').mockResolvedValueOnce({
      engineSetId: 'set-warning', selectorFingerprint: 'new', matched: 0, created: 0, updated: 0, removed: 0, materializations: [],
    });

    await engineSetService.updateEngineSet('set-warning', { name: 'Locally changed' });

    expect(update).toHaveBeenCalledWith({ id: 'set-warning' }, expect.objectContaining({ name: 'Locally changed', driftStatus: 'drifted' }));
  });

  it('previews label selectors using external registration labels', async () => {
    const engineFind = vi.fn().mockResolvedValue([
      { id: 'engine-prod', name: 'Prod Engine', labelsJson: null, externalId: 'cluster/prod', tenantId: null },
      { id: 'engine-dev', name: 'Dev Engine', labelsJson: JSON.stringify({ environment: 'dev' }), externalId: 'cluster/dev', tenantId: null },
      { id: 'engine-old-prod', name: 'Old Prod Engine', labelsJson: null, externalId: 'cluster/old-prod', tenantId: null, lifecycleStatus: 'decommissioned' },
    ]);
    const registrationFind = vi.fn().mockResolvedValue([
      { engineId: 'engine-prod', externalId: 'cluster/prod', labelsJson: JSON.stringify({ environment: 'prod', region: 'eu' }) },
      { engineId: 'engine-dev', externalId: 'cluster/dev', labelsJson: JSON.stringify({ environment: 'dev', region: 'eu' }) },
      { engineId: 'engine-old-prod', externalId: 'cluster/old-prod', labelsJson: JSON.stringify({ environment: 'prod', region: 'eu' }) },
    ]);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return { find: engineFind };
        if (entity === ExternalEngineRegistration) return { find: registrationFind };
        throw new Error('Unexpected repository');
      },
    });

    const result = await engineSetService.previewSelector({
      mode: 'labels',
      labels: { environment: 'prod' },
    });

    expect(result.selector).toEqual({ mode: 'labels', labels: { environment: 'prod' }, labelMatch: 'all' });
    expect(result.selectorFingerprint).toHaveLength(64);
    expect(result.matchedEngines).toEqual([
      expect.objectContaining({
        engineId: 'engine-prod',
        labels: { environment: 'prod', region: 'eu' },
        matchedBy: { mode: 'labels', labels: { environment: 'prod' }, labelMatch: 'all' },
      }),
    ]);
  });

  it('materializes matching engines and removes stale rows', async () => {
    const engineSet = {
      id: 'set-prod',
      tenantId: null,
      key: 'prod-engines',
      name: 'Prod Engines',
      description: null,
      selectorJson: JSON.stringify({ mode: 'labels', labels: { environment: 'prod' } }),
      selectorFingerprint: 'old-fingerprint',
      source: 'manual',
      sourceRef: null,
      isArchived: false,
      createdById: 'admin-1',
      lastMaterializedAt: null,
      materializationStatus: 'pending',
      materializationError: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const materializationFind = vi.fn()
      .mockResolvedValueOnce([
        { id: 'stale-row', engineSetId: 'set-prod', engineId: 'engine-dev' },
      ])
      .mockResolvedValueOnce([]);
    const insert = vi.fn().mockResolvedValue(undefined);
    const updateMaterialization = vi.fn().mockResolvedValue(undefined);
    const deleteMaterialization = vi.fn().mockResolvedValue(undefined);
    const updateEngineSet = vi.fn().mockResolvedValue(undefined);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EngineSet) return {
          findOneBy: vi.fn().mockResolvedValue(engineSet),
          update: updateEngineSet,
        };
        if (entity === Engine) return {
          find: vi.fn().mockResolvedValue([
            { id: 'engine-prod', name: 'Prod Engine', labelsJson: JSON.stringify({ environment: 'prod' }), externalId: null, tenantId: null },
            { id: 'engine-dev', name: 'Dev Engine', labelsJson: JSON.stringify({ environment: 'dev' }), externalId: null, tenantId: null },
          ]),
        };
        if (entity === ExternalEngineRegistration) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === EngineSetMaterialization) return {
          find: materializationFind,
          insert,
          update: updateMaterialization,
          delete: deleteMaterialization,
        };
        throw new Error('Unexpected repository');
      },
    });

    const result = await engineSetService.materializeEngineSet('set-prod');

    expect(result).toMatchObject({ engineSetId: 'set-prod', matched: 1, created: 1, updated: 0, removed: 1 });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      engineSetId: 'set-prod',
      engineId: 'engine-prod',
      matchedByJson: expect.stringContaining('environment'),
      lineageJson: expect.stringContaining('prod-engines'),
    }));
    expect(deleteMaterialization).toHaveBeenCalledWith({ id: expect.anything() });
    expect(updateEngineSet).toHaveBeenCalledWith({ id: 'set-prod' }, expect.objectContaining({
      materializationStatus: 'ok',
      materializationError: null,
    }));
  });

  it('refreshes SSO-owned Engine Set materializations for a newly registered matching engine', async () => {
    const engineSet = {
      id: 'set-sso-prod',
      tenantId: 'tenant-a',
      key: 'sso-mapping-prod',
      name: 'SSO mapping prod',
      description: null,
      selectorJson: JSON.stringify({ mode: 'labels', labels: { environment: 'prod' }, labelMatch: 'all' }),
      selectorFingerprint: 'old-fingerprint',
      source: 'sso',
      sourceRef: 'mapping-label',
      isArchived: false,
      createdById: null,
      lastMaterializedAt: null,
      materializationStatus: 'pending',
      materializationError: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const setQb = queryBuilder([engineSet]);
    const updateEngineSet = vi.fn().mockResolvedValue(undefined);
    const materializationFind = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const insertMaterialization = vi.fn().mockResolvedValue(undefined);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EngineSet) return {
          createQueryBuilder: vi.fn().mockReturnValue(setQb),
          findOneBy: vi.fn().mockResolvedValue(engineSet),
          update: updateEngineSet,
        };
        if (entity === Engine) return {
          findOne: vi.fn().mockResolvedValue({ id: 'engine-new-prod', tenantId: 'tenant-a' }),
          find: vi.fn().mockResolvedValue([
            { id: 'engine-new-prod', name: 'New Prod Engine', labelsJson: null, externalId: 'cluster/prod-new', tenantId: 'tenant-a', lifecycleStatus: 'active' },
            { id: 'engine-dev', name: 'Dev Engine', labelsJson: JSON.stringify({ environment: 'dev' }), externalId: 'cluster/dev', tenantId: 'tenant-a', lifecycleStatus: 'active' },
          ]),
        };
        if (entity === ExternalEngineRegistration) return {
          find: vi.fn().mockResolvedValue([
            { engineId: 'engine-new-prod', labelsJson: JSON.stringify({ environment: 'prod', region: 'eu' }), externalId: 'cluster/prod-new' },
          ]),
        };
        if (entity === EngineSetMaterialization) return {
          find: materializationFind,
          insert: insertMaterialization,
          update: vi.fn(),
          delete: vi.fn(),
        };
        throw new Error('Unexpected repository');
      },
    });

    const results = await engineSetService.materializeEngineSetsForEngine('engine-new-prod', 'tenant-a');

    expect(results).toEqual([
      expect.objectContaining({
        engineSetId: 'set-sso-prod',
        matched: 1,
        created: 1,
        updated: 0,
        removed: 0,
      }),
    ]);
    expect(insertMaterialization).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      engineSetId: 'set-sso-prod',
      engineId: 'engine-new-prod',
      source: 'sso',
      sourceRef: 'mapping-label',
      matchedByJson: expect.stringContaining('"environment":"prod"'),
      lineageJson: expect.stringContaining('"mapping-label"'),
    }));
    expect(updateEngineSet).toHaveBeenCalledWith({ id: 'set-sso-prod' }, expect.objectContaining({
      materializationStatus: 'ok',
      materializationError: null,
    }));
  });
});
