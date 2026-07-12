import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import versionsRouter from '../../../../../packages/backend-host/src/modules/starbase/routes/versions.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { Version } from '@enterpriseglue/shared/db/entities/Version.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
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
  requireFileAccess: () => (_req: any, _res: any, next: any) => next(),
  requireProjectRole: () => (_req: any, _res: any, next: any) => next(),
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

describe('starbase versions routes', () => {
  const projectId = '22222222-2222-2222-8222-222222222222';
  const otherProjectId = '66666666-6666-4666-8666-666666666666';
  const fileId = '11111111-1111-1111-8111-111111111111';
  const otherFileId = '33333333-3333-3333-8333-333333333333';
  const versionId = '44444444-4444-4444-8444-444444444444';
  const otherVersionId = '55555555-5555-4555-8555-555555555555';

  let app: express.Application;
  let versionCount: ReturnType<typeof vi.fn>;
  let versionFind: ReturnType<typeof vi.fn>;
  let versionFindOne: ReturnType<typeof vi.fn>;
  let versionInsert: ReturnType<typeof vi.fn>;
  let versionQueryBuilder: ReturnType<typeof vi.fn>;
  let fileFindOne: ReturnType<typeof vi.fn>;
  let fileUpdate: ReturnType<typeof vi.fn>;
  let projectFindOne: ReturnType<typeof vi.fn>;
  let compareRowsById: Map<string, any>;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(versionsRouter);
    app.use(errorHandler);
    vi.clearAllMocks();

    versionCount = vi.fn().mockResolvedValue(0);
    versionFind = vi.fn().mockResolvedValue([]);
    versionFindOne = vi.fn().mockResolvedValue(null);
    versionInsert = vi.fn().mockResolvedValue(undefined);
    compareRowsById = new Map();
    versionQueryBuilder = vi.fn(() => {
      let selectedId = '';
      const qb: any = {
        select: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        where: vi.fn((_expr: string, params: { id: string }) => {
          selectedId = String(params.id);
          return qb;
        }),
        getRawOne: vi.fn(async () => compareRowsById.get(selectedId) || null),
      };
      return qb;
    });
    fileFindOne = vi.fn().mockImplementation(async ({ where, select }: any) => {
      const id = String(where?.id || fileId);
      if (id === otherFileId) {
        return { id: otherFileId, projectId: otherProjectId, xml: '<quote />' };
      }
      return { id: fileId, projectId, xml: '<bpmn />' };
    });
    fileUpdate = vi.fn().mockResolvedValue(undefined);
    projectFindOne = vi.fn().mockImplementation(async ({ where }: any) => ({
      id: String(where?.id || projectId),
      tenantId: null,
    }));

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Version) {
          return {
            count: versionCount,
            find: versionFind,
            findOne: versionFindOne,
            insert: versionInsert,
            createQueryBuilder: versionQueryBuilder,
          };
        }
        if (entity === File) {
          return {
            findOne: fileFindOne,
            update: fileUpdate,
          };
        }
        if (entity === Project) {
          return { findOne: projectFindOne };
        }
        return {};
      },
    });
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      [
        'project:files:view',
        'project:versions:create',
        'project:versions:restore',
      ].includes(permission)
    );
  });

  it('lists file versions and seeds an initial import when none exist', async () => {
    versionFind.mockResolvedValue([
      { id: 'version-1', author: 'system', message: 'Initial import', createdAt: 1700000000 },
    ]);

    const response = await request(app).get(`/starbase-api/files/${fileId}/versions`);

    expect(response.status).toBe(200);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      resourceId: projectId,
    }));
    expect(versionInsert).toHaveBeenCalledWith(expect.objectContaining({
      fileId,
      author: 'system',
      message: 'Initial import',
      xml: '<bpmn />',
    }));
    expect(response.body).toEqual([
      {
        id: 'version-1',
        author: 'system',
        message: 'Initial import',
        createdAt: 1700000000,
      },
    ]);
  });

  it('creates a local file-scoped version for editable files', async () => {
    const response = await request(app)
      .post(`/starbase-api/files/${fileId}/versions`)
      .send({ message: 'Local save' });

    expect(response.status).toBe(201);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:versions:create', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      resourceId: projectId,
    }));
    expect(versionInsert).toHaveBeenCalledWith(expect.objectContaining({
      fileId,
      author: 'user-1',
      message: 'Local save',
      xml: '<bpmn />',
    }));
    expect(response.body).toMatchObject({
      author: 'user-1',
      message: 'Local save',
    });
  });

  it('denies version creation before handler work when project.versions.create is missing', async () => {
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) => permission !== 'project:versions:create');

    const response = await request(app)
      .post(`/starbase-api/files/${fileId}/versions`)
      .send({ message: 'Denied save' });

    expect(response.status).toBe(403);
    expect(versionInsert).not.toHaveBeenCalled();
  });

  it('does not leak local file versions into other files', async () => {
    const fileA = fileId;
    const fileB = otherFileId;
    const versions: Array<{ id: string; fileId: string; author: string; message: string; xml: string; createdAt: number }> = [];

    fileFindOne.mockImplementation(async ({ where }: any) => {
      const id = String(where?.id || '');
      if (id === fileA) {
        return { id: fileA, projectId, xml: '<invoice />' };
      }
      if (id === fileB) {
        return { id: fileB, projectId, xml: '<quote />' };
      }
      return null;
    });

    versionCount.mockImplementation(async ({ where }: any) => {
      const requestedFileId = String(where?.fileId || '');
      return versions.filter((row) => row.fileId === requestedFileId).length;
    });

    versionFind.mockImplementation(async ({ where }: any) => {
      const requestedFileId = String(where?.fileId || '');
      return versions
        .filter((row) => row.fileId === requestedFileId)
        .sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
    });

    versionInsert.mockImplementation(async (payload: any) => {
      const rows = Array.isArray(payload) ? payload : [payload];
      versions.push(...rows);
    });

    const createResponse = await request(app)
      .post(`/starbase-api/files/${fileA}/versions`)
      .send({ message: 'Save Invoice only' });

    expect(createResponse.status).toBe(201);

    const fileAResponse = await request(app).get(`/starbase-api/files/${fileA}/versions`);
    const fileBResponse = await request(app).get(`/starbase-api/files/${fileB}/versions`);

    expect(fileAResponse.status).toBe(200);
    expect(fileAResponse.body.map((row: any) => row.message)).toContain('Save Invoice only');

    expect(fileBResponse.status).toBe(200);
    expect(fileBResponse.body.map((row: any) => row.message)).not.toContain('Save Invoice only');
    expect(fileBResponse.body).toEqual([
      expect.objectContaining({
        author: 'system',
        message: 'Initial import',
      }),
    ]);
  });

  it('returns file-scoped local version details for preview', async () => {
    versionFindOne.mockResolvedValue({
      id: 'version-1',
      fileId,
      author: 'user-1',
      message: 'Older draft',
      xml: '<bpmn restored="true" />',
      createdAt: 1700000000,
    });

    const response = await request(app).get(`/starbase-api/files/${fileId}/versions/${versionId}`);

    expect(response.status).toBe(200);
    expect(versionFindOne).toHaveBeenCalledWith({
      where: {
        id: versionId,
        fileId,
      },
      select: ['id', 'fileId', 'author', 'message', 'xml', 'createdAt'],
    });
    expect(response.body).toEqual({
      id: 'version-1',
      fileId,
      author: 'user-1',
      message: 'Older draft',
      xml: '<bpmn restored="true" />',
      createdAt: 1700000000,
    });
  });

  it('restores local file content from a file-scoped version snapshot', async () => {
    versionFindOne.mockResolvedValue({
      id: versionId,
      fileId,
      message: 'Older draft',
      xml: '<bpmn restored="yes" />',
    });

    const response = await request(app)
      .post(`/starbase-api/files/${fileId}/versions/${versionId}/restore`);

    expect(response.status).toBe(200);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:versions:restore', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      resourceId: projectId,
    }));
    expect(fileUpdate).toHaveBeenCalledWith(
      { id: fileId },
      expect.objectContaining({
        xml: '<bpmn restored="yes" />',
        updatedAt: expect.any(Number),
      })
    );
    expect(versionInsert).toHaveBeenCalledWith(expect.objectContaining({
      fileId,
      author: 'user-1',
      message: 'Restored from Older draft',
      xml: '<bpmn restored="yes" />',
      createdAt: expect.any(Number),
    }));
    expect(response.body).toEqual({
      restored: true,
      fileId,
      versionId,
      updatedAt: expect.any(Number),
    });
  });

  it('denies restore before handler work when project.versions.restore is missing', async () => {
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) => permission !== 'project:versions:restore');
    versionFindOne.mockResolvedValue({
      id: versionId,
      fileId,
      message: 'Denied draft',
      xml: '<bpmn />',
    });

    const response = await request(app)
      .post(`/starbase-api/files/${fileId}/versions/${versionId}/restore`);

    expect(response.status).toBe(403);
    expect(versionFindOne).not.toHaveBeenCalled();
    expect(fileUpdate).not.toHaveBeenCalled();
  });

  it('compares versions when both files are visible', async () => {
    versionFindOne.mockResolvedValue({ id: versionId, fileId });
    compareRowsById.set(versionId, {
      v_id: versionId,
      v_fileId: fileId,
      v_createdAt: 1700000000,
      xmlLen: 25,
    });
    compareRowsById.set(otherVersionId, {
      v_id: otherVersionId,
      v_fileId: otherFileId,
      v_createdAt: 1700000100,
      xmlLen: 15,
    });

    const response = await request(app)
      .get(`/starbase-api/versions/${versionId}/compare/${otherVersionId}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      a: { id: versionId, fileId, createdAt: 1700000000, xmlLength: 25 },
      b: { id: otherVersionId, fileId: otherFileId, createdAt: 1700000100, xmlLength: 15 },
      lengthDelta: 10,
    });
  });

  it('denies version compare when the other version file is not visible', async () => {
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string, context: any) => {
      if (permission !== 'project:files:view') return false;
      return context?.resourceId === projectId;
    });
    versionFindOne.mockResolvedValue({ id: versionId, fileId });
    compareRowsById.set(versionId, {
      v_id: versionId,
      v_fileId: fileId,
      v_createdAt: 1700000000,
      xmlLen: 25,
    });
    compareRowsById.set(otherVersionId, {
      v_id: otherVersionId,
      v_fileId: otherFileId,
      v_createdAt: 1700000100,
      xmlLen: 15,
    });

    const response = await request(app)
      .get(`/starbase-api/versions/${versionId}/compare/${otherVersionId}`);

    expect(response.status).toBe(404);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      resourceType: 'project',
      resourceId: otherProjectId,
    }));
  });
});
