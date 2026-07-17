import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import foldersRouter from '../../../../../packages/backend-host/src/modules/starbase/routes/folders.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';
import { Folder } from '@enterpriseglue/shared/db/entities/Folder.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { CascadeDeleteService } from '@enterpriseglue/shared/services/cascade-delete.js';
import { ResourceService } from '@enterpriseglue/shared/services/resources.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

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

vi.mock('@enterpriseglue/shared/services/authorization.js', () => ({
  AuthorizationService: {
    verifyProjectAccess: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('@enterpriseglue/shared/services/resources.js', () => ({
  ResourceService: {
    getFolderOrThrow: vi.fn().mockResolvedValue({ id: 'folder-1' }),
  },
}));

vi.mock('@enterpriseglue/shared/services/cascade-delete.js', () => ({
  CascadeDeleteService: {
    deleteFolder: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@enterpriseglue/shared/services/versioning/index.js', () => ({
  vcsService: {
    getUserBranch: vi.fn().mockResolvedValue({ id: 'branch-1' }),
    syncFromMainDb: vi.fn().mockResolvedValue(undefined),
    saveFile: vi.fn(),
    commit: vi.fn(),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js', () => ({
  projectMemberService: {
    hasRole: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  ProjectPermissions: {
    FILES_CREATE: 'project:files:create',
    FILES_EDIT: 'project:files:edit',
    FILES_DELETE: 'project:files:delete',
    FILES_VIEW: 'project:files:view',
  },
  permissionService: {
    hasPermission: vi.fn().mockResolvedValue(false),
  },
}));

describe('starbase folders routes', () => {
  const projectId = '00000000-0000-4000-8000-000000000001';
  const folderId = '11111111-1111-4111-8111-111111111111';
  let app: express.Application;
  let projectFindOne: ReturnType<typeof vi.fn>;
  let folderFind: ReturnType<typeof vi.fn>;
  let folderFindOne: ReturnType<typeof vi.fn>;
  let folderInsert: ReturnType<typeof vi.fn>;
  let folderUpdate: ReturnType<typeof vi.fn>;
  let folderDelete: ReturnType<typeof vi.fn>;
  let fileFind: ReturnType<typeof vi.fn>;
  let fileFindOne: ReturnType<typeof vi.fn>;
  let duplicateGetMany: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(foldersRouter);
    app.use(errorHandler);
    vi.clearAllMocks();
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      [
        'project:files:view',
        'project:files:create',
        'project:files:edit',
        'project:files:delete',
      ].includes(permission)
    );

    projectFindOne = vi.fn().mockResolvedValue({ id: projectId, tenantId: null, name: 'Project One' });
    folderFind = vi.fn().mockResolvedValue([
      { id: folderId, name: 'Test Folder', projectId, parentFolderId: null, createdBy: 'user-1', updatedBy: 'user-1', createdAt: 1000, updatedAt: 2000 },
    ]);
    folderFindOne = vi.fn().mockResolvedValue({ id: folderId, name: 'Test Folder', projectId, parentFolderId: null });
    folderInsert = vi.fn().mockResolvedValue(undefined);
    folderUpdate = vi.fn().mockResolvedValue({ affected: 1 });
    folderDelete = vi.fn().mockResolvedValue({ affected: 1 });
    fileFind = vi.fn().mockResolvedValue([
      { id: 'file-1', name: 'Invoice', type: 'bpmn', folderId, createdBy: 'user-1', updatedBy: 'user-1', createdAt: 1000, updatedAt: 2000 },
    ]);
    fileFindOne = vi.fn().mockResolvedValue({ id: 'file-1', type: 'bpmn' });
    duplicateGetMany = vi.fn().mockResolvedValue([]);

    const folderRepo = {
      find: folderFind,
      findOne: folderFindOne,
      insert: folderInsert,
      save: vi.fn().mockResolvedValue({ id: 'f1', name: 'Test Folder' }),
      update: folderUpdate,
      delete: folderDelete,
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        getMany: duplicateGetMany,
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project) return { findOne: projectFindOne };
        if (entity === Folder) return folderRepo;
        if (entity === File) return { find: fileFind, findOne: fileFindOne };
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn(), save: vi.fn(), delete: vi.fn() };
      },
    });
  });

  it('lists flat project folders through project.files.read', async () => {
    const response = await request(app)
      .get(`/starbase-api/projects/${projectId}/folders`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { id: folderId, name: 'Test Folder', parentFolderId: null },
    ]);
    expect(response.body[0]).not.toHaveProperty('projectId');
    expect(response.body[0]).not.toHaveProperty('createdBy');
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      resourceId: projectId,
    }));
    expect(folderFind).toHaveBeenCalledWith({
      where: { projectId },
      select: ['id', 'name', 'parentFolderId'],
    });
  });

  it('returns project contents through project.files.read', async () => {
    const response = await request(app)
      .get(`/starbase-api/projects/${projectId}/contents`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      breadcrumb: [],
      folders: [
        {
          id: folderId,
          name: 'Test Folder',
          parentFolderId: null,
          createdBy: 'user-1',
          updatedBy: 'user-1',
          createdAt: 1000,
          updatedAt: 2000,
        },
      ],
      files: [
        {
          id: 'file-1',
          name: 'Invoice',
          type: 'bpmn',
          createdBy: 'user-1',
          updatedBy: 'user-1',
          createdAt: 1000,
          updatedAt: 2000,
        },
      ],
    });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      resourceType: 'project',
      resourceId: projectId,
    }));
  });

  it('creates a folder through project.files.create', async () => {
    folderFind.mockResolvedValue([]);

    const response = await request(app)
      .post(`/starbase-api/projects/${projectId}/folders`)
      .send({ name: 'New Folder' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ name: 'New Folder', parentFolderId: null });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:create', expect.objectContaining({
      resourceType: 'project',
      resourceId: projectId,
    }));
    expect(folderInsert).toHaveBeenCalledWith(expect.objectContaining({
      projectId,
      parentFolderId: null,
      name: 'New Folder',
      createdBy: 'user-1',
      updatedBy: 'user-1',
    }));
  });

  it('renames a folder through project.files.update', async () => {
    const response = await request(app)
      .patch(`/starbase-api/folders/${folderId}`)
      .send({ name: 'Renamed Folder' });

    expect(response.status).toBe(200);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:edit', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      resourceId: projectId,
    }));
    expect(folderUpdate).toHaveBeenCalledWith(
      { id: folderId },
      expect.objectContaining({ name: 'Renamed Folder' })
    );
  });

  it('denies folder delete preview before handler work when project.files.delete is missing', async () => {
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) => permission !== 'project:files:delete');

    const response = await request(app)
      .get(`/starbase-api/folders/${folderId}/delete-preview`);

    expect(response.status).toBe(403);
    expect(ResourceService.getFolderOrThrow).not.toHaveBeenCalled();
    expect(CascadeDeleteService.deleteFolder).not.toHaveBeenCalled();
  });
});
