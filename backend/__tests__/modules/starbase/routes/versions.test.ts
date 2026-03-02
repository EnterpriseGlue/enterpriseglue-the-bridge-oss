import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import versionsRouter from '../../../../../packages/backend-host/src/modules/starbase/routes/versions.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';

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

vi.mock('@enterpriseglue/shared/services/versioning/index.js', () => ({
  vcsService: {
    listCommits: vi.fn().mockResolvedValue([]),
    getCommit: vi.fn().mockResolvedValue({ id: 'commit-1', message: 'Test commit' }),
    getFileAtCommit: vi.fn().mockResolvedValue({ xml: '<test/>' }),
  },
}));

describe('starbase versions routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(versionsRouter);
    vi.clearAllMocks();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({
        find: vi.fn().mockResolvedValue([]),
        findOne: vi.fn().mockResolvedValue(null),
      }),
    });
  });

  it('placeholder test for versions routes', () => {
    expect(true).toBe(true);
  });
});
