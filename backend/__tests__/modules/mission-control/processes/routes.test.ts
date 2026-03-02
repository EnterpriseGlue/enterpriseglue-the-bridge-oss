import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import processesRouter from '../../../../../packages/backend-host/src/modules/mission-control/processes/routes.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EngineDeploymentArtifact } from '@enterpriseglue/shared/db/entities/EngineDeploymentArtifact.js';
import { FileCommitVersion } from '@enterpriseglue/shared/db/entities/FileCommitVersion.js';
import { projectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/engineAuth.js', () => ({
  requireEngineReadOrWrite: () => (req: any, _res: any, next: any) => {
    req.engineId = 'engine-1';
    next();
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js', () => ({
  projectMemberService: {
    hasAccess: vi.fn().mockResolvedValue(true),
    hasRole: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../../../../../packages/backend-host/src/modules/mission-control/processes/service.js', () => ({
  listProcessDefinitions: vi.fn().mockResolvedValue([]),
  getProcessDefinition: vi.fn().mockResolvedValue({ id: 'pd1', key: 'process1' }),
  getProcessDefinitionXml: vi.fn().mockResolvedValue({ id: 'pd1', bpmn20Xml: '<bpmn/>' }),
  getProcessDefinitionStatistics: vi.fn().mockResolvedValue({}),
  startProcessInstance: vi.fn().mockResolvedValue({ id: 'pi1' }),
}));

describe('mission-control processes routes', () => {
  let app: express.Application;
  let artifactFind: ReturnType<typeof vi.fn>;
  let fileVersionFindOne: ReturnType<typeof vi.fn>;
  let fileVersionQbGetRawOne: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(processesRouter);
    vi.clearAllMocks();

    artifactFind = vi.fn().mockResolvedValue([]);
    fileVersionFindOne = vi.fn().mockResolvedValue(null);
    fileVersionQbGetRawOne = vi.fn().mockResolvedValue(null);

    const fileVersionRepo = {
      findOne: fileVersionFindOne,
      createQueryBuilder: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        getRawOne: fileVersionQbGetRawOne,
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EngineDeploymentArtifact) {
          return { find: artifactFind };
        }
        if (entity === FileCommitVersion) {
          return fileVersionRepo;
        }
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
      },
    });

    (projectMemberService.hasAccess as unknown as Mock).mockResolvedValue(true);
    (projectMemberService.hasRole as unknown as Mock).mockResolvedValue(true);
  });

  it('lists process definitions', async () => {
    const response = await request(app).get('/mission-control-api/process-definitions');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('returns process definition details', async () => {
    const response = await request(app).get('/mission-control-api/process-definitions/pd1');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: 'pd1', key: 'process1' });
  });

  it('validates edit-target query params', async () => {
    const response = await request(app)
      .get('/mission-control-api/process-definitions/edit-target')
      .query({ engineId: 'engine-1', key: 'invoice' });

    expect(response.status).toBe(400);
    expect(response.body?.error).toBe('Invalid query parameters');
  });

  it('resolves edit-target using processDefinitionId to disambiguate', async () => {
    artifactFind.mockResolvedValueOnce([
      {
        projectId: 'project-1',
        fileId: 'file-1',
        fileGitCommitId: 'commit-1',
        engineDeploymentId: 'dep-1',
        createdAt: 1700000000000,
      },
    ]);
    fileVersionFindOne.mockResolvedValueOnce({ versionNumber: 7 });

    const response = await request(app)
      .get('/mission-control-api/process-definitions/edit-target')
      .query({
        engineId: 'engine-1',
        key: 'invoice',
        version: 3,
        processDefinitionId: 'invoice:3:abc123',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      canShowEditButton: true,
      projectId: 'project-1',
      fileId: 'file-1',
      commitId: 'commit-1',
      fileVersionNumber: 7,
      mappingSource: 'git-commit',
    });

    expect(artifactFind).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        engineId: 'engine-1',
        artifactKind: 'process',
        artifactKey: 'invoice',
        artifactVersion: 3,
        artifactId: 'invoice:3:abc123',
      }),
    }));
  });

  it('falls back to key/version lookup when processDefinitionId has no artifact match', async () => {
    artifactFind
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          projectId: 'project-1',
          fileId: 'file-1',
          fileGitCommitId: null,
          engineDeploymentId: 'dep-1',
          createdAt: 1700000000000,
        },
      ]);
    fileVersionQbGetRawOne.mockResolvedValueOnce({ versionNumber: 6 });

    const response = await request(app)
      .get('/mission-control-api/process-definitions/edit-target')
      .query({
        engineId: 'engine-1',
        key: 'invoice',
        version: 3,
        processDefinitionId: 'invoice:3:not-found',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      projectId: 'project-1',
      fileId: 'file-1',
      fileVersionNumber: 6,
      mappingSource: 'db-timestamp',
    });

    expect(artifactFind).toHaveBeenCalledTimes(2);
    expect(artifactFind).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        artifactId: 'invoice:3:not-found',
      }),
    }));
    expect(artifactFind).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.not.objectContaining({ artifactId: expect.anything() }),
    }));
  });

  it('falls back to timestamp-based mapping when commit mapping is unavailable', async () => {
    artifactFind.mockResolvedValueOnce([
      {
        projectId: 'project-1',
        fileId: 'file-1',
        fileGitCommitId: null,
        engineDeploymentId: 'dep-1',
        createdAt: 1700000000000,
      },
    ]);
    fileVersionQbGetRawOne.mockResolvedValueOnce({ versionNumber: 4 });

    const response = await request(app)
      .get('/mission-control-api/process-definitions/edit-target')
      .query({ engineId: 'engine-1', key: 'invoice', version: 3 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      fileVersionNumber: 4,
      mappingSource: 'db-timestamp',
    });
  });

  it('falls back to latest version mapping when timestamp mapping is unavailable', async () => {
    artifactFind.mockResolvedValueOnce([
      {
        projectId: 'project-1',
        fileId: 'file-1',
        fileGitCommitId: null,
        engineDeploymentId: 'dep-1',
        createdAt: 1700000000000,
      },
    ]);
    fileVersionQbGetRawOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ versionNumber: 9 });

    const response = await request(app)
      .get('/mission-control-api/process-definitions/edit-target')
      .query({ engineId: 'engine-1', key: 'invoice', version: 3 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      fileVersionNumber: 9,
      mappingSource: 'db-latest',
    });
  });

  it('skips inaccessible candidates and resolves the first accessible one', async () => {
    artifactFind.mockResolvedValueOnce([
      {
        projectId: 'project-denied',
        fileId: 'file-denied',
        fileGitCommitId: null,
        engineDeploymentId: 'dep-denied',
        createdAt: 1700000000001,
      },
      {
        projectId: 'project-allowed',
        fileId: 'file-allowed',
        fileGitCommitId: null,
        engineDeploymentId: 'dep-allowed',
        createdAt: 1700000000000,
      },
    ]);
    (projectMemberService.hasAccess as unknown as Mock)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    (projectMemberService.hasRole as unknown as Mock).mockResolvedValueOnce(false);
    fileVersionQbGetRawOne
      .mockResolvedValueOnce({ versionNumber: 10 });

    const response = await request(app)
      .get('/mission-control-api/process-definitions/edit-target')
      .query({ engineId: 'engine-1', key: 'invoice', version: 3 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      projectId: 'project-allowed',
      fileId: 'file-allowed',
      canEdit: false,
      fileVersionNumber: 10,
    });
  });

  it('returns 404 when no accessible deployed process mapping exists', async () => {
    artifactFind.mockResolvedValueOnce([
      {
        projectId: 'project-denied',
        fileId: 'file-denied',
        fileGitCommitId: null,
        engineDeploymentId: 'dep-denied',
        createdAt: 1700000000000,
      },
    ]);
    (projectMemberService.hasAccess as unknown as Mock).mockResolvedValueOnce(false);

    const response = await request(app)
      .get('/mission-control-api/process-definitions/edit-target')
      .query({ engineId: 'engine-1', key: 'invoice', version: 3 });

    expect(response.status).toBe(404);
  });
});
