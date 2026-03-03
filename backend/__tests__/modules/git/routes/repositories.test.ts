import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import repositoriesRouter from '../../../../../packages/backend-host/src/modules/git/routes/repositories.js';

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/services/git/GitService.js', () => ({
  GitService: vi.fn().mockImplementation(() => ({
    listUserRepositories: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('git repositories routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(repositoriesRouter);
    vi.clearAllMocks();
  });

  it('placeholder test for git repositories', () => {
    expect(true).toBe(true);
  });
});
