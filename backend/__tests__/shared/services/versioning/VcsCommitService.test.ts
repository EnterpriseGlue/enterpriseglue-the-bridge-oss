import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Commit } from '@enterpriseglue/shared/db/entities/Commit.js';
import { FileSnapshot } from '@enterpriseglue/shared/db/entities/FileSnapshot.js';
import { FileCommitVersion } from '@enterpriseglue/shared/db/entities/FileCommitVersion.js';
import { File as MainFile } from '@enterpriseglue/shared/db/entities/File.js';
import { WorkingFile } from '@enterpriseglue/shared/db/entities/WorkingFile.js';
import { VcsCommitService } from '@enterpriseglue/shared/services/versioning/VcsCommitService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('VcsCommitService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats explicit file_commit_versions membership as authoritative for commitHasFile', async () => {
    const commitRepo = {
      findOne: vi.fn(),
    };
    const versionRepo = {
      findOne: vi.fn().mockResolvedValue({ commitId: 'commit-1' }),
    };
    const mainFileRepo = {
      findOne: vi.fn(),
    };
    const snapshotRepo = {
      createQueryBuilder: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Commit) return commitRepo;
        if (entity === FileCommitVersion) return versionRepo;
        if (entity === MainFile) return mainFileRepo;
        if (entity === FileSnapshot) return snapshotRepo;
        throw new Error('Unexpected repository');
      },
    });

    const service = new VcsCommitService();
    await expect(service.commitHasFile('commit-1', 'file-1')).resolves.toBe(true);
    expect(commitRepo.findOne).not.toHaveBeenCalled();
    expect(mainFileRepo.findOne).not.toHaveBeenCalled();
  });

  it('does not leak file-save commits to unrelated files via snapshot fallback', async () => {
    const commitRepo = {
      findOne: vi.fn().mockResolvedValue({ source: 'file-save' }),
    };
    const versionRepo = {
      findOne: vi.fn().mockResolvedValue(null),
    };
    const mainFileRepo = {
      findOne: vi.fn(),
    };
    const snapshotRepo = {
      createQueryBuilder: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Commit) return commitRepo;
        if (entity === FileCommitVersion) return versionRepo;
        if (entity === MainFile) return mainFileRepo;
        if (entity === FileSnapshot) return snapshotRepo;
        throw new Error('Unexpected repository');
      },
    });

    const service = new VcsCommitService();
    await expect(service.commitHasFile('commit-1', 'other-file')).resolves.toBe(false);
    expect(mainFileRepo.findOne).not.toHaveBeenCalled();
    expect(snapshotRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('prefers explicit file_commit_versions when resolving the latest commit for a file', async () => {
    const explicitQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      getRawOne: vi.fn().mockResolvedValue({
        id: 'commit-explicit',
        message: 'Saved just this file',
        createdAt: 1700000000000,
      }),
    };
    const commitRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(explicitQb),
    };
    const mainFileRepo = {
      findOne: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Commit) return commitRepo;
        if (entity === MainFile) return mainFileRepo;
        if (entity === FileCommitVersion) return {};
        if (entity === FileSnapshot) return {};
        throw new Error('Unexpected repository');
      },
    });

    const service = new VcsCommitService();
    await expect(service.getLastCommitForFile('project-1', 'file-1')).resolves.toEqual({
      id: 'commit-explicit',
      message: 'Saved just this file',
      createdAt: 1700000000000,
    });
    expect(mainFileRepo.findOne).not.toHaveBeenCalled();
  });

  it('keeps snapshots for distinct main files separate even when legacy keys match', async () => {
    const snapshotQb = {
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      getRawMany: vi.fn().mockResolvedValue([
        {
          id: 'snapshot-a',
          mainFileId: 'file-a',
          name: 'Invoice',
          type: 'bpmn',
          content: '<a />',
          changeType: 'modified',
          folderId: null,
          workingUpdatedAt: 10,
        },
        {
          id: 'snapshot-b',
          mainFileId: 'file-b',
          name: 'Invoice',
          type: 'bpmn',
          content: '<b />',
          changeType: 'modified',
          folderId: null,
          workingUpdatedAt: 20,
        },
      ]),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === FileSnapshot) {
          return { createQueryBuilder: vi.fn().mockReturnValue(snapshotQb) };
        }
        if (entity === WorkingFile) {
          return {};
        }
        throw new Error('Unexpected repository');
      },
    });

    const service = new VcsCommitService();
    await expect(service.getCommitSnapshots('commit-1')).resolves.toEqual([
      {
        id: 'snapshot-a',
        mainFileId: 'file-a',
        folderId: null,
        name: 'Invoice',
        type: 'bpmn',
        content: '<a />',
        changeType: 'modified',
      },
      {
        id: 'snapshot-b',
        mainFileId: 'file-b',
        folderId: null,
        name: 'Invoice',
        type: 'bpmn',
        content: '<b />',
        changeType: 'modified',
      },
    ]);
  });

  it('falls back to legacy snapshot history when no explicit file versions exist', async () => {
    const explicitQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      getRawOne: vi.fn().mockResolvedValue(null),
    };
    const snapshotQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      getRawOne: vi.fn().mockResolvedValue({
        id: 'commit-legacy',
        message: 'Legacy save',
        createdAt: 1690000000000,
      }),
    };
    const commitRepo = {
      createQueryBuilder: vi.fn()
        .mockReturnValueOnce(explicitQb)
        .mockReturnValueOnce(snapshotQb),
    };
    const mainFileRepo = {
      findOne: vi.fn().mockResolvedValue({
        name: 'Order',
        type: 'bpmn',
        folderId: null,
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Commit) return commitRepo;
        if (entity === MainFile) return mainFileRepo;
        if (entity === FileCommitVersion) return {};
        if (entity === FileSnapshot) return {};
        throw new Error('Unexpected repository');
      },
    });

    const service = new VcsCommitService();
    await expect(service.getLastCommitForFile('project-1', 'file-1')).resolves.toEqual({
      id: 'commit-legacy',
      message: 'Legacy save',
      createdAt: 1690000000000,
    });
    expect(mainFileRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'file-1' },
      select: ['id', 'name', 'type', 'folderId']
    });
  });
});
