import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import foldersRouter from '../../../../../packages/backend-host/src/modules/starbase/routes/folders.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Folder } from '@enterpriseglue/shared/db/entities/Folder.js';

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
  AuthorizationService: {},
}));

vi.mock('@enterpriseglue/shared/services/resources.js', () => ({
  ResourceService: {},
}));

vi.mock('@enterpriseglue/shared/services/cascade-delete.js', () => ({
  CascadeDeleteService: {},
}));

vi.mock('@enterpriseglue/shared/services/versioning/index.js', () => ({
  vcsService: {
    getUserBranch: vi.fn().mockResolvedValue({ id: 'branch-1' }),
    saveFile: vi.fn(),
    commit: vi.fn(),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js', () => ({
  projectMemberService: {},
}));

describe('starbase folders routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(foldersRouter);
    vi.clearAllMocks();

    const folderRepo = {
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue({ id: 'f1', name: 'Test Folder', projectId: 'p1' }),
      save: vi.fn().mockResolvedValue({ id: 'f1', name: 'Test Folder' }),
      delete: vi.fn().mockResolvedValue({ affected: 1 }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Folder) return folderRepo;
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn(), save: vi.fn(), delete: vi.fn() };
      },
    });
  });

  it('placeholder test for folders routes', () => {
    expect(true).toBe(true);
  });
});
