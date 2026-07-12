import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import commentsRouter from '../../../../../packages/backend-host/src/modules/starbase/routes/comments.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { Comment } from '@enterpriseglue/shared/db/entities/Comment.js';
import { File } from '@enterpriseglue/shared/infrastructure/persistence/entities/File.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
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

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  permissionService: {
    hasPermission: vi.fn().mockResolvedValue(false),
  },
}));

describe('starbase comments routes', () => {
  const projectId = '11111111-1111-4111-8111-111111111111';
  const fileId = '22222222-2222-4222-8222-222222222222';
  let app: express.Application;
  let projectFindOne: ReturnType<typeof vi.fn>;
  let fileFindOne: ReturnType<typeof vi.fn>;
  let commentCount: ReturnType<typeof vi.fn>;
  let commentInsert: ReturnType<typeof vi.fn>;
  let commentFind: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(commentsRouter);
    app.use(errorHandler);
    vi.clearAllMocks();
    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string) => permission === 'project:files:view'
    );

    projectFindOne = vi.fn().mockResolvedValue({ id: projectId, tenantId: null });
    fileFindOne = vi.fn().mockResolvedValue({ id: fileId, projectId });
    commentCount = vi.fn().mockResolvedValue(1);
    commentInsert = vi.fn().mockResolvedValue(undefined);
    commentFind = vi.fn().mockResolvedValue([
      {
        id: 'comment-1',
        author: 'alice',
        message: 'Looks good',
        createdAt: 1700000000000,
      },
    ]);
    const commentRepo = {
      count: commentCount,
      insert: commentInsert,
      find: commentFind,
      save: vi.fn().mockResolvedValue({ id: 'c1', content: 'Test comment' }),
      delete: vi.fn().mockResolvedValue({ affected: 1 }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project) return { findOne: projectFindOne };
        if (entity === File) return { findOne: fileFindOne };
        if (entity === Comment) return commentRepo;
        return { find: vi.fn().mockResolvedValue([]), save: vi.fn(), delete: vi.fn() };
      },
    });
  });

  it('lists comments when project.files.read is granted through project.byFileId', async () => {
    const response = await request(app).get(`/starbase-api/files/${fileId}/comments`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        id: 'comment-1',
        author: 'alice',
        message: 'Looks good',
        createdAt: 1700000000000,
      },
    ]);
    expect(fileFindOne).toHaveBeenCalledWith({
      where: { id: fileId },
      select: ['id', 'projectId'],
    });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      resourceId: projectId,
    }));
    expect(commentCount).toHaveBeenCalledWith({ where: { fileId } });
    expect(commentFind).toHaveBeenCalled();
  });

  it('seeds initial comments when the authorized file has none', async () => {
    commentCount.mockResolvedValue(0);
    commentFind.mockResolvedValue([]);

    const response = await request(app).get(`/starbase-api/files/${fileId}/comments`);

    expect(response.status).toBe(200);
    expect(commentInsert).toHaveBeenCalledWith([
      expect.objectContaining({ fileId, author: 'system', message: 'Initial comment stub' }),
      expect.objectContaining({ fileId, author: 'hary', message: 'Looks good for now' }),
    ]);
  });

  it('denies comments before comment repository work when project.files.read is missing', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app).get(`/starbase-api/files/${fileId}/comments`);

    expect(response.status).toBe(403);
    expect(commentCount).not.toHaveBeenCalled();
    expect(commentFind).not.toHaveBeenCalled();
  });
});
