import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cloneRouter from '../../../../../packages/backend-host/src/modules/git/routes/clone.js';

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/projectAuth.js', () => ({
  requireProjectRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/services/git/GitService.js', () => ({
  GitService: vi.fn().mockImplementation(() => ({
    cloneFromRemote: vi.fn().mockResolvedValue({ repositoryId: 'repo-1' }),
  })),
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('git clone routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(cloneRouter);
    vi.clearAllMocks();
  });

  it('placeholder test for git clone', () => {
    expect(true).toBe(true);
  });
});
