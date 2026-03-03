import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { EnvironmentTagService } from '@enterpriseglue/shared/services/platform-admin/EnvironmentTagService.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EnvironmentTag } from '@enterpriseglue/shared/db/entities/EnvironmentTag.js';
import { Engine } from '@enterpriseglue/shared/db/entities/Engine.js';

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
    const tagRepo = { delete: vi.fn() };
    const engineRepo = { findOne: vi.fn().mockResolvedValue({ id: 'engine-1' }) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EnvironmentTag) return tagRepo;
        if (entity === Engine) return engineRepo;
        throw new Error('Unexpected repository');
      },
    });

    await expect(service.delete('env-1')).rejects.toThrow('Cannot delete environment tag');
  });

  it('reorders tags', async () => {
    const tagRepo = { update: vi.fn() };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EnvironmentTag) return tagRepo;
        throw new Error('Unexpected repository');
      },
    });

    await service.reorder(['env-a', 'env-b']);
    expect(tagRepo.update).toHaveBeenCalledTimes(2);
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
