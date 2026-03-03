import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { createHash } from 'crypto';
import { GitRepository } from '@enterpriseglue/shared/db/entities/GitRepository.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';
import { Folder } from '@enterpriseglue/shared/db/entities/Folder.js';
import { pushToRemote } from '@enterpriseglue/shared/services/git/remote-git-push.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { vcsService } from '@enterpriseglue/shared/services/versioning/index.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@enterpriseglue/shared/services/versioning/index.js', () => ({
  vcsService: {
    getMainBranch: vi.fn(),
    commit: vi.fn(),
  },
}));

describe('pushToRemote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns no changes when manifest matches', async () => {
    const content = '<xml />';
    const hash = createHash('sha256').update(content).digest('hex');

    const repoRepo = {
      findOne: vi.fn().mockResolvedValue({
        id: 'repo-1',
        lastCommitSha: 'sha-main',
        lastPushedManifest: JSON.stringify({ 'Order.bpmn': hash }),
      }),
      update: vi.fn(),
    };
    const fileRepo = {
      find: vi.fn().mockResolvedValue([
        { id: 'file-1', folderId: null, name: 'Order', type: 'bpmn', xml: content },
      ]),
    };
    const folderRepo = {
      findBy: vi.fn().mockResolvedValue([]),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === GitRepository) return repoRepo;
        if (entity === File) return fileRepo;
        if (entity === Folder) return folderRepo;
        throw new Error('Unknown repository');
      },
    });

    const client = {
      getBranches: vi.fn().mockResolvedValue([{ name: 'main', sha: 'sha-main' }]),
      getTree: vi.fn().mockResolvedValue([]),
      pushFiles: vi.fn(),
    };

    const result = await pushToRemote(client as any, 'project-1', {
      repo: 'org/repo',
      message: 'Sync',
    });

    expect(result.commit).toBeNull();
    expect(result.pushedFilesCount).toBe(0);
    expect(client.pushFiles).not.toHaveBeenCalled();
    expect(client.getTree).not.toHaveBeenCalled();
    expect(repoRepo.update).not.toHaveBeenCalled();
  });

  it('pushes changes and updates manifest', async () => {
    const repoRepo = {
      findOne: vi.fn().mockResolvedValue({
        id: 'repo-1',
        lastCommitSha: null,
        lastPushedManifest: null,
      }),
      update: vi.fn(),
    };
    const fileRepo = {
      find: vi.fn().mockResolvedValue([
        { id: 'file-1', folderId: null, name: 'Order', type: 'bpmn', xml: '<xml />' },
      ]),
    };
    const folderRepo = {
      findBy: vi.fn().mockResolvedValue([]),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === GitRepository) return repoRepo;
        if (entity === File) return fileRepo;
        if (entity === Folder) return folderRepo;
        throw new Error('Unknown repository');
      },
    });

    (vcsService.getMainBranch as unknown as Mock).mockResolvedValue({ id: 'main-branch' });
    (vcsService.commit as unknown as Mock).mockResolvedValue({ id: 'vcs-1' });

    const client = {
      getTree: vi.fn().mockResolvedValue([]),
      pushFiles: vi.fn().mockResolvedValue({ sha: 'commit-sha' }),
    };

    const result = await pushToRemote(client as any, 'project-1', {
      repo: 'org/repo',
      message: 'Sync',
      userId: 'user-1',
    });

    expect(result.pushedFilesCount).toBe(1);
    expect(client.pushFiles).toHaveBeenCalled();
    expect(repoRepo.update).toHaveBeenCalledWith({ id: 'repo-1' }, expect.objectContaining({
      lastPushedManifest: expect.any(String),
      lastCommitSha: 'commit-sha',
    }));
    expect(vcsService.commit).toHaveBeenCalled();
  });

  it('throws when no files exist to push', async () => {
    const repoRepo = {
      findOne: vi.fn().mockResolvedValue({ id: 'repo-1', lastCommitSha: null, lastPushedManifest: null }),
      update: vi.fn(),
    };
    const fileRepo = {
      find: vi.fn().mockResolvedValue([]),
    };
    const folderRepo = {
      findBy: vi.fn().mockResolvedValue([]),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === GitRepository) return repoRepo;
        if (entity === File) return fileRepo;
        if (entity === Folder) return folderRepo;
        throw new Error('Unknown repository');
      },
    });

    const client = {
      getTree: vi.fn().mockResolvedValue([]),
      pushFiles: vi.fn(),
    };

    await expect(
      pushToRemote(client as any, 'project-1', { repo: 'org/repo' })
    ).rejects.toThrow('No files to push');
  });
});
