import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import { doubleCsrf } from 'csrf-csrf';
import refreshRouter from '../../../../../packages/backend-host/src/modules/auth/routes/refresh.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { RefreshToken } from '@enterpriseglue/shared/db/entities/RefreshToken.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import * as jwt from '@enterpriseglue/shared/utils/jwt.js';
import bcrypt from 'bcryptjs';

// Test fixture tokens — not real secrets (CWE-547)
const TEST_REFRESH_TOKEN = `test-refresh-${Date.now()}`;
const TEST_ACCESS_TOKEN = `test-access-${Date.now()}`;
const TEST_NEW_ACCESS_TOKEN = `test-new-access-${Date.now()}`;

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/utils/jwt.js', () => ({
  verifyToken: vi.fn(),
  generateAccessToken: vi.fn(),
  normalizeUserJwtPayload: (payload: any) => {
    const principalType = payload.principalType ?? 'user';
    const principalId = payload.principalId ?? payload.userId;
    if (principalType !== 'user' || !principalId || (payload.userId !== undefined && payload.userId !== principalId)) {
      throw new Error('Invalid user principal');
    }
    return { ...payload, userId: principalId, principalType, principalId };
  },
}));

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/config/index.js', () => ({
  shouldUseSecureCookies: () => false,
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
    app.disable('x-powered-by');
    app.use(express.json());

    // CSRF protection — mirrors production config with skipCsrfProtection for this endpoint.
    const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
      getSecret: () => 'test-secret',
      getSessionIdentifier: () => 'test',
      cookieName: 'csrf_secret',
      // In tests, we still exempt this endpoint from CSRF enforcement.
      skipCsrfProtection: () => true,
      // Provide a token extractor so CSRF middleware is fully configured.
      getCsrfTokenFromRequest: (req: any) =>
        (req.headers['x-csrf-token'] as string) ||
        (req.body && (req.body._csrf as string)) ||
        (req.query && (req.query._csrf as string)) ||
        '',
    });

    // Cookie parser + CSRF token endpoint (satisfies CodeQL js/missing-token-validation).
    const cookieParser = require('cookie-parser');
    app.use(cookieParser());
    app.get('/api/csrf-token', (req: any, res: any) => {
      const csrfToken = generateCsrfToken(req, res);
      res.json({ csrfToken });
    });
    app.use(doubleCsrfProtection);
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
      authSessionVersion: 2,
    };

    const tokenHash = await bcrypt.hash(TEST_REFRESH_TOKEN, 10);

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

    (jwt.verifyToken as any).mockReturnValue({
      userId: 'user-1',
      principalType: 'user',
      principalId: 'user-1',
      authSessionVersion: 2,
      type: 'refresh',
    });
    (jwt.generateAccessToken as any).mockReturnValue(TEST_NEW_ACCESS_TOKEN);

    const response = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: TEST_REFRESH_TOKEN });

    expect(response.status).toBe(200);
    expect(response.body.expiresIn).toBe(3600);
    expect(jwt.generateAccessToken).toHaveBeenCalledWith(mockUser, { administratorRecovery: false, authenticationMethod: undefined, mfaVerified: false });
  });

  it('refreshes a canonical-principal refresh token without legacy user fields', async () => {
    const mockUser = { id: 'user-1', email: 'test@example.com', isActive: true, authSessionVersion: 2 };
    const tokenHash = await bcrypt.hash(TEST_REFRESH_TOKEN, 10);
    const userRepo = { findOneBy: vi.fn().mockResolvedValue(mockUser) };
    const refreshTokenRepo = { find: vi.fn().mockResolvedValue([{ tokenHash }]) };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === User ? userRepo : entity === RefreshToken ? refreshTokenRepo : (() => { throw new Error('Unexpected repository'); })(),
    });
    (jwt.verifyToken as any).mockReturnValue({ principalType: 'user', principalId: 'user-1', authSessionVersion: 2, type: 'refresh' });
    (jwt.generateAccessToken as any).mockReturnValue(TEST_NEW_ACCESS_TOKEN);

    const response = await request(app).post('/api/auth/refresh').send({ refreshToken: TEST_REFRESH_TOKEN });

    expect(response.status).toBe(200);
    expect(jwt.generateAccessToken).toHaveBeenCalledWith(mockUser, { administratorRecovery: false, authenticationMethod: undefined, mfaVerified: false });
  });

  it('rejects an existing administrator-recovery refresh session after membership expires or is removed', async () => {
    const mockUser = { id: 'user-1', email: 'admin@example.com', isActive: true, authSessionVersion: 2 };
    const userRepo = { findOneBy: vi.fn().mockResolvedValue(mockUser) };
    const refreshTokenRepo = { find: vi.fn() };
    const membershipRepo = { find: vi.fn().mockResolvedValue([]) };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        if (entity === RefreshToken) return refreshTokenRepo;
        if (entity === AuthzGroupMembership) return membershipRepo;
        throw new Error('Unexpected repository');
      },
    });
    (jwt.verifyToken as any).mockReturnValue({
      principalType: 'user', principalId: 'user-1', authSessionVersion: 2, type: 'refresh', recovery: 'platform_administrator',
    });

    const response = await request(app).post('/api/auth/refresh').send({ refreshToken: TEST_REFRESH_TOKEN });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Session has been revoked');
    expect(refreshTokenRepo.find).not.toHaveBeenCalled();
    expect(jwt.generateAccessToken).not.toHaveBeenCalled();
  });

  it('rejects missing refresh token', async () => {
    const response = await request(app)
      .post('/api/auth/refresh')
      .send({});

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('No refresh token provided');
  });

  it('rejects invalid token type', async () => {
    (jwt.verifyToken as any).mockReturnValue({ userId: 'user-1', type: 'access' });

    const response = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: TEST_ACCESS_TOKEN });

    expect(response.status).toBe(401);
  });

  it('rejects inactive user for refresh token', async () => {
    const userRepo = { findOneBy: vi.fn().mockResolvedValue(null) };
    const refreshTokenRepo = { find: vi.fn() };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        if (entity === RefreshToken) return refreshTokenRepo;
        throw new Error('Unexpected repository');
      },
    });

    (jwt.verifyToken as any).mockReturnValue({ userId: 'user-1', type: 'refresh' });

    const response = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: TEST_REFRESH_TOKEN });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('User not found or inactive');
    expect(refreshTokenRepo.find).not.toHaveBeenCalled();
  });

  it('accepts a compatible legacy refresh token without principal fields', async () => {
    const mockUser = {
      id: 'user-1',
      email: 'test@example.com',
      isActive: true,
      authSessionVersion: 0,
    };
    const tokenHash = await bcrypt.hash(TEST_REFRESH_TOKEN, 10);
    const userRepo = { findOneBy: vi.fn().mockResolvedValue(mockUser) };
    const refreshTokenRepo = { find: vi.fn().mockResolvedValue([{ tokenHash }]) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        if (entity === RefreshToken) return refreshTokenRepo;
        throw new Error('Unexpected repository');
      },
    });
    (jwt.verifyToken as any).mockReturnValue({ userId: 'user-1', type: 'refresh' });
    (jwt.generateAccessToken as any).mockReturnValue(TEST_NEW_ACCESS_TOKEN);

    const response = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: TEST_REFRESH_TOKEN });

    expect(response.status).toBe(200);
  });

  it('rejects a refresh token with a mismatched canonical principal before database access', async () => {
    (jwt.verifyToken as any).mockReturnValue({
      userId: 'user-1',
      principalType: 'user',
      principalId: 'other-user',
      type: 'refresh',
    });

    const response = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: TEST_REFRESH_TOKEN });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Invalid user principal');
    expect(getDataSource).not.toHaveBeenCalled();
  });

  it('rejects a refresh token after its session version is revoked', async () => {
    const userRepo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        isActive: true,
        authSessionVersion: 3,
      }),
    };
    const refreshTokenRepo = { find: vi.fn() };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        if (entity === RefreshToken) return refreshTokenRepo;
        throw new Error('Unexpected repository');
      },
    });
    (jwt.verifyToken as any).mockReturnValue({
      userId: 'user-1',
      principalType: 'user',
      principalId: 'user-1',
      authSessionVersion: 2,
      type: 'refresh',
    });

    const response = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: TEST_REFRESH_TOKEN });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Session has been revoked');
    expect(refreshTokenRepo.find).not.toHaveBeenCalled();
  });

  it('rejects refresh token when no stored non-revoked token hash matches', async () => {
    const mockUser = {
      id: 'user-1',
      email: 'test@example.com',
      platformRole: 'user',
      isActive: true,
    };

    const userRepo = { findOneBy: vi.fn().mockResolvedValue(mockUser) };
    const refreshTokenRepo = {
      find: vi.fn().mockResolvedValue([]),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        if (entity === RefreshToken) return refreshTokenRepo;
        throw new Error('Unexpected repository');
      },
    });

    (jwt.verifyToken as any).mockReturnValue({ userId: 'user-1', type: 'refresh' });

    const response = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: TEST_REFRESH_TOKEN });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Invalid refresh token');
  });
});
