import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import locksRouter from '../../../../../packages/backend-host/src/modules/git/routes/locks.js';

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/projectAuth.js', () => ({
  requireProjectAccess: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/services/git/LockManager.js', () => ({
  LockManager: vi.fn().mockImplementation(() => ({
    acquireLock: vi.fn().mockResolvedValue({ lockId: 'lock-1' }),
    releaseLock: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('git locks routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(locksRouter);
    vi.clearAllMocks();
  });

  it('placeholder test for git locks', () => {
    expect(true).toBe(true);
  });
});
