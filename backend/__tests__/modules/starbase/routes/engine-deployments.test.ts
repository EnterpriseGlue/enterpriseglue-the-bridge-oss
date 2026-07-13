import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import engineDeploymentsRouter from '../../../../../packages/backend-host/src/modules/starbase/routes/engine-deployments.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EngineDeployment } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineDeployment.js';
import { EngineDeploymentArtifact } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineDeploymentArtifact.js';
import { File } from '@enterpriseglue/shared/infrastructure/persistence/entities/File.js';
import { FileCommitVersion } from '@enterpriseglue/shared/infrastructure/persistence/entities/FileCommitVersion.js';
import { Folder } from '@enterpriseglue/shared/infrastructure/persistence/entities/Folder.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { engineService } from '@enterpriseglue/shared/services/platform-admin/index.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    req.tenant = { tenantId: 'tenant-1' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/middleware/projectAuth.js', () => ({
  requireProjectAccess: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/index.js', () => ({
  engineService: {
    getUserEngines: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  ProjectPermissions: {
    FILES_VIEW: 'project:files:view',
  },
  permissionService: {
    hasPermission: vi.fn().mockResolvedValue(false),
  },
}));

describe('starbase engine-deployments routes', () => {
  let app: express.Application;
  let deploymentFind: ReturnType<typeof vi.fn>;
  let artifactFind: ReturnType<typeof vi.fn>;
  let fileFind: ReturnType<typeof vi.fn>;
  let fileFindOne: ReturnType<typeof vi.fn>;
  let folderFind: ReturnType<typeof vi.fn>;
  let fileCommitVersionFind: ReturnType<typeof vi.fn>;
  let projectFindOne: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(engineDeploymentsRouter);
    vi.clearAllMocks();

    deploymentFind = vi.fn().mockResolvedValue([]);
    artifactFind = vi.fn().mockResolvedValue([]);
    fileFind = vi.fn().mockResolvedValue([]);
    fileFindOne = vi.fn().mockResolvedValue({
      id: 'file-1',
      projectId: '11111111-1111-4111-8111-111111111111',
      name: 'invoice.bpmn',
      type: 'bpmn',
    });
    folderFind = vi.fn().mockResolvedValue([]);
    fileCommitVersionFind = vi.fn().mockResolvedValue([]);
    projectFindOne = vi.fn().mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: null,
    });

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project) {
          return { findOne: projectFindOne };
        }
        if (entity === EngineDeployment) {
          return { find: deploymentFind };
        }
        if (entity === EngineDeploymentArtifact) {
          return { find: artifactFind };
        }
        if (entity === File) {
          return { find: fileFind, findOne: fileFindOne };
        }
        if (entity === Folder) {
          return { find: folderFind };
        }
        if (entity === FileCommitVersion) {
          return { find: fileCommitVersionFind };
        }
        return {
          find: vi.fn().mockResolvedValue([]),
          findOne: vi.fn().mockResolvedValue(null),
        };
      },
    });
    (engineService.getUserEngines as unknown as Mock).mockResolvedValue([
      { engine: { id: 'engine-1' } },
    ]);
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);
  });

  it('lists visible engine deployments through project deployment read action', async () => {
    deploymentFind.mockResolvedValue([
      {
        id: 'deployment-1',
        projectId: '11111111-1111-4111-8111-111111111111',
        engineId: 'engine-1',
        engineName: 'Engine One',
        environmentTag: 'prod',
        deployedAt: 1700000000,
      },
    ]);

    const response = await request(app)
      .get('/starbase-api/projects/11111111-1111-4111-8111-111111111111/engine-deployments');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: 'deployment-1',
        projectId: '11111111-1111-4111-8111-111111111111',
        engineId: 'engine-1',
        environmentTag: 'prod',
      }),
    ]);
    expect(deploymentFind).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        projectId: '11111111-1111-4111-8111-111111111111',
      }),
    }));
    expect(engineService.getUserEngines).toHaveBeenCalledWith('user-1', 'tenant-1');
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      resourceId: '11111111-1111-4111-8111-111111111111',
    }));
  });

  it('lists latest project deployment metadata through project deployment read action', async () => {
    fileFind.mockResolvedValue([
      {
        id: 'file-1',
        name: 'invoice.bpmn',
        type: 'bpmn',
        folderId: null,
      },
    ]);
    artifactFind.mockResolvedValue([]);

    const response = await request(app)
      .get('/starbase-api/projects/11111111-1111-4111-8111-111111111111/engine-deployments/latest');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      resourceId: '11111111-1111-4111-8111-111111111111',
    }));
  });

  it('lists file deployment summaries through project deployment read action', async () => {
    artifactFind.mockResolvedValue([]);

    const response = await request(app)
      .get('/starbase-api/projects/11111111-1111-4111-8111-111111111111/files/file-1/deployments');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(fileFindOne).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'file-1',
        projectId: '11111111-1111-4111-8111-111111111111',
      },
    }));
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      resourceId: '11111111-1111-4111-8111-111111111111',
    }));
  });

  it('lists file deployment history through project deployment read action', async () => {
    artifactFind.mockResolvedValue([]);

    const response = await request(app)
      .get('/starbase-api/projects/11111111-1111-4111-8111-111111111111/files/file-1/deployments/history');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      resourceId: '11111111-1111-4111-8111-111111111111',
    }));
  });

  it('lists visible engine deployments when files-view permission is granted by the evaluator', async () => {
    deploymentFind.mockResolvedValue([
      {
        id: 'deployment-1',
        projectId: '11111111-1111-4111-8111-111111111111',
        engineId: 'engine-1',
        engineName: 'Engine One',
        environmentTag: 'prod',
        deployedAt: 1700000000,
      },
    ]);

    const response = await request(app)
      .get('/starbase-api/projects/11111111-1111-4111-8111-111111111111/engine-deployments');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: 'deployment-1',
        projectId: '11111111-1111-4111-8111-111111111111',
        engineId: 'engine-1',
      }),
    ]);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      resourceId: '11111111-1111-4111-8111-111111111111',
    }));
  });
});
