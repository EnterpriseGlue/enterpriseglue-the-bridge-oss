import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import versioningRouter from '../../../../packages/backend-host/src/modules/versioning/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';
import { FileSnapshot } from '@enterpriseglue/shared/db/entities/FileSnapshot.js';
import { FileCommitVersion } from '@enterpriseglue/shared/db/entities/FileCommitVersion.js';
import { vcsService } from '@enterpriseglue/shared/services/versioning/index.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/projectAuth.js', () => ({
  requireProjectAccess: () => (_req: any, _res: any, next: any) => next(),
  requireProjectRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/services/versioning/index.js', () => ({
  vcsService: {
    ensureInitialized: vi.fn(),
    getUserBranch: vi.fn(),
    saveFile: vi.fn(),
    commit: vi.fn(),
    getMainBranch: vi.fn(),
    getCommits: vi.fn(),
    mergeToMain: vi.fn(),
    hasUncommittedChanges: vi.fn(),
    getCommitSnapshots: vi.fn(),
    commitHasFile: vi.fn(),
    getLastCommitForFile: vi.fn(),
    syncFromMainDb: vi.fn(),
    getSyncStatus: vi.fn(),
  },
}));

describe('versioning routes', () => {
  let app: express.Application;

  const projectId = '11111111-1111-1111-8111-111111111111';
  const fileId = '22222222-2222-2222-8222-222222222222';

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(versioningRouter);
    vi.clearAllMocks();

    (vcsService.ensureInitialized as unknown as Mock).mockResolvedValue(true);
  });

  it('scopes file-save commits to the selected file ids for offline-like save flow', async () => {
    const fileFind = vi.fn().mockResolvedValue([
      {
        id: fileId,
        name: 'Invoice',
        type: 'bpmn',
        xml: '<bpmn />',
        folderId: null,
      },
    ]);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === File) return { find: fileFind };
        return {};
      },
    });

    (vcsService.getUserBranch as unknown as Mock).mockResolvedValue({ id: 'draft-branch-1' });
    (vcsService.saveFile as unknown as Mock).mockResolvedValue({ id: 'working-file-1' });
    (vcsService.commit as unknown as Mock).mockResolvedValue({
      id: 'commit-1',
      message: 'Save Invoice',
      createdAt: 1700000000000,
    });

    const response = await request(app)
      .post(`/vcs-api/projects/${projectId}/commit`)
      .send({ message: 'Save Invoice', fileIds: [fileId] });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      commitId: 'commit-1',
      message: 'Save Invoice',
      fileCount: 1,
    });

    expect(fileFind).toHaveBeenCalledWith({
      where: { projectId, id: expect.any(Object) },
    });
    expect(vcsService.saveFile).toHaveBeenCalledTimes(1);
    expect(vcsService.saveFile).toHaveBeenCalledWith(
      'draft-branch-1',
      projectId,
      null,
      'Invoice',
      'bpmn',
      '<bpmn />',
      null,
      fileId
    );
    expect(vcsService.commit).toHaveBeenCalledWith(
      'draft-branch-1',
      'user-1',
      'Save Invoice',
      {
        source: 'file-save',
        fileIds: [fileId],
      }
    );
  });

  it('returns file history using explicit file membership while excluding unrelated file-save commits in connected-like flow', async () => {
    const fileFindOne = vi.fn().mockResolvedValue({
      name: 'Invoice',
      type: 'bpmn',
      folderId: null,
    });
    const fileCommitVersionCount = vi.fn().mockResolvedValue(2);
    const fileCommitVersionFind = vi.fn().mockResolvedValue([
      { commitId: 'commit-selected', versionNumber: 7 },
    ]);
    const snapshotGetRawMany = vi.fn().mockResolvedValue([
      { commitId: 'commit-legacy' },
    ]);

    const snapshotQb = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      getRawMany: snapshotGetRawMany,
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === File) {
          return { findOne: fileFindOne };
        }
        if (entity === FileCommitVersion) {
          return {
            count: fileCommitVersionCount,
            find: fileCommitVersionFind,
          };
        }
        if (entity === FileSnapshot) {
          return {
            createQueryBuilder: vi.fn().mockReturnValue(snapshotQb),
          };
        }
        return {};
      },
    });

    (vcsService.getMainBranch as unknown as Mock).mockResolvedValue({ id: 'main-branch-1' });
    (vcsService.getUserBranch as unknown as Mock).mockResolvedValue({ id: 'draft-branch-1' });
    (vcsService.getCommits as unknown as Mock).mockImplementation(async (branchId: string) => {
      if (branchId === 'main-branch-1') {
        return [
          {
            id: 'commit-legacy',
            projectId,
            branchId,
            userId: 'user-1',
            message: 'Legacy version',
            hash: 'hash-legacy',
            createdAt: 1700000000000,
            source: 'manual',
            isRemote: true,
          },
        ];
      }

      return [
        {
          id: 'commit-selected',
          projectId,
          branchId,
          userId: 'user-1',
          message: 'Save Invoice',
          hash: 'hash-selected',
          createdAt: 1700000000100,
          source: 'file-save',
          isRemote: false,
        },
        {
          id: 'commit-other',
          projectId,
          branchId,
          userId: 'user-1',
          message: 'Save Different File',
          hash: 'hash-other',
          createdAt: 1700000000200,
          source: 'file-save',
          isRemote: false,
        },
      ];
    });

    const response = await request(app)
      .get(`/vcs-api/projects/${projectId}/commits`)
      .query({ branch: 'all', fileId });

    expect(response.status).toBe(200);
    expect(response.body.commits).toHaveLength(2);
    expect(response.body.commits.map((commit: any) => commit.id)).toEqual([
      'commit-selected',
      'commit-legacy',
    ]);
    expect(response.body.commits[0]).toMatchObject({
      id: 'commit-selected',
      source: 'file-save',
      fileVersionNumber: 7,
    });
    expect(response.body.commits[1]).toMatchObject({
      id: 'commit-legacy',
      message: 'Legacy version',
    });
    expect(response.body.commits.find((commit: any) => commit.id === 'commit-other')).toBeUndefined();
    expect(fileFindOne).toHaveBeenCalledWith({
      where: { id: fileId },
      select: ['id', 'name', 'type', 'folderId']
    });
    expect(fileCommitVersionCount).toHaveBeenCalledWith({ where: { fileId } });
    expect(fileCommitVersionFind).toHaveBeenCalled();
    expect(snapshotGetRawMany).toHaveBeenCalled();
  });

  it('includes related system commits while preserving file version numbering semantics', async () => {
    const fileFindOne = vi.fn().mockResolvedValue({
      name: 'Invoice',
      type: 'bpmn',
      folderId: null,
    });
    const fileCommitVersionCount = vi.fn().mockResolvedValue(1);
    const fileCommitVersionFind = vi.fn().mockResolvedValue([
      { commitId: 'commit-selected', versionNumber: 7 },
    ]);
    const snapshotGetRawMany = vi.fn().mockResolvedValue([
      { commitId: 'commit-system' },
      { commitId: 'commit-legacy' },
    ]);

    const snapshotQb = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      getRawMany: snapshotGetRawMany,
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === File) {
          return { findOne: fileFindOne };
        }
        if (entity === FileCommitVersion) {
          return {
            count: fileCommitVersionCount,
            find: fileCommitVersionFind,
          };
        }
        if (entity === FileSnapshot) {
          return {
            createQueryBuilder: vi.fn().mockReturnValue(snapshotQb),
          };
        }
        return {};
      },
    });

    (vcsService.getMainBranch as unknown as Mock).mockResolvedValue({ id: 'main-branch-1' });
    (vcsService.getUserBranch as unknown as Mock).mockResolvedValue({ id: 'draft-branch-1' });
    (vcsService.getCommits as unknown as Mock).mockImplementation(async (branchId: string) => {
      if (branchId === 'main-branch-1') {
        return [
          {
            id: 'commit-system',
            projectId,
            branchId,
            userId: 'user-1',
            message: 'Nightly baseline',
            hash: 'hash-system',
            createdAt: 1700000000150,
            source: 'system',
            isRemote: true,
          },
          {
            id: 'commit-legacy',
            projectId,
            branchId,
            userId: 'user-1',
            message: 'Legacy version',
            hash: 'hash-legacy',
            createdAt: 1700000000000,
            source: 'manual',
            isRemote: true,
          },
        ];
      }

      return [
        {
          id: 'commit-selected',
          projectId,
          branchId,
          userId: 'user-1',
          message: 'Save Invoice',
          hash: 'hash-selected',
          createdAt: 1700000000100,
          source: 'file-save',
          isRemote: false,
        },
        {
          id: 'commit-other',
          projectId,
          branchId,
          userId: 'user-1',
          message: 'Save Different File',
          hash: 'hash-other',
          createdAt: 1700000000200,
          source: 'file-save',
          isRemote: false,
        },
      ];
    });

    const response = await request(app)
      .get(`/vcs-api/projects/${projectId}/commits`)
      .query({ branch: 'all', fileId });

    expect(response.status).toBe(200);
    expect(response.body.commits.map((commit: any) => commit.id)).toEqual([
      'commit-system',
      'commit-selected',
      'commit-legacy',
    ]);
    expect(response.body.commits[0]).toMatchObject({
      id: 'commit-system',
      source: 'system',
      message: 'Nightly baseline',
    });
    expect(response.body.commits[1]).toMatchObject({
      id: 'commit-selected',
      fileVersionNumber: 7,
      source: 'file-save',
    });
    expect(response.body.commits.find((commit: any) => commit.id === 'commit-other')).toBeUndefined();
  });
});
