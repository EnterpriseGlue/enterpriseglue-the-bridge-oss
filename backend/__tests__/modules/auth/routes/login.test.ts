import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import loginRouter from '../../../../src/modules/auth/routes/login.js';
import { getDataSource } from '../../../../src/shared/db/data-source.js';
import { User } from '../../../../src/shared/db/entities/User.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/utils/password.js', () => ({
  verifyPassword: vi.fn().mockResolvedValue(false),
}));

vi.mock('@shared/utils/jwt.js', () => ({
  generateAccessToken: vi.fn().mockReturnValue('access-token'),
  generateRefreshToken: vi.fn().mockReturnValue('refresh-token'),
}));

vi.mock('@shared/services/audit.js', () => ({
  logAudit: vi.fn(),
  AuditActions: {
    LOGIN_FAILED: 'LOGIN_FAILED',
    LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  },
}));

vi.mock('@shared/middleware/rateLimiter.js', () => ({
  authLimiter: (_req: any, _res: any, next: any) => next(),
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  engineLimiter: (_req: any, _res: any, next: any) => next(),
}));

describe('auth login routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(loginRouter);
    vi.clearAllMocks();

    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(null),
      }),
      save: vi.fn(),
    };

    const refreshTokenRepo = {
      save: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        return refreshTokenRepo;
      },
    });
  });

  it('placeholder test for login', () => {
    expect(true).toBe(true);
  });
});
