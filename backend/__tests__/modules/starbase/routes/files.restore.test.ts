import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import filesRouter from '../../../../../packages/backend-host/src/modules/starbase/routes/files.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';
import { Commit } from '@enterpriseglue/shared/db/entities/Commit.js';
import { FileSnapshot } from '@enterpriseglue/shared/db/entities/FileSnapshot.js';
import { FileCommitVersion } from '@enterpriseglue/shared/db/entities/FileCommitVersion.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  fileOperationsLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js', () => ({
  projectMemberService: {
    hasRole: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('@enterpriseglue/shared/services/versioning/index.js', () => ({
  syncFileUpdate: vi.fn().mockResolvedValue(undefined),
}));

describe('starbase files routes - restore from commit', () => {
  let app: express.Application;

  let fileFindOne: ReturnType<typeof vi.fn>;
  let fileUpdate: ReturnType<typeof vi.fn>;
  let commitFindOne: ReturnType<typeof vi.fn>;
  let fileVersionFindOne: ReturnType<typeof vi.fn>;
  let snapshotsGetMany: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(filesRouter);
    vi.clearAllMocks();

    fileFindOne = vi.fn();
    fileUpdate = vi.fn().mockResolvedValue({ affected: 1 });
    commitFindOne = vi.fn();
    fileVersionFindOne = vi.fn();
    snapshotsGetMany = vi.fn();

    const snapshotQb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: snapshotsGetMany,
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === File) {
          return { findOne: fileFindOne, update: fileUpdate };
        }
        if (entity === Commit) {
          return { findOne: commitFindOne };
        }
        if (entity === FileSnapshot) {
          return { createQueryBuilder: vi.fn().mockReturnValue(snapshotQb) };
        }
        if (entity === FileCommitVersion) {
          return { findOne: fileVersionFindOne };
        }
        return {};
      },
    });
  });

  it('restores file snapshot by semantic file version number', async () => {
    fileFindOne.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      projectId: 'project-1',
      name: 'Invoice',
      type: 'bpmn',
      folderId: null,
    });

    // first call: resolve commit from file version
    fileVersionFindOne
      .mockResolvedValueOnce({ commitId: 'commit-1' })
      // second call: resolve semantic version by commit
      .mockResolvedValueOnce({ versionNumber: 5 });

    commitFindOne.mockResolvedValue({ id: 'commit-1' });

    snapshotsGetMany.mockResolvedValue([
      {
        content: '<bpmn:definitions><bpmn:process id="Process_5" isExecutable="true" /></bpmn:definitions>',
        changeType: 'modified',
      },
    ]);

    const response = await request(app)
      .post('/starbase-api/files/11111111-1111-1111-1111-111111111111/restore-from-commit')
      .send({ fileVersionNumber: 5 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      restored: true,
      commitId: 'commit-1',
      fileVersionNumber: 5,
    });
    expect(fileUpdate).toHaveBeenCalled();
  });

  it('rejects restore when commit does not belong to file project', async () => {
    fileFindOne.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      projectId: 'project-1',
      name: 'Invoice',
      type: 'bpmn',
      folderId: null,
    });

    commitFindOne.mockResolvedValue(null);

    const response = await request(app)
      .post('/starbase-api/files/11111111-1111-1111-1111-111111111111/restore-from-commit')
      .send({ commitId: 'foreign-commit' });

    expect(response.status).toBe(404);
    expect(fileUpdate).not.toHaveBeenCalled();
  });
});
