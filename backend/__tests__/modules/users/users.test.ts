import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import usersRouter from '../../../src/modules/users/routes/users.js';
import { getDataSource } from '../../../src/shared/db/data-source.js';
import { User } from '../../../src/shared/db/entities/User.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', platformRole: 'admin' };
    next();
  },
}));

vi.mock('@shared/middleware/requirePermission.js', () => ({
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@shared/services/audit.js', () => ({
  logAudit: vi.fn(),
  AuditActions: {},
}));

describe('users routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(usersRouter);
    vi.clearAllMocks();

    const userRepo = {
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue({ id: 'u1', email: 'test@example.com' }),
      save: vi.fn().mockResolvedValue({ id: 'u1', email: 'test@example.com' }),
      delete: vi.fn().mockResolvedValue({ affected: 1 }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn(), save: vi.fn(), delete: vi.fn() };
      },
    });
  });

  it('placeholder test for users routes', () => {
    expect(true).toBe(true);
  });
});
