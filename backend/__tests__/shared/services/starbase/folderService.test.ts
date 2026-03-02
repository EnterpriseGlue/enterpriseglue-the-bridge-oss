import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { folderService } from '@enterpriseglue/shared/services/starbase/FolderService.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Folder } from '@enterpriseglue/shared/db/entities/Folder.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('folderService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gets folder by id', async () => {
    const folderRepo = {
      findOne: vi.fn().mockResolvedValue({
        id: 'folder-1',
        projectId: 'proj-1',
        parentFolderId: null,
        name: 'Processes',
        createdAt: 1000,
        updatedAt: 2000,
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Folder) return folderRepo;
        throw new Error('Unexpected repository');
      },
    });

    const result = await folderService.getById('folder-1');
    expect(result?.id).toBe('folder-1');
    expect(result?.name).toBe('Processes');
  });

  it('creates folder', async () => {
    const folderRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([]),
      }),
      insert: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Folder) return folderRepo;
        throw new Error('Unexpected repository');
      },
    });

    const result = await folderService.create({
      projectId: 'proj-1',
      name: 'New Folder',
      userId: 'user-1',
    });

    expect(result.name).toBe('New Folder');
    expect(folderRepo.insert).toHaveBeenCalled();
  });
});
