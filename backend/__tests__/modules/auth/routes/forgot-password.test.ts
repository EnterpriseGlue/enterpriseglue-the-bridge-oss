import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import forgotPasswordRouter from '../../../../src/modules/auth/routes/forgot-password.js';
import { getDataSource } from '../../../../src/shared/db/data-source.js';
import { User } from '../../../../src/shared/db/entities/User.js';
import { PasswordResetToken } from '../../../../src/shared/db/entities/PasswordResetToken.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/middleware/rateLimiter.js', () => ({
  passwordResetLimiter: (_req: any, _res: any, next: any) => next(),
  passwordResetVerifyLimiter: (_req: any, _res: any, next: any) => next(),
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  engineLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@shared/services/email/index.js', () => ({
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock('@shared/services/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('@shared/utils/password.js', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed-password'),
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
    const resetTokenRepo = { update: vi.fn(), insert: vi.fn() };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        if (entity === PasswordResetToken) return resetTokenRepo;
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
    const resetTokenRepo = { update: vi.fn(), insert: vi.fn() };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        if (entity === PasswordResetToken) return resetTokenRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'test@example.com' });

    expect(response.status).toBe(200);
    expect(resetTokenRepo.insert).toHaveBeenCalled();
  });
});

describe('POST /api/auth/reset-password-with-token', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(forgotPasswordRouter);
    vi.clearAllMocks();
  });

  it('rejects invalid token', async () => {
    const userRepo = { findOneBy: vi.fn() };
    const resetTokenRepo = { findOneBy: vi.fn().mockResolvedValue(null) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        if (entity === PasswordResetToken) return resetTokenRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app)
      .post('/api/auth/reset-password-with-token')
      .send({ token: 'bad-token', newPassword: 'Password123!' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('InvalidToken');
  });

  it('resets password when token is valid', async () => {
    const userRepo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@example.com', isActive: true }),
      update: vi.fn(),
    };
    const resetTokenRepo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'token-1', userId: 'user-1', expiresAt: Date.now() + 1000 }),
      update: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        if (entity === PasswordResetToken) return resetTokenRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app)
      .post('/api/auth/reset-password-with-token')
      .send({ token: 'valid-token', newPassword: 'Password123!' });

    expect(response.status).toBe(200);
    expect(userRepo.update).toHaveBeenCalled();
    expect(resetTokenRepo.update).toHaveBeenCalled();
  });
});

describe('GET /api/auth/verify-reset-token', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(forgotPasswordRouter);
    vi.clearAllMocks();
  });

  it('returns invalid when token is missing', async () => {
    const response = await request(app).get('/api/auth/verify-reset-token');

    expect(response.status).toBe(400);
    expect(response.body.valid).toBe(false);
  });

  it('returns valid for active user token', async () => {
    const userRepo = { findOneBy: vi.fn().mockResolvedValue({ id: 'user-1', isActive: true }) };
    const resetTokenRepo = { findOneBy: vi.fn().mockResolvedValue({ id: 'token-1', userId: 'user-1', expiresAt: Date.now() + 1000 }) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        if (entity === PasswordResetToken) return resetTokenRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/auth/verify-reset-token?token=valid-token');

    expect(response.status).toBe(200);
    expect(response.body.valid).toBe(true);
  });
});
