import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { fileService } from '@enterpriseglue/shared/services/starbase/FileService.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';
import { Version } from '@enterpriseglue/shared/db/entities/Version.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/versioning/index.js', () => ({
  syncFileUpdate: vi.fn(),
}));

describe('fileService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gets file by id', async () => {
    const fileRepo = {
      findOne: vi.fn().mockResolvedValue({
        id: 'file-1',
        projectId: 'proj-1',
        folderId: null,
        name: 'process.bpmn',
        type: 'bpmn',
        xml: '<xml/>',
        createdAt: 1000,
        updatedAt: 2000,
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === File) return fileRepo;
        throw new Error('Unexpected repository');
      },
    });

    const result = await fileService.getById('file-1');
    expect(result?.id).toBe('file-1');
    expect(result?.name).toBe('process.bpmn');
  });

  it('returns null for non-existent file', async () => {
    const fileRepo = { findOne: vi.fn().mockResolvedValue(null) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === File) return fileRepo;
        throw new Error('Unexpected repository');
      },
    });

    const result = await fileService.getById('missing');
    expect(result).toBeNull();
  });

  it('creates bpmn file with default template', async () => {
    const fileRepo = { insert: vi.fn(), find: vi.fn().mockResolvedValue([]) };
    const versionRepo = { insert: vi.fn() };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === File) return fileRepo;
        if (entity === Version) return versionRepo;
        throw new Error('Unexpected repository');
      },
    });

    const result = await fileService.create({
      projectId: 'proj-1',
      name: 'new.bpmn',
      type: 'bpmn',
      userId: 'user-1',
    });

    expect(result.name).toBe('new.bpmn');
    expect(fileRepo.insert).toHaveBeenCalled();
    expect(versionRepo.insert).toHaveBeenCalled();
  });
});
