import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { EnvironmentTagService } from '@enterpriseglue/shared/services/platform-admin/EnvironmentTagService.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EnvironmentTag } from '@enterpriseglue/shared/db/entities/EnvironmentTag.js';
import { Engine } from '@enterpriseglue/shared/db/entities/Engine.js';
import { PlatformSettings } from '@enterpriseglue/shared/infrastructure/persistence/entities/PlatformSettings.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/utils/logger.js', () => ({
  logger: { info: vi.fn() },
}));

describe('EnvironmentTagService', () => {
  const service = new EnvironmentTagService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates environment tag with next sort order', async () => {
    const tagRepo = {
      find: vi.fn().mockResolvedValue([{ sortOrder: 1 }]),
      insert: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EnvironmentTag) return tagRepo;
        throw new Error('Unexpected repository');
      },
    });

    const tag = await service.create({ name: 'Dev' });
    expect(tag.sortOrder).toBe(2);
    expect(tagRepo.insert).toHaveBeenCalled();
  });

  it('prevents delete when tag in use', async () => {
    const tagRepo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'env-1', name: 'Dev', sourceRef: null, ownershipMode: 'manual', configGeneration: 0 }),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      delete: vi.fn(),
    };
    const engineRepo = { findOne: vi.fn().mockResolvedValue({ id: 'engine-1' }) };
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === EnvironmentTag) return tagRepo;
        if (entity === Engine) return engineRepo;
        throw new Error('Unexpected repository');
      },
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      ...manager,
      transaction: (callback: (store: typeof manager) => unknown) => callback(manager),
    });

    await expect(service.delete('env-1')).rejects.toThrow('Cannot delete environment tag');
  });

  it('reorders tags', async () => {
    const tagRepo = {
      find: vi.fn().mockResolvedValue([
        { id: 'env-a', name: 'A', sourceRef: null, ownershipMode: 'manual', configGeneration: 0 },
        { id: 'env-b', name: 'B', sourceRef: null, ownershipMode: 'manual', configGeneration: 0 },
      ]),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === EnvironmentTag) return tagRepo;
        throw new Error('Unexpected repository');
      },
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      ...manager,
      transaction: (callback: (store: typeof manager) => unknown) => callback(manager),
    });

    await service.reorder(['env-a', 'env-b']);
    expect(tagRepo.update).toHaveBeenCalledTimes(4);
  });

  it('cannot replace a configuration-owned default from the portal', async () => {
    const target = { id: 'env-manual', name: 'Manual', sourceRef: null, ownershipMode: 'manual', configGeneration: 0, isDefault: false };
    const lockedDefault = { id: 'env-locked', name: 'Production', sourceRef: 'config_bundle:headless.admin', ownershipMode: 'config_locked', configGeneration: 1, isDefault: true };
    const tagRepo = {
      findOneBy: vi.fn().mockResolvedValue(target),
      find: vi.fn().mockResolvedValue([lockedDefault]),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const manager = { getRepository: () => tagRepo };
    (getDataSource as unknown as Mock).mockResolvedValue({
      ...manager,
      transaction: (callback: (store: typeof manager) => unknown) => callback(manager),
    });

    await expect(service.setDefault(target.id)).rejects.toThrow('managed by configuration');
    expect(tagRepo.update).not.toHaveBeenCalled();
  });

  it('rejects a configuration apply when the environment generation changed after preview', async () => {
    const current = {
      id: 'env-owned', name: 'Production', color: '#da1e28', manualDeployAllowed: false,
      sortOrder: 3, isDefault: false, configKey: 'environment.production',
      sourceRef: 'config_bundle:platform.headless', ownershipMode: 'config_locked', sourceHash: 'old',
      configScopeKey: 'tenant-default',
      lastAppliedAt: 10, driftStatus: 'in_sync', configGeneration: 4, updatedAt: 20,
    };
    const tagRepo = {
      find: vi.fn().mockResolvedValue([current]),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      insert: vi.fn(),
      delete: vi.fn(),
    };
    const store = {
      getRepository: (entity: unknown) => {
        if (entity === EnvironmentTag) return tagRepo;
        if (entity === Engine || entity === PlatformSettings) return {};
        throw new Error('Unexpected repository');
      },
    } as any;

    await expect(service.applyConfiguration(store, [{
      key: 'environment.production', name: 'Production', color: '#0f62fe',
      manualDeployAllowed: false, sortOrder: 3, isDefault: false, ownershipMode: 'config_locked',
    }], {
      sourceRef: 'config_bundle:platform.headless', mode: 'additive', appliedAt: 30,
      tenantId: 'tenant-default',
      expectedGenerations: { 'environment.production': { updatedAt: 20, generation: 3 } },
    })).rejects.toThrow('changed after preview');

    expect(tagRepo.update).not.toHaveBeenCalled();
  });

  it('allows a first headless apply to replace the exact product-seeded default', async () => {
    const seededDefault = {
      id: 'env-dev', name: 'Dev', color: '#22c55e', manualDeployAllowed: true,
      sortOrder: 0, isDefault: true, configKey: null, sourceRef: null, ownershipMode: 'manual',
      sourceHash: null, lastAppliedAt: null, driftStatus: null, configGeneration: 0, updatedAt: 10,
    };
    const tagRepo = {
      find: vi.fn().mockResolvedValue([seededDefault]),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      insert: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn(),
    };
    const store = {
      getRepository: (entity: unknown) => {
        if (entity === EnvironmentTag) return tagRepo;
        if (entity === Engine || entity === PlatformSettings) return {};
        throw new Error('Unexpected repository');
      },
    } as any;

    await expect(service.applyConfiguration(store, [{
      key: 'environment.headless', name: 'Headless', color: '#0f62fe',
      manualDeployAllowed: false, sortOrder: 10, isDefault: true, ownershipMode: 'config_locked',
    }], {
      sourceRef: 'config_bundle:platform.headless', mode: 'additive', appliedAt: 30,
      expectedGenerations: {},
    })).resolves.toBeUndefined();

    expect(tagRepo.update).toHaveBeenCalledWith({ isDefault: true }, expect.objectContaining({ isDefault: false }));
    expect(tagRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      configKey: 'environment.headless', sourceRef: 'config_bundle:platform.headless', isDefault: true,
    }));
  });

  it('seeds defaults when none exist', async () => {
    const tagRepo = {
      find: vi.fn().mockResolvedValue([]),
      createQueryBuilder: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        orIgnore: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({}),
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EnvironmentTag) return tagRepo;
        throw new Error('Unexpected repository');
      },
    });

    await service.seedDefaults();
    expect(tagRepo.createQueryBuilder).toHaveBeenCalled();
  });
});
