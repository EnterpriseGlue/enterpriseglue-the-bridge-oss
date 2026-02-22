import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { doubleCsrf } from 'csrf-csrf';
import logoutRouter from '../../../../src/modules/auth/routes/logout.js';
import { getDataSource } from '../../../../src/shared/db/data-source.js';
import { RefreshToken } from '../../../../src/shared/db/entities/RefreshToken.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', type: 'access', platformRole: 'user' };
    next();
  },
}));

describe('POST /api/auth/logout', () => {
  let app: express.Application;

  function registerCsrfMiddleware(app: express.Application) {
    const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
      getSecret: () => 'test-secret',
      getSessionIdentifier: (req: any) => req.cookies?.refreshToken ?? req.cookies?.accessToken ?? req.ip ?? '',
      cookieName: 'csrf_secret',
      cookieOptions: {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
      },
      getCsrfTokenFromRequest: (req: any) => req.headers['x-csrf-token'],
      skipCsrfProtection: (req: any) => {
        if (req.path === '/api/auth/login' || req.path === '/api/auth/refresh' || req.path === '/api/csrf-token') return true;
        const hasBearer = typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ');
        const hasCookieAccessToken = Boolean(req.cookies?.accessToken);
        return hasBearer || !hasCookieAccessToken;
      },
    });

    app.use(doubleCsrfProtection);
    app.get('/api/csrf-token', (req, res) => {
      const csrfToken = generateCsrfToken(req, res);
      res.json({ csrfToken });
    });
    app.use((err: any, _req: any, res: any, next: any) => {
      if (err && (err.code === 'EBADCSRFTOKEN' || err.message?.includes('csrf'))) {
        return res.status(403).json({ error: 'Invalid CSRF token' });
      }
      next(err);
    });
  }

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(cookieParser());
    registerCsrfMiddleware(app);
    app.use(logoutRouter);
    vi.clearAllMocks();
  });

  async function issueCsrfToken(agent: request.SuperAgentTest) {
    const response = await agent
      .get('/api/csrf-token')
      .set('Cookie', 'accessToken=test-cookie-token');

    expect(response.status).toBe(200);
    expect(response.body.csrfToken).toBeTruthy();
    return response.body.csrfToken as string;
  }

  it('rejects logout without CSRF token for cookie-authenticated requests', async () => {
    const refreshTokenRepo = { update: vi.fn() };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RefreshToken) return refreshTokenRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', 'accessToken=test-cookie-token')
      .send({});

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Invalid CSRF token');
    expect(refreshTokenRepo.update).not.toHaveBeenCalled();
  });

  it('revokes all refresh tokens when no token provided', async () => {
    const refreshTokenRepo = { update: vi.fn() };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RefreshToken) return refreshTokenRepo;
        throw new Error('Unexpected repository');
      },
    });

    const agent = request.agent(app);
    const csrfToken = await issueCsrfToken(agent);

    const response = await agent
      .post('/api/auth/logout')
      .set('Cookie', 'accessToken=test-cookie-token')
      .set('X-CSRF-Token', csrfToken)
      .send({});

    expect(response.status).toBe(200);
    expect(refreshTokenRepo.update).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({ revokedAt: expect.any(Number) })
    );
  });

  it('revokes active tokens when refresh token provided', async () => {
    const refreshTokenRepo = { update: vi.fn() };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RefreshToken) return refreshTokenRepo;
        throw new Error('Unexpected repository');
      },
    });

    const agent = request.agent(app);
    const csrfToken = await issueCsrfToken(agent);

    const response = await agent
      .post('/api/auth/logout')
      .set('Cookie', 'accessToken=test-cookie-token')
      .set('X-CSRF-Token', csrfToken)
      .send({ refreshToken: 'refresh-1' });

    expect(response.status).toBe(200);
    expect(refreshTokenRepo.update).toHaveBeenCalled();
  });
});
