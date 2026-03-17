import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { VcsFileService } from '@enterpriseglue/shared/services/versioning/VcsFileService.js';
import { WorkingFile } from '@enterpriseglue/shared/db/entities/WorkingFile.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('VcsWorkingFileService', () => {
  const findOne = vi.fn();
  const update = vi.fn();
  const insert = vi.fn();
  const getOne = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    const qb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getOne,
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === WorkingFile) {
          return {
            findOne,
            update,
            insert,
            createQueryBuilder: vi.fn().mockReturnValue(qb),
          };
        }
        return {};
      },
    });
  });

  it('creates a new working file instead of hijacking another tracked file slot', async () => {
    findOne.mockResolvedValue(null);
    getOne.mockResolvedValue(null);
    insert.mockResolvedValue(undefined);

    const service = new VcsFileService();

    await service.saveFile('branch-1', 'project-1', null, 'Invoice', 'bpmn', '<xml />', null, 'file-b');

    expect(update).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      name: 'Invoice',
      type: 'bpmn',
      mainFileId: 'file-b',
    }));
  });

  it('backfills a legacy unlinked working file with the main file id', async () => {
    findOne.mockResolvedValue(null);
    getOne.mockResolvedValue({ id: 'wf-legacy' });
    update.mockResolvedValue(undefined);
    findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'wf-legacy',
      branchId: 'branch-1',
      projectId: 'project-1',
      mainFileId: 'file-b',
      folderId: null,
      name: 'Invoice',
      type: 'bpmn',
      content: '<xml />',
      contentHash: 'hash',
    });

    const service = new VcsFileService();

    await service.saveFile('branch-1', 'project-1', null, 'Invoice', 'bpmn', '<xml />', null, 'file-b');

    expect(update).toHaveBeenCalledWith({ id: 'wf-legacy' }, expect.objectContaining({
      mainFileId: 'file-b',
      name: 'Invoice',
      type: 'bpmn',
    }));
  });
});
