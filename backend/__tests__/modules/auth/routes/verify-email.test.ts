import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import verifyEmailRouter from '../../../../src/modules/auth/routes/verify-email.js';
import { getDataSource } from '../../../../src/shared/db/data-source.js';
import { User } from '../../../../src/shared/db/entities/User.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@shared/services/email/index.js', () => ({
  sendVerificationEmail: vi.fn(),
}));

vi.mock('@shared/config/index.js', () => ({
  config: { frontendUrl: 'http://localhost:3000' },
}));

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
        emailVerificationTokenExpiry: Date.now() + 1000,
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

    expect(response.status).toBe(200);
    expect(response.body.code).toBe('INVALID_TOKEN');
  });
});

describe('POST /api/auth/resend-verification', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(verifyEmailRouter);
    vi.clearAllMocks();
  });

  it('returns generic response when user not found', async () => {
    const userRepo = {
      findOneBy: vi.fn().mockResolvedValue(null),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'missing@example.com' });

    expect(response.status).toBe(200);
    expect(response.body.message).toContain('verification link');
  });

  it('returns already verified when email verified', async () => {
    const userRepo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'user-1',
        email: 'verified@example.com',
        isEmailVerified: true,
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'verified@example.com' });

    expect(response.status).toBe(200);
    expect(response.body.alreadyVerified).toBe(true);
  });

  it('sends verification email for unverified user', async () => {
    const userRepo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        isEmailVerified: false,
        firstName: 'Test',
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
      .post('/api/auth/resend-verification')
      .send({ email: 'user@example.com' });

    expect(response.status).toBe(200);
    expect(userRepo.update).toHaveBeenCalled();
  });
});
