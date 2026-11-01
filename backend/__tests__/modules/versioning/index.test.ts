import { readFileSync } from 'node:fs';
import { CommitFileRestoreParamsSchema, CommitFileRestoreBodySchema } from '@enterpriseglue/shared/schemas/starbase/commit-snapshot.js';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import versioningRouter from '../../../../packages/backend-host/src/modules/versioning/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { FileSnapshot } from '@enterpriseglue/shared/db/entities/FileSnapshot.js';
import { FileCommitVersion } from '@enterpriseglue/shared/db/entities/FileCommitVersion.js';
import { vcsService } from '@enterpriseglue/shared/services/versioning/index.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';

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

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  ProjectPermissions: {
    FILES_VIEW: 'project:files:view',
    VERSIONS_CREATE: 'project:versions:create',
    VERSIONS_RESTORE: 'project:versions:restore',
  },
  permissionService: {
    hasPermission: vi.fn().mockResolvedValue(false),
  },
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
    getUncommittedIds: vi.fn(),
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
    app.use(errorHandler);
    vi.clearAllMocks();

    (vcsService.ensureInitialized as unknown as Mock).mockResolvedValue(true);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      [
        'project:files:view',
        'project:versions:create',
        'project:versions:restore',
      ].includes(permission)
    );
  });

  function projectRepository(overrides: Record<string, unknown> = {}) {
    return {
      findOne: vi.fn().mockResolvedValue({ id: projectId, tenantId: 'tenant-default' }),
      ...overrides,
    };
  }

  const snapshot = { id: 'snapshot-1', mainFileId: fileId, folderId: null, name: 'Invoice', type: 'bpmn', content: '<definitions/>', changeType: 'modified' };

  it('binds the canonical snapshot read to the route-authorized project and typed response', async () => {
    (getDataSource as Mock).mockResolvedValue({ getRepository: () => projectRepository() });
    (vcsService.getCommitSnapshots as Mock).mockResolvedValue([snapshot]);
    const response = await request(app).get(`/vcs-api/projects/${projectId}/commits/commit-1/files`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ files: [snapshot] });
    expect(vcsService.getCommitSnapshots).toHaveBeenCalledWith('commit-1', projectId);
  });

  it('denies snapshot reads without the existing project permission', async () => {
    (getDataSource as Mock).mockResolvedValue({ getRepository: () => projectRepository() });
    (permissionService.hasPermission as Mock).mockResolvedValue(false);
    expect((await request(app).get(`/vcs-api/projects/${projectId}/commits/commit-1/files`)).status).toBe(403);
    expect(vcsService.getCommitSnapshots).not.toHaveBeenCalled();
  });

  it.each([1, 0])('keeps restore updates within the authorized project and requires one affected row (%s)', async affected => {
    const update = vi.fn().mockResolvedValue({ affected });
    (getDataSource as Mock).mockResolvedValue({ getRepository: (entity: unknown) => entity === Project ? projectRepository() : { update, find: vi.fn().mockResolvedValue([]) } });
    (vcsService.getCommitSnapshots as Mock).mockResolvedValue([snapshot]);
    (vcsService.getUserBranch as Mock).mockResolvedValue({ id: 'branch-1' });
    (vcsService.commit as Mock).mockResolvedValue({ id: 'restored' });
    const response = await request(app).post(`/vcs-api/projects/${projectId}/commits/commit-1/restore`);
    expect(vcsService.getCommitSnapshots).toHaveBeenCalledWith('commit-1', projectId);
    expect(update).toHaveBeenCalledWith({ id: fileId, projectId }, expect.objectContaining({ xml: snapshot.content }));
    if (affected === 1) expect(response.status).toBe(200);
    else { expect(response.status).toBeGreaterThanOrEqual(400); expect(vcsService.commit).not.toHaveBeenCalled(); }
  });

  it('validates the documented file-scoped request and keeps no-body project restore compatible', () => {
    const example = JSON.parse(readFileSync(new URL('../../../../docs/examples/vcs-file-restore.json', import.meta.url), 'utf8'));
    expect(CommitFileRestoreParamsSchema.parse(example.params)).toEqual(example.params);
    expect(CommitFileRestoreBodySchema.parse(example.body)).toEqual({});
    expect(CommitFileRestoreBodySchema.parse(undefined)).toEqual({});
  });

  it.each([{ fileId: 'not-a-uuid' }, { fileId, fileIds: [fileId] }, { command: 'restore' }])('rejects malformed or widened restore scope before reading snapshots (%j)', async body => {
    expect((await request(app).post(`/vcs-api/projects/${projectId}/commits/commit-1/files/${fileId}/restore`).send(body)).status).toBe(400);
    expect(vcsService.getCommitSnapshots).not.toHaveBeenCalled();
  });

  it('retains the existing restore permission on the distinct file restore route', async () => {
    (getDataSource as Mock).mockResolvedValue({ getRepository: () => projectRepository() });
    (permissionService.hasPermission as Mock).mockResolvedValue(false);
    expect((await request(app).post(`/vcs-api/projects/${projectId}/commits/commit-1/files/${fileId}/restore`)).status).toBe(403);
    expect(vcsService.getCommitSnapshots).not.toHaveBeenCalled();
  });

  it('rejects malformed file identity before querying snapshots', async () => {
    expect((await request(app).post(`/vcs-api/projects/${projectId}/commits/commit-1/files/not-a-uuid/restore`)).status).toBe(400);
    expect(vcsService.getCommitSnapshots).not.toHaveBeenCalled();
  });

  it('restores and checkpoints only the file selected by the version panel', async () => {
    const siblingId = '33333333-3333-4333-8333-333333333333';
    const ownFile = { id: fileId, projectId, name: 'Invoice renamed', type: 'bpmn', folderId: null, xml: '<draft/>' };
    const sibling = { ...ownFile, id: siblingId, name: 'Sibling', xml: '<sibling-draft/>' };
    const update = vi.fn().mockResolvedValue({ affected: 1 });
    const find = vi.fn().mockImplementation(({ where }) => Promise.resolve(where.id ? [ownFile] : [ownFile, sibling]));
    (getDataSource as Mock).mockResolvedValue({ getRepository: (entity: unknown) => entity === Project ? projectRepository() : { update, find, findOne: vi.fn().mockResolvedValue(ownFile) } });
    (vcsService.getCommitSnapshots as Mock).mockResolvedValue([snapshot, { ...snapshot, id: 'sibling-snapshot', mainFileId: siblingId, name: 'Sibling', content: '<sibling-saved/>' }]);
    (vcsService.getUserBranch as Mock).mockResolvedValue({ id: 'branch-1' });
    (vcsService.commit as Mock).mockResolvedValue({ id: 'restored' });
    const response = await request(app).post(`/vcs-api/projects/${projectId}/commits/commit-1/files/${fileId}/restore`);
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ id: fileId, projectId }, expect.objectContaining({ xml: snapshot.content }));
    expect(find).toHaveBeenCalledWith({ where: { projectId, id: fileId } });
    expect(vcsService.saveFile).toHaveBeenCalledTimes(1);
    expect(vcsService.commit).toHaveBeenCalledWith('branch-1', 'user-1', expect.any(String), { source: 'file-save', fileIds: [fileId] });
    expect(response.body.filesRestored).toBe(1);
  });

  it.each(['status', 'uncommitted-files'])('denies the requested project on %s even when a sibling project is visible', async suffix => {
    const siblingId = '33333333-3333-4333-8333-333333333333';
    const find = vi.fn().mockResolvedValue([{ id: projectId }, { id: siblingId }]);
    (getDataSource as Mock).mockResolvedValue({ getRepository: () => projectRepository({ find }) });
    (permissionService.hasPermission as Mock).mockImplementation(async (_permission, context) => context.resourceId === siblingId);
    expect((await request(app).get(`/vcs-api/projects/${projectId}/${suffix}`)).status).toBe(403);
    expect(find).not.toHaveBeenCalled();
    expect(vcsService.getUncommittedIds).not.toHaveBeenCalled();
    expect(vcsService.getMainBranch).not.toHaveBeenCalled();
  });

  it('passes an absent draft head as null instead of the string null', async () => {
    (getDataSource as Mock).mockResolvedValue({ getRepository: () => projectRepository() });
    (vcsService.getUserBranch as Mock).mockResolvedValue({ id: 'draft', headCommitId: null });
    (vcsService.getUncommittedIds as Mock).mockResolvedValue({ fileIds: [], folderIds: [] });
    expect((await request(app).get(`/vcs-api/projects/${projectId}/uncommitted-files?baseline=draft`)).status).toBe(200);
    expect(vcsService.getUncommittedIds).toHaveBeenCalledWith(projectId, { baselineCommitId: null, treatNoBaselineAsAll: false });
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
        if (entity === Project) return projectRepository();
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

  it('includes uncommitted status through the project collection action permission', async () => {
    const projectFind = vi.fn().mockResolvedValue([{ id: projectId, tenantId: 'tenant-default' }]);
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project) return { find: projectFind };
        return {};
      },
    });
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) => permission === 'project:files:view');
    (vcsService.getUncommittedIds as unknown as Mock).mockResolvedValue({ fileIds: [fileId], folderIds: [] });

    const response = await request(app)
      .get('/vcs-api/projects/uncommitted-status')
      .query({ projectIds: projectId });

    expect(response.status).toBe(200);
    expect(response.body.statuses[projectId]).toEqual({
      hasUncommittedChanges: true,
      dirtyFileCount: 1,
    });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      resourceId: projectId,
    }));
    expect(projectFind).toHaveBeenCalledWith({
      where: { id: expect.any(Object) },
      select: ['id', 'tenantId'],
    });
    expect(vcsService.getUncommittedIds).toHaveBeenCalledWith(projectId);
  });

  it('filters denied projects from batch uncommitted status before VCS work starts', async () => {
    const projectFind = vi.fn().mockResolvedValue([{ id: projectId, tenantId: 'tenant-default' }]);
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project) return { find: projectFind };
        return {};
      },
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app)
      .get('/vcs-api/projects/uncommitted-status')
      .query({ projectIds: projectId });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ statuses: {} });
    expect(vcsService.ensureInitialized).not.toHaveBeenCalled();
    expect(vcsService.getUncommittedIds).not.toHaveBeenCalled();
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
        if (entity === Project) return projectRepository();
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
        if (entity === Project) return projectRepository();
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

  it('denies committing when project version creation is unavailable', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project) return projectRepository();
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app)
      .post(`/vcs-api/projects/${projectId}/commit`)
      .send({ message: 'Save Invoice', fileIds: [fileId] });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('project.vcs.commit.create');
    expect(vcsService.getUserBranch).not.toHaveBeenCalled();
  });
});
