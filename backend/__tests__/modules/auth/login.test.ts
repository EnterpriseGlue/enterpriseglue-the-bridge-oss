import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import loginRoute from '../../../src/modules/auth/routes/login.js';
import { getDataSource } from '../../../src/shared/db/data-source.js';
import { User } from '../../../src/shared/db/entities/User.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/utils/password.js', () => ({
  verifyPassword: vi.fn(),
}));

vi.mock('@shared/utils/jwt.js', () => ({
  generateAccessToken: vi.fn(() => 'mock-access-token'),
  generateRefreshToken: vi.fn(() => 'mock-refresh-token'),
}));

vi.mock('@shared/services/audit.js', () => ({
  logAudit: vi.fn(),
  AuditActions: {
    LOGIN_SUCCESS: 'LOGIN_SUCCESS',
    LOGIN_FAILED: 'LOGIN_FAILED',
    ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  },
}));

vi.mock('@shared/middleware/rateLimiter.js', () => ({
  authLimiter: (_req: any, _res: any, next: any) => next(),
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  engineLimiter: (_req: any, _res: any, next: any) => next(),
}));

describe('auth login module', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(loginRoute);
    vi.clearAllMocks();
  });

  it('returns 400 for invalid email format', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'invalid-email', password: 'password123' });

    expect(response.status).toBe(400);
  });

  it('returns 401 for non-existent user', async () => {
    const userRepo = {
      createQueryBuilder: vi.fn(() => ({
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(null),
      })),
    };

    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity === User) return userRepo;
        return { insert: vi.fn() };
      },
    });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password123' });

    expect(response.status).toBe(401);
  });
});
