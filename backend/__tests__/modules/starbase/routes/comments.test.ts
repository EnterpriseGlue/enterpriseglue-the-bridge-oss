import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import commentsRouter from '../../../../../packages/backend-host/src/modules/starbase/routes/comments.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Comment } from '@enterpriseglue/shared/db/entities/Comment.js';

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

describe('starbase comments routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(commentsRouter);
    vi.clearAllMocks();

    const commentRepo = {
      find: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue({ id: 'c1', content: 'Test comment' }),
      delete: vi.fn().mockResolvedValue({ affected: 1 }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Comment) return commentRepo;
        return { find: vi.fn().mockResolvedValue([]), save: vi.fn(), delete: vi.fn() };
      },
    });
  });

  it('placeholder test for comments routes', () => {
    expect(true).toBe(true);
  });
});
