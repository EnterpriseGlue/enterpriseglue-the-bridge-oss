import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import forgotPasswordRouter from '../../../../src/modules/auth/routes/forgot-password.js';
import { getDataSource } from '../../../../src/shared/db/data-source.js';
import { User } from '../../../../src/shared/db/entities/User.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/middleware/rateLimiter.js', () => ({
  passwordResetLimiter: (_req: any, _res: any, next: any) => next(),
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  engineLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@shared/services/email/index.js', () => ({
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock('@shared/services/audit.js', () => ({
  logAudit: vi.fn(),
}));

describe('POST /api/auth/forgot-password', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(forgotPasswordRouter);
    vi.clearAllMocks();
  });

  it('returns success even for non-existent email', async () => {
    const userRepo = { findOneBy: vi.fn().mockResolvedValue(null) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nonexistent@example.com' });

    expect(response.status).toBe(200);
  });

  it('processes password reset for valid user', async () => {
    const userRepo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        isActive: true,
        authProvider: 'local',
      }),
      update: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'test@example.com' });

    expect(response.status).toBe(200);
    expect(userRepo.update).toHaveBeenCalled();
  });
});
