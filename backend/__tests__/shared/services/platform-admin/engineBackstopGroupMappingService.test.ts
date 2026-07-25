import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { EngineBackstopGroupMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineBackstopGroupMapping.js';
import { EngineBackstopGroupMappingService } from '@enterpriseglue/shared/services/platform-admin/EngineBackstopGroupMappingService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/encryption.js', () => ({
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
  decrypt: vi.fn((value: string) => value.replace('encrypted:', '')),
  hash: vi.fn((value: string) => value.includes('native-ops') ? 'a'.repeat(64) : 'b'.repeat(64)),
}));

const service = new EngineBackstopGroupMappingService();

function engine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'engine-1', type: 'camunda7', connectionMode: 'direct', lifecycleStatus: 'active', tenancyMode: 'dedicated', tenantId: 'tenant-a',
    ...overrides,
  };
}

function group(id: string, overrides: Record<string, unknown> = {}) {
  return { id, tenantId: 'tenant-a', isArchived: false, ...overrides };
}

function mapping(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mapping-1', tenantId: 'tenant-a', engineId: 'engine-1', authzGroupId: 'group-a',
    encryptedNativeGroupId: 'encrypted:native-ops', nativeGroupReference: `camunda-group-${'a'.repeat(24)}`,
    source: 'manual', sourceRef: 'authz-group:group-a', nativeGroupSecretRef: null, ownershipMode: 'manual', sourceHash: 'hash', lastAppliedAt: 1,
    isActive: true, createdById: 'user-1', createdAt: 1, updatedAt: 1,
    ...overrides,
  };
}

function setup(input: { currentEngine?: Record<string, unknown> | null; groups?: Record<string, Record<string, unknown>>; mappings?: Array<Record<string, unknown>> } = {}) {
  const currentEngine = input.currentEngine === undefined ? engine() : input.currentEngine;
  const groups = input.groups || { 'group-a': group('group-a') };
  const mappings = [...(input.mappings || [])];
  const engineRepo = { findOne: vi.fn().mockResolvedValue(currentEngine) };
  const groupRepo = { findOne: vi.fn().mockImplementation(({ where }) => groups[where.id] || null) };
  const mappingRepo = {
    find: vi.fn().mockImplementation(async ({ where }: any = {}) => mappings.filter((row) =>
      !where || Object.entries(where).every(([key, value]) => row[key] === value)
    )),
    insert: vi.fn().mockImplementation(async (row) => mappings.push(row)),
    update: vi.fn().mockImplementation(async ({ id }, values) => {
      const item = mappings.find((row) => row.id === id);
      if (item) Object.assign(item, values);
    }),
  };
  const store = {
    getRepository(entity: unknown) {
      if (entity === Engine) return engineRepo;
      if (entity === AuthzGroup) return groupRepo;
      if (entity === EngineBackstopGroupMapping) return mappingRepo;
      throw new Error('Unexpected repository');
    },
  };
  const dataSource = { ...store, transaction: vi.fn(async (callback) => callback(store)) };
  (getDataSource as unknown as Mock).mockResolvedValue(dataSource);
  return { engineRepo, groupRepo, mappingRepo, dataSource, mappings };
}

describe('EngineBackstopGroupMappingService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('encrypts native IDs, returns only opaque mapping summaries, and preserves a stable source identity', async () => {
    const state = setup();
    const result = await service.write({
      engineId: ' engine-1 ', actorId: 'user-1',
      request: { mappings: [{ authzGroupId: ' group-a ', nativeGroupId: ' native-ops ', isActive: true }] },
    });

    expect(result).toEqual({ mappings: [expect.objectContaining({
      engineId: 'engine-1', authzGroupId: 'group-a', tenantId: 'tenant-a', nativeGroupReference: `camunda-group-${'a'.repeat(24)}`,
    })] });
    expect(JSON.stringify(result)).not.toContain('native-ops');
    expect(state.mappingRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      encryptedNativeGroupId: 'encrypted:native-ops', source: 'manual', sourceRef: 'authz-group:group-a', ownershipMode: 'manual',
    }));
    await expect(service.list('engine-1')).resolves.toEqual(result.mappings);
  });

  it('prevents a native group from representing more than one EnterpriseGlue group for an engine', async () => {
    setup({ groups: { 'group-a': group('group-a'), 'group-b': group('group-b') } });
    await expect(service.write({
      engineId: 'engine-1',
      request: { mappings: [
        { authzGroupId: 'group-a', nativeGroupId: 'native-ops', isActive: true },
        { authzGroupId: 'group-b', nativeGroupId: 'native-ops', isActive: true },
      ] },
    })).rejects.toMatchObject({ code: 'ENGINE_BACKSTOP_MAPPING_CONFLICT', statusCode: 400 });

    setup({ groups: { 'group-b': group('group-b') }, mappings: [mapping()] });
    await expect(service.write({
      engineId: 'engine-1', request: { mappings: [{ authzGroupId: 'group-b', nativeGroupId: 'native-ops', isActive: true }] },
    })).rejects.toMatchObject({ code: 'ENGINE_BACKSTOP_MAPPING_CONFLICT', statusCode: 409 });
  });

  it('rejects unsupported or inactive engines and cross-tenant or archived groups', async () => {
    setup({ currentEngine: engine({ type: 'zeebe' }) });
    await expect(service.list('engine-1')).rejects.toMatchObject({ code: 'ENGINE_BACKSTOP_ENGINE_NOT_SUPPORTED' });

    setup({ currentEngine: engine({ connectionMode: 'customer_sidecar' }) });
    await expect(service.list('engine-1')).rejects.toMatchObject({
      code: 'ENGINE_BACKSTOP_ENGINE_NOT_SUPPORTED',
      message: 'Mirrored authorization backstop requires a direct Camunda 7 connection',
    });

    setup({ currentEngine: engine({ lifecycleStatus: 'stale' }) });
    await expect(service.list('engine-1')).rejects.toMatchObject({ code: 'ENGINE_BACKSTOP_ENGINE_INACTIVE' });

    setup({ groups: { 'group-a': group('group-a', { tenantId: 'tenant-b' }) } });
    await expect(service.write({ engineId: 'engine-1', request: { mappings: [{ authzGroupId: 'group-a', nativeGroupId: 'native-ops', isActive: true }] } }))
      .rejects.toMatchObject({ code: 'ENGINE_BACKSTOP_GROUP_NOT_USABLE', statusCode: 409 });

    setup({ groups: { 'group-a': group('group-a', { isArchived: true }) } });
    await expect(service.write({ engineId: 'engine-1', request: { mappings: [{ authzGroupId: 'group-a', nativeGroupId: 'native-ops', isActive: true }] } }))
      .rejects.toMatchObject({ code: 'ENGINE_BACKSTOP_GROUP_NOT_USABLE', statusCode: 404 });
  });

  it('provides decrypted mappings only to the internal projection path and applies the requested tenant boundary', async () => {
    setup({
      currentEngine: engine({ tenancyMode: 'shared', tenantId: null }),
      mappings: [
        mapping({ tenantId: 'tenant-a' }),
        mapping({ id: 'mapping-b', authzGroupId: 'group-b', tenantId: 'tenant-b', encryptedNativeGroupId: 'encrypted:native-b', nativeGroupReference: `camunda-group-${'b'.repeat(24)}` }),
      ],
    });
    await expect(service.activeProjectionMappings('engine-1', 'tenant-a')).resolves.toEqual([
      { authzGroupId: 'group-a', nativeGroupId: 'native-ops', isActive: true },
    ]);
    await expect(service.list('engine-1')).resolves.toEqual(expect.arrayContaining([
      expect.not.objectContaining({ nativeGroupId: expect.anything() }),
      expect.not.objectContaining({ encryptedNativeGroupId: expect.anything() }),
    ]));
  });

  it('moves a stable config mapping between configured engines without taking over a manual mapping', async () => {
    const state = setup({
      currentEngine: engine({ id: 'engine-2' }),
      mappings: [mapping({
        engineId: 'engine-1',
        source: 'config',
        sourceRef: 'config_bundle:acme.authz:engine_backstop_mapping:engine-backstop-mapping.ops',
        nativeGroupSecretRef: 'CAMUNDA_OPS_GROUP_OLD',
        ownershipMode: 'config_locked',
      })],
    });

    await service.write({
      engineId: 'engine-2',
      source: 'config',
      sourceRef: 'config_bundle:acme.authz:engine_backstop_mapping:engine-backstop-mapping.ops',
      nativeGroupSecretRef: 'CAMUNDA_OPS_GROUP',
      ownershipMode: 'config_locked',
      request: { mappings: [{ authzGroupId: 'group-a', nativeGroupId: 'native-ops', isActive: true }] },
    });

    expect(state.mappingRepo.update).toHaveBeenCalledWith({ id: 'mapping-1' }, expect.objectContaining({
      engineId: 'engine-2',
      nativeGroupSecretRef: 'CAMUNDA_OPS_GROUP',
    }));

    setup({ mappings: [mapping({ source: 'manual', ownershipMode: 'manual' })] });
    await expect(service.write({
      engineId: 'engine-1',
      source: 'config',
      sourceRef: 'config_bundle:acme.authz:engine_backstop_mapping:engine-backstop-mapping.ops',
      request: { mappings: [{ authzGroupId: 'group-a', nativeGroupId: 'native-ops', isActive: true }] },
    })).rejects.toMatchObject({ code: 'ENGINE_BACKSTOP_MAPPING_CONFLICT', statusCode: 409 });
  });
});
