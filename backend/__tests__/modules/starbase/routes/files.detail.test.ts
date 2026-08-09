import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import filesRouter from '../../../../../packages/backend-host/src/modules/starbase/routes/files.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { File } from '@enterpriseglue/shared/infrastructure/persistence/entities/File.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
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


describe('starbase files routes - detail and download', () => {
  const projectId = '11111111-1111-4111-8111-111111111111';
  const fileId = '22222222-2222-4222-8222-222222222222';

  let app: express.Application;
  let projectFindOne: ReturnType<typeof vi.fn>;
  let fileFindOne: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(filesRouter);
    app.use(errorHandler);
    vi.clearAllMocks();

    projectFindOne = vi.fn();
    fileFindOne = vi.fn();
    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string) => permission === 'project:files:view'
    );

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project) return { findOne: projectFindOne };
        if (entity === File) return { findOne: fileFindOne };
        return {};
      },
    });
  });

  function mockResolvedFileDetail() {
    fileFindOne
      .mockResolvedValueOnce({ id: fileId, projectId })
      .mockResolvedValueOnce({
        id: fileId,
        projectId,
        folderId: null,
        name: 'Invoice Process',
        type: 'bpmn',
        xml: '<bpmn:definitions><bpmn:process id="Invoice_Process" /></bpmn:definitions>',
        createdAt: 1000,
        updatedAt: 2000,
        bpmnProcessId: 'Invoice_Process',
        dmnDecisionId: null,
      });
    projectFindOne
      .mockResolvedValueOnce({ id: projectId, tenantId: 'tenant-default' })
      .mockResolvedValueOnce({ name: 'Billing Project' });
  }

  function mockResolvedDownload() {
    fileFindOne
      .mockResolvedValueOnce({ id: fileId, projectId })
      .mockResolvedValueOnce({
        projectId,
        name: 'Decision',
        type: 'dmn',
        xml: '<definitions><decision id="Decision_1"></decision></definitions>',
      });
    projectFindOne.mockResolvedValueOnce({ id: projectId, tenantId: 'tenant-default' });
  }

  it('returns file detail when project.files.read is granted through project.byFileId', async () => {
    mockResolvedFileDetail();

    const response = await request(app).get(`/starbase-api/files/${fileId}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: fileId,
      projectId,
      projectName: 'Billing Project',
      folderId: null,
      name: 'Invoice Process',
      type: 'bpmn',
      bpmnProcessId: 'Invoice_Process',
      dmnDecisionId: null,
      createdAt: 1000,
      updatedAt: 2000,
    });
    expect(fileFindOne).toHaveBeenNthCalledWith(1, {
      where: { id: fileId },
      select: ['id', 'projectId'],
    });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      tenantId: 'tenant-default',
      resourceId: projectId,
    }));
  });

  it('denies file detail before handler work when project.files.read is missing', async () => {
    fileFindOne.mockResolvedValueOnce({ id: fileId, projectId });
    projectFindOne.mockResolvedValueOnce({ id: projectId, tenantId: 'tenant-default' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app).get(`/starbase-api/files/${fileId}`);

    expect(response.status).toBe(403);
    expect(fileFindOne).toHaveBeenCalledTimes(1);
  });

  it('downloads a file when project.files.read is granted through project.byFileId', async () => {
    mockResolvedDownload();

    const response = await request(app).get(`/starbase-api/files/${fileId}/download`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/xml');
    expect(response.headers['content-disposition']).toContain('filename="Decision.dmn"');
    expect(response.text).toBe('<definitions><decision id="Decision_1"></decision></definitions>');
    expect(fileFindOne).toHaveBeenNthCalledWith(1, {
      where: { id: fileId },
      select: ['id', 'projectId'],
    });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      resourceType: 'project',
      resourceId: projectId,
    }));
  });
});
