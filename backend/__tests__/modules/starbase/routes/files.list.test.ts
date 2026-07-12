import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import filesRouter from '../../../../../packages/backend-host/src/modules/starbase/routes/files.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { File } from '@enterpriseglue/shared/infrastructure/persistence/entities/File.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { AuthorizationService } from '@enterpriseglue/shared/services/authorization.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', platformRole: 'user' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  fileOperationsLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js', () => ({
  projectMemberService: {
    hasRole: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  ProjectPermissions: {
    FILES_CREATE: 'project:files:create',
    FILES_EDIT: 'project:files:edit',
    FILES_DELETE: 'project:files:delete',
    FILES_VIEW: 'project:files:view',
    VERSIONS_RESTORE: 'project:versions:restore',
  },
  permissionService: {
    hasPermission: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock('@enterpriseglue/shared/services/versioning/index.js', () => ({
  syncFileUpdate: vi.fn().mockResolvedValue(undefined),
  syncFileDelete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@enterpriseglue/shared/services/authorization.js', () => ({
  AuthorizationService: {
    verifyProjectAccess: vi.fn().mockResolvedValue(false),
    verifyFileAccess: vi.fn().mockResolvedValue(false),
  },
}));

describe('starbase files routes - list', () => {
  const projectId = '22222222-2222-4222-8222-222222222222';
  let app: express.Application;
  let projectFindOne: ReturnType<typeof vi.fn>;
  let fileFind: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(filesRouter);
    app.use(errorHandler);
    vi.clearAllMocks();

    projectFindOne = vi.fn().mockResolvedValue({ id: projectId, tenantId: null });
    fileFind = vi.fn().mockResolvedValue([
      {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Invoice Process',
        type: 'bpmn',
        folderId: null,
        createdAt: 1000,
        updatedAt: 2000,
        bpmnProcessId: null,
        dmnDecisionId: null,
        xml: '<bpmn:definitions><bpmn:process id="Invoice_Process" /></bpmn:definitions>',
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Decision',
        type: 'dmn',
        folderId: '55555555-5555-4555-8555-555555555555',
        createdAt: 3000,
        updatedAt: 4000,
        bpmnProcessId: null,
        dmnDecisionId: 'Decision_1',
        xml: '<definitions><decision id="Decision_1"></decision></definitions>',
      },
    ]);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project) {
          return { findOne: projectFindOne };
        }
        if (entity === File) {
          return { find: fileFind };
        }
        return {};
      },
    });
  });

  it('lists project files when project.files.read is granted by the evaluator', async () => {
    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string) => permission === 'project:files:view'
    );

    const response = await request(app).get(`/starbase-api/projects/${projectId}/files`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Invoice Process',
        type: 'bpmn',
        folderId: null,
        bpmnProcessId: 'Invoice_Process',
        dmnDecisionId: null,
        createdAt: 1000,
        updatedAt: 2000,
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Decision',
        type: 'dmn',
        folderId: '55555555-5555-4555-8555-555555555555',
        bpmnProcessId: null,
        dmnDecisionId: 'Decision_1',
        createdAt: 3000,
        updatedAt: 4000,
      },
    ]);
    expect(projectFindOne).toHaveBeenCalledWith({
      where: { id: projectId },
      select: ['id', 'tenantId'],
    });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      userId: 'user-1',
      platformRole: 'user',
      resourceType: 'project',
      resourceId: projectId,
    }));
    expect(fileFind).toHaveBeenCalledWith({
      where: { projectId },
      order: { updatedAt: 'DESC' },
      select: ['id', 'name', 'type', 'folderId', 'createdAt', 'updatedAt', 'bpmnProcessId', 'dmnDecisionId', 'xml'],
    });
    expect(AuthorizationService.verifyProjectAccess).not.toHaveBeenCalled();
  });

  it('denies project file list when project.files.read is not granted', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app).get(`/starbase-api/projects/${projectId}/files`);

    expect(response.status).toBe(403);
    expect(fileFind).not.toHaveBeenCalled();
    expect(AuthorizationService.verifyProjectAccess).not.toHaveBeenCalled();
  });
});
