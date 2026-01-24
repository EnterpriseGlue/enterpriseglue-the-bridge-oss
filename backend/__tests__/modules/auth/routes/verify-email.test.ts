import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import verifyEmailRouter from '../../../../src/modules/auth/routes/verify-email.js';
import { getDataSource } from '../../../../src/shared/db/data-source.js';
import { User } from '../../../../src/shared/db/entities/User.js';
import { MoreThan } from 'typeorm';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('typeorm', async () => {
  const actual = await vi.importActual('typeorm');
  return {
    ...actual,
    MoreThan: vi.fn((value) => ({ _type: 'moreThan', _value: value })),
  };
});

describe('GET /api/auth/verify-email', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(verifyEmailRouter);
    vi.clearAllMocks();
  });

  it('verifies email with valid token', async () => {
    const userRepo = {
      findOne: vi.fn().mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        isEmailVerified: false,
      }),
      update: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/auth/verify-email?token=valid-token');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(userRepo.update).toHaveBeenCalled();
  });

  it('returns already verified for verified email', async () => {
    const userRepo = {
      findOne: vi.fn().mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        isEmailVerified: true,
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/auth/verify-email?token=valid-token');

    expect(response.status).toBe(200);
    expect(response.body.alreadyVerified).toBe(true);
  });

  it('rejects invalid token', async () => {
    const userRepo = {
      findOne: vi.fn().mockResolvedValue(null),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/auth/verify-email?token=invalid-token');

    expect(response.status).toBe(400);
  });
});
