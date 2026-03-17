import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import versionsRouter from '../../../../../packages/backend-host/src/modules/starbase/routes/versions.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Version } from '@enterpriseglue/shared/db/entities/Version.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';
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

vi.mock('@enterpriseglue/shared/middleware/projectAuth.js', () => ({
  requireProjectAccess: () => (_req: any, _res: any, next: any) => next(),
  requireFileAccess: () => (_req: any, _res: any, next: any) => next(),
  requireProjectRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js', () => ({
  projectMemberService: {
    hasRole: vi.fn().mockResolvedValue(true),
  },
}));

describe('starbase versions routes', () => {
  let app: express.Application;
  let versionCount: ReturnType<typeof vi.fn>;
  let versionFind: ReturnType<typeof vi.fn>;
  let versionFindOne: ReturnType<typeof vi.fn>;
  let versionInsert: ReturnType<typeof vi.fn>;
  let fileFindOne: ReturnType<typeof vi.fn>;
  let fileUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(versionsRouter);
    vi.clearAllMocks();

    versionCount = vi.fn().mockResolvedValue(0);
    versionFind = vi.fn().mockResolvedValue([]);
    versionFindOne = vi.fn().mockResolvedValue(null);
    versionInsert = vi.fn().mockResolvedValue(undefined);
    fileFindOne = vi.fn().mockResolvedValue(null);
    fileUpdate = vi.fn().mockResolvedValue(undefined);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Version) {
          return {
            count: versionCount,
            find: versionFind,
            findOne: versionFindOne,
            insert: versionInsert,
            createQueryBuilder: vi.fn(),
          };
        }
        if (entity === File) {
          return {
            findOne: fileFindOne,
            update: fileUpdate,
          };
        }
        return {};
      },
    });
    (projectMemberService.hasRole as unknown as Mock).mockResolvedValue(true);
  });

  it('lists file versions and seeds an initial import when none exist', async () => {
    fileFindOne.mockResolvedValue({ xml: '<bpmn />' });
    versionFind.mockResolvedValue([
      { id: 'version-1', author: 'system', message: 'Initial import', createdAt: 1700000000 },
    ]);

    const response = await request(app).get('/starbase-api/files/11111111-1111-1111-8111-111111111111/versions');

    expect(response.status).toBe(200);
    expect(versionInsert).toHaveBeenCalledWith(expect.objectContaining({
      fileId: '11111111-1111-1111-8111-111111111111',
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
    fileFindOne.mockResolvedValue({
      id: '11111111-1111-1111-8111-111111111111',
      projectId: '22222222-2222-2222-8222-222222222222',
      xml: '<bpmn />',
    });

    const response = await request(app)
      .post('/starbase-api/files/11111111-1111-1111-8111-111111111111/versions')
      .send({ message: 'Local save' });

    expect(response.status).toBe(201);
    expect(projectMemberService.hasRole).toHaveBeenCalledWith(
      '22222222-2222-2222-8222-222222222222',
      'user-1',
      expect.any(Array)
    );
    expect(versionInsert).toHaveBeenCalledWith(expect.objectContaining({
      fileId: '11111111-1111-1111-8111-111111111111',
      author: 'user-1',
      message: 'Local save',
      xml: '<bpmn />',
    }));
    expect(response.body).toMatchObject({
      author: 'user-1',
      message: 'Local save',
    });
  });

  it('does not leak local file versions into other files', async () => {
    const projectId = '22222222-2222-2222-8222-222222222222';
    const fileA = '11111111-1111-1111-8111-111111111111';
    const fileB = '33333333-3333-3333-8333-333333333333';
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
      fileId: '11111111-1111-1111-8111-111111111111',
      author: 'user-1',
      message: 'Older draft',
      xml: '<bpmn restored="true" />',
      createdAt: 1700000000,
    });

    const response = await request(app).get('/starbase-api/files/11111111-1111-1111-8111-111111111111/versions/22222222-2222-2222-8222-222222222222');

    expect(response.status).toBe(200);
    expect(versionFindOne).toHaveBeenCalledWith({
      where: {
        id: '22222222-2222-2222-8222-222222222222',
        fileId: '11111111-1111-1111-8111-111111111111',
      },
      select: ['id', 'fileId', 'author', 'message', 'xml', 'createdAt'],
    });
    expect(response.body).toEqual({
      id: 'version-1',
      fileId: '11111111-1111-1111-8111-111111111111',
      author: 'user-1',
      message: 'Older draft',
      xml: '<bpmn restored="true" />',
      createdAt: 1700000000,
    });
  });

  it('restores local file content from a file-scoped version snapshot', async () => {
    fileFindOne.mockResolvedValue({
      id: '11111111-1111-1111-8111-111111111111',
      projectId: '22222222-2222-2222-8222-222222222222',
    });
    versionFindOne.mockResolvedValue({
      id: '33333333-3333-3333-8333-333333333333',
      fileId: '11111111-1111-1111-8111-111111111111',
      message: 'Older draft',
      xml: '<bpmn restored="yes" />',
    });

    const response = await request(app)
      .post('/starbase-api/files/11111111-1111-1111-8111-111111111111/versions/33333333-3333-3333-8333-333333333333/restore');

    expect(response.status).toBe(200);
    expect(projectMemberService.hasRole).toHaveBeenCalledWith(
      '22222222-2222-2222-8222-222222222222',
      'user-1',
      expect.any(Array)
    );
    expect(fileUpdate).toHaveBeenCalledWith(
      { id: '11111111-1111-1111-8111-111111111111' },
      expect.objectContaining({
        xml: '<bpmn restored="yes" />',
        updatedAt: expect.any(Number),
      })
    );
    expect(versionInsert).toHaveBeenCalledWith(expect.objectContaining({
      fileId: '11111111-1111-1111-8111-111111111111',
      author: 'user-1',
      message: 'Restored from Older draft',
      xml: '<bpmn restored="yes" />',
      createdAt: expect.any(Number),
    }));
    expect(response.body).toEqual({
      restored: true,
      fileId: '11111111-1111-1111-8111-111111111111',
      versionId: '33333333-3333-3333-8333-333333333333',
      updatedAt: expect.any(Number),
    });
  });
});
