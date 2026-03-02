import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import syncRouter from '../../../../../packages/backend-host/src/modules/git/routes/sync.js';

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
    syncRepository: vi.fn().mockResolvedValue({ success: true }),
  })),
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('git sync routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(syncRouter);
    vi.clearAllMocks();
  });

  it('placeholder test for git sync', () => {
    expect(true).toBe(true);
  });
});
