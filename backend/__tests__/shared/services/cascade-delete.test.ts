import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { CascadeDeleteService } from '../../../src/shared/services/cascade-delete.js';
import { getDataSource } from '../../../src/shared/db/data-source.js';
import { Project } from '../../../src/shared/db/entities/Project.js';
import { Folder } from '../../../src/shared/db/entities/Folder.js';
import { File } from '../../../src/shared/db/entities/File.js';
import { Version } from '../../../src/shared/db/entities/Version.js';
import { Comment } from '../../../src/shared/db/entities/Comment.js';
import { GitRepository } from '../../../src/shared/db/entities/GitRepository.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('../../../src/shared/services/versioning/index.js', () => ({
  vcsService: {
    deleteProject: vi.fn(),
  },
}));

describe('CascadeDeleteService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes file with versions and comments', async () => {
    const fileRepo = { delete: vi.fn() };
    const versionRepo = { delete: vi.fn() };
    const commentRepo = { delete: vi.fn() };

    const getRepo = (entity: unknown) => {
      if (entity === File) return fileRepo;
      if (entity === Version) return versionRepo;
      if (entity === Comment) return commentRepo;
      throw new Error('Unexpected repository');
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: getRepo,
      transaction: async (cb: any) => cb({ getRepository: getRepo }),
    });

    await CascadeDeleteService.deleteFile('file-1');

    expect(commentRepo.delete).toHaveBeenCalledWith({ fileId: 'file-1' });
    expect(versionRepo.delete).toHaveBeenCalledWith({ fileId: 'file-1' });
    expect(fileRepo.delete).toHaveBeenCalledWith({ id: 'file-1' });
  });

  it('gets project deletion stats', async () => {
    const folderRepo = { count: vi.fn().mockResolvedValue(2) };
    const fileRepo = { find: vi.fn().mockResolvedValue([{ id: 'f1' }, { id: 'f2' }]) };
    const versionRepo = { count: vi.fn().mockResolvedValue(3) };
    const commentRepo = { count: vi.fn().mockResolvedValue(1) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Folder) return folderRepo;
        if (entity === File) return fileRepo;
        if (entity === Version) return versionRepo;
        if (entity === Comment) return commentRepo;
        throw new Error('Unexpected repository');
      },
    });

    const stats = await CascadeDeleteService.getProjectDeletionStats('project-1');

    expect(stats.folderCount).toBe(2);
    expect(stats.fileCount).toBe(2);
    expect(stats.versionCount).toBe(6);
    expect(stats.commentCount).toBe(2);
  });

  it('gets folder deletion stats', async () => {
    const folderRepo = { find: vi.fn().mockResolvedValue([]) };
    const fileRepo = { find: vi.fn().mockResolvedValue([{ id: 'f1' }]) };
    const versionRepo = { count: vi.fn().mockResolvedValue(2) };
    const commentRepo = { count: vi.fn().mockResolvedValue(0) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Folder) return folderRepo;
        if (entity === File) return fileRepo;
        if (entity === Version) return versionRepo;
        if (entity === Comment) return commentRepo;
        throw new Error('Unexpected repository');
      },
    });

    const stats = await CascadeDeleteService.getFolderDeletionStats('folder-1');

    expect(stats.folderCount).toBe(1);
    expect(stats.fileCount).toBe(1);
  });
});
