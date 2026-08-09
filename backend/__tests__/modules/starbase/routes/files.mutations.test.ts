import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import filesRouter from '../../../../../packages/backend-host/src/modules/starbase/routes/files.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { File } from '@enterpriseglue/shared/infrastructure/persistence/entities/File.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { Version } from '@enterpriseglue/shared/infrastructure/persistence/entities/Version.js';
import { CascadeDeleteService } from '@enterpriseglue/shared/services/cascade-delete.js';
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

vi.mock('@enterpriseglue/shared/services/cascade-delete.js', () => ({
  CascadeDeleteService: {
    deleteFile: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@enterpriseglue/shared/services/versioning/index.js', () => ({
  syncFileUpdate: vi.fn().mockResolvedValue(undefined),
  syncFileDelete: vi.fn().mockResolvedValue(undefined),
}));

describe('starbase files routes - mutations', () => {
  const projectId = '11111111-1111-4111-8111-111111111111';
  const fileId = '22222222-2222-4222-8222-222222222222';

  let app: express.Application;
  let projectFindOne: ReturnType<typeof vi.fn>;
  let fileFind: ReturnType<typeof vi.fn>;
  let fileFindOne: ReturnType<typeof vi.fn>;
  let fileInsert: ReturnType<typeof vi.fn>;
  let versionInsert: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(filesRouter);
    app.use(errorHandler);
    vi.clearAllMocks();

    projectFindOne = vi.fn().mockResolvedValue({ id: projectId, tenantId: 'tenant-default' });
    fileFind = vi.fn().mockResolvedValue([]);
    fileFindOne = vi.fn().mockResolvedValue({
      id: fileId,
      projectId,
      name: 'Invoice',
      type: 'bpmn',
      folderId: null,
    });
    fileInsert = vi.fn().mockResolvedValue(undefined);
    versionInsert = vi.fn().mockResolvedValue(undefined);

    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      [
        'project:files:create',
        'project:files:edit',
        'project:files:delete',
      ].includes(permission)
    );
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project) return { findOne: projectFindOne };
        if (entity === File) return { find: fileFind, findOne: fileFindOne, insert: fileInsert };
        if (entity === Version) return { insert: versionInsert };
        return {};
      },
    });
  });

  it('creates a file through project.files.create', async () => {
    const response = await request(app)
      .post(`/starbase-api/projects/${projectId}/files`)
      .send({
        name: 'Invoice',
        type: 'bpmn',
        xml: '<bpmn:definitions><bpmn:process id="Invoice_Process" /></bpmn:definitions>',
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      name: 'Invoice',
      type: 'bpmn',
      bpmnProcessId: 'Invoice_Process',
    });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:create', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      resourceId: projectId,
    }));
    expect(fileInsert).toHaveBeenCalledWith(expect.objectContaining({
      projectId,
      name: 'Invoice',
      type: 'bpmn',
      createdBy: 'user-1',
      updatedBy: 'user-1',
    }));
    expect(versionInsert).toHaveBeenCalled();
  });

  it('denies file update before handler work when project.files.update is missing', async () => {
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) => permission !== 'project:files:edit');

    const response = await request(app)
      .put(`/starbase-api/files/${fileId}`)
      .send({ xml: '<bpmn:definitions />' });

    expect(response.status).toBe(403);
    expect(fileFindOne).toHaveBeenCalledTimes(1);
    expect(fileInsert).not.toHaveBeenCalled();
  });

  it('deletes a file through project.files.delete', async () => {
    const response = await request(app)
      .delete(`/starbase-api/files/${fileId}`);

    expect(response.status).toBe(204);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:delete', expect.objectContaining({
      resourceType: 'project',
      resourceId: projectId,
    }));
    expect(CascadeDeleteService.deleteFile).toHaveBeenCalledWith(fileId);
  });
});
