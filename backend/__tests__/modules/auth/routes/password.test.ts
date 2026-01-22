import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import passwordRouter from '../../../../src/modules/auth/routes/password.js';
import { getDataSource } from '../../../../src/shared/db/data-source.js';
import { User } from '../../../../src/shared/db/entities/User.js';
import { RefreshToken } from '../../../../src/shared/db/entities/RefreshToken.js';
import * as passwordUtils from '../../../../src/shared/utils/password.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@shared/middleware/rateLimiter.js', () => ({
  passwordResetLimiter: (_req: any, _res: any, next: any) => next(),
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  engineLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@shared/utils/password.js', () => ({
  validatePassword: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock('@shared/services/email/index.js', () => ({
  sendVerificationEmail: vi.fn(),
}));

vi.mock('@shared/services/audit.js', () => ({
  logAudit: vi.fn(),
  AuditActions: {},
}));

describe('POST /api/auth/change-password', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(passwordRouter);
    vi.clearAllMocks();
  });

  it('changes password successfully', async () => {
    const userRepo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'user-1', passwordHash: 'old-hash' }),
      update: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        throw new Error('Unexpected repository');
      },
    });

    (passwordUtils.validatePassword as Mock).mockReturnValue({ valid: true, errors: [] });
    (passwordUtils.verifyPassword as Mock).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    (passwordUtils.hashPassword as Mock).mockResolvedValue('new-hash');

    const response = await request(app)
      .post('/api/auth/change-password')
      .send({ currentPassword: 'oldPass123', newPassword: 'newPass456' });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Password changed successfully');
    expect(userRepo.update).toHaveBeenCalled();
  });

  it('rejects invalid current password', async () => {
    const userRepo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'user-1', passwordHash: 'hash' }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        throw new Error('Unexpected repository');
      },
    });

    (passwordUtils.validatePassword as Mock).mockReturnValue({ valid: true, errors: [] });
    (passwordUtils.verifyPassword as Mock).mockResolvedValue(false);

    const response = await request(app)
      .post('/api/auth/change-password')
      .send({ currentPassword: 'wrongPass', newPassword: 'newPass456' });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Current password is incorrect');
  });

});
