import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import refreshRouter from '../../../../src/modules/auth/routes/refresh.js';
import { getDataSource } from '../../../../src/shared/db/data-source.js';
import { User } from '../../../../src/shared/db/entities/User.js';
import { RefreshToken } from '../../../../src/shared/db/entities/RefreshToken.js';
import { errorHandler } from '../../../../src/shared/middleware/errorHandler.js';
import * as jwt from '../../../../src/shared/utils/jwt.js';
import bcrypt from 'bcryptjs';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/utils/jwt.js');

vi.mock('@shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@shared/config/index.js', () => ({
  config: {
    jwtAccessTokenExpires: 3600,
    jwtRefreshTokenExpires: 604800,
    nodeEnv: 'test',
  },
}));

describe('POST /api/auth/refresh', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(require('cookie-parser')());
    app.use(refreshRouter);
    app.use(errorHandler);
    vi.clearAllMocks();
  });

  it('refreshes access token with valid refresh token', async () => {
    const mockUser = {
      id: 'user-1',
      email: 'test@example.com',
      platformRole: 'user',
      isActive: true,
    };

    const tokenHash = await bcrypt.hash('refresh-token', 10);

    const userRepo = { findOneBy: vi.fn().mockResolvedValue(mockUser) };
    const refreshTokenRepo = {
      find: vi.fn().mockResolvedValue([{ tokenHash }]),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        if (entity === RefreshToken) return refreshTokenRepo;
        throw new Error('Unexpected repository');
      },
    });

    (jwt.verifyToken as any).mockReturnValue({ userId: 'user-1', type: 'refresh' });
    (jwt.generateAccessToken as any).mockReturnValue('new-access-token');

    const response = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'refresh-token' });

    expect(response.status).toBe(200);
    expect(response.body.expiresIn).toBe(3600);
  });

  it('rejects invalid token type', async () => {
    (jwt.verifyToken as any).mockReturnValue({ userId: 'user-1', type: 'access' });

    const response = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'access-token' });

    expect(response.status).toBe(401);
  });
});
