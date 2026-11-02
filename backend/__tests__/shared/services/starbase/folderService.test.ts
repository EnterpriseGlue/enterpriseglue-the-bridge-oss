import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { folderService } from '@enterpriseglue/shared/services/starbase/FolderService.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
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

    const source = {
      connection: { options: { type: 'sqljs' } },
      getRepository: (entity: unknown) => {
        if (entity === Folder) return folderRepo;
        if (entity === Project) return { findOne: vi.fn().mockResolvedValue({ id: 'proj-1' }) };
        throw new Error('Unexpected repository');
      },
      transaction: vi.fn(),
    };
    source.transaction.mockImplementation(async (work: any) => work(source));
    vi.mocked(getDataSource).mockResolvedValue(source as any);

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

    const source = {
      connection: { options: { type: 'sqljs' } },
      getRepository: (entity: unknown) => {
        if (entity === Folder) return folderRepo;
        if (entity === Project) return { findOne: vi.fn().mockResolvedValue({ id: 'proj-1' }) };
        throw new Error('Unexpected repository');
      },
      transaction: vi.fn(),
    };
    source.transaction.mockImplementation(async (work: any) => work(source));
    vi.mocked(getDataSource).mockResolvedValue(source as any);

    const result = await folderService.create({
      projectId: 'proj-1',
      name: 'New Folder',
      userId: 'user-1',
    });

    expect(result.name).toBe('New Folder');
    expect(folderRepo.insert).toHaveBeenCalled();
  });
});
