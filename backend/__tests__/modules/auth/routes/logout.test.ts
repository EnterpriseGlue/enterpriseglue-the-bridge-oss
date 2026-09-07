import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import bcrypt from 'bcryptjs';
import { doubleCsrf } from 'csrf-csrf';
import logoutRouter from '../../../../../packages/backend-host/src/modules/auth/routes/logout.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { RefreshToken } from '@enterpriseglue/shared/db/entities/RefreshToken.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { generateRefreshToken } from '@enterpriseglue/shared/utils/jwt.js';

const genericOidcService = vi.hoisted(() => ({ createLogoutRequest: vi.fn() }));
const genericSamlService = vi.hoisted(() => ({ createLogoutRequest: vi.fn() }));
const userRepo = vi.hoisted(() => ({ increment: vi.fn() }));
const sessionId = '00000000-0000-0000-0000-000000000001';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/GenericOidcService.js', () => ({ genericOidcService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/GenericSamlService.js', () => ({ genericSamlService }));
vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  AuditActions: { LOGOUT: 'auth.logout' }, auditFromRequest: vi.fn((_req, entry) => entry), logAudit: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', type: 'access', platformRole: 'user', sessionId: '00000000-0000-0000-0000-000000000001' };
    next();
  },
}));

describe('POST /api/auth/logout', () => {
  let app: express.Application;

  const testCookieParser: express.RequestHandler = (req, _res, next) => {
    const cookieHeader = req.headers.cookie;
    const cookies: Record<string, string> = Object.create(null);

    if (cookieHeader) {
      for (const part of cookieHeader.split(';')) {
        const [nameRaw, ...rest] = part.trim().split('=');
        if (!nameRaw || nameRaw === '__proto__' || nameRaw === 'constructor' || nameRaw === 'prototype') continue;
        cookies[nameRaw] = decodeURIComponent(rest.join('=') || '');
      }
    }

    (req as any).cookies = cookies;
    next();
  };

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
    app.use(testCookieParser);
    registerCsrfMiddleware(app);
    app.use(logoutRouter);
    vi.clearAllMocks();
    userRepo.increment.mockResolvedValue({ affected: 1 });
    genericOidcService.createLogoutRequest.mockResolvedValue('https://issuer.example.test/logout');
    genericSamlService.createLogoutRequest.mockResolvedValue(null);
  });

  async function issueCsrfToken(agent: ReturnType<typeof request.agent>) {
    const response = await agent
      .get('/api/csrf-token')
      .set('Cookie', 'accessToken=test-cookie-token');

    expect(response.status).toBe(200);
    expect(response.body.csrfToken).toBeTruthy();
    return response.body.csrfToken as string;
  }

  it('rejects logout without CSRF token for cookie-authenticated requests', async () => {
    const refreshTokenRepo = { update: vi.fn(), find: vi.fn().mockResolvedValue([]) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RefreshToken) return refreshTokenRepo;
        if (entity === User) return userRepo;
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
    const refreshTokenRepo = { update: vi.fn(), find: vi.fn().mockResolvedValue([]) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RefreshToken) return refreshTokenRepo;
        if (entity === User) return userRepo;
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
    expect(response.body).toEqual({ message: 'Logged out successfully', federatedLogoutUrl: null });
    expect(userRepo.increment).toHaveBeenCalledWith({ id: 'user-1' }, 'authSessionVersion', 1);
    expect(userRepo.increment.mock.invocationCallOrder[0]).toBeLessThan(refreshTokenRepo.update.mock.invocationCallOrder[0]);
    expect(refreshTokenRepo.update).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({ revokedAt: expect.any(Number) })
    );
  });

  it('revokes active tokens when refresh token provided', async () => {
    const refreshTokenRepo = { update: vi.fn(), find: vi.fn().mockResolvedValue([]) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RefreshToken) return refreshTokenRepo;
        if (entity === User) return userRepo;
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

  it('revokes local sessions first and returns the verified OIDC provider logout target', async () => {
    const presentedToken = generateRefreshToken({ id: 'user-1' }, { sessionId });
    const providerSession = {
      id: sessionId, userId: 'user-1', identityProviderId: 'provider-1',
      providerSubjectId: 'subject-1', providerSessionId: 'sid-1', providerNameIdFormat: null,
      tokenHash: await bcrypt.hash(presentedToken, 4), createdAt: Date.now(), revokedAt: null,
    };
    const refreshTokenRepo = { update: vi.fn().mockResolvedValue({ affected: 1 }), find: vi.fn().mockResolvedValue([providerSession]) };
    const identityProviderRepo = { findOne: vi.fn().mockResolvedValue({
      id: 'provider-1', isEnabled: true, authenticationMode: 'direct', protocol: 'oidc',
      configurationJson: JSON.stringify({ issuerUrl: 'https://issuer.example.test' }),
    }) };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RefreshToken) return refreshTokenRepo;
        if (entity === User) return userRepo;
        if (entity === IdentityProvider) return identityProviderRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', 'Bearer test')
      .send({ refreshToken: presentedToken });

    expect(response.status).toBe(200);
    expect(refreshTokenRepo.update.mock.invocationCallOrder[0]).toBeLessThan(genericOidcService.createLogoutRequest.mock.invocationCallOrder[0]);
    expect(response.body.federatedLogoutUrl).toBe('https://issuer.example.test/logout');
  });

  it('keeps local logout successful when the identity provider logout endpoint fails', async () => {
    const presentedToken = generateRefreshToken({ id: 'user-1' }, { sessionId });
    const refreshTokenRepo = {
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      find: vi.fn().mockResolvedValue([{
        id: sessionId, identityProviderId: 'provider-1', providerSubjectId: 'subject-1', tokenHash: await bcrypt.hash(presentedToken, 4), createdAt: Date.now(),
      }]),
    };
    const identityProviderRepo = { findOne: vi.fn().mockResolvedValue({
      id: 'provider-1', isEnabled: true, authenticationMode: 'direct', protocol: 'oidc', configurationJson: '{}',
    }) };
    genericOidcService.createLogoutRequest.mockRejectedValue(new Error('provider unavailable'));
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => entity === RefreshToken ? refreshTokenRepo : entity === User ? userRepo : identityProviderRepo });

    const response = await request(app).post('/api/auth/logout').set('Authorization', 'Bearer test').send({ refreshToken: presentedToken });

    expect(response.status).toBe(200);
    expect(response.body.federatedLogoutUrl).toBeNull();
    expect(refreshTokenRepo.update).toHaveBeenCalled();
  });

  it('selects the signed exact provider session even when bcrypt also matches a sibling JWT prefix', async () => {
    const presentedToken = generateRefreshToken({ id: 'user-1' }, { sessionId });
    const siblingId = '00000000-0000-0000-0000-000000000002';
    const siblingToken = generateRefreshToken({ id: 'user-1' }, { sessionId: siblingId });
    const siblingHash = await bcrypt.hash(siblingToken, 4);
    // This is why a hash scan alone cannot establish provider session lineage.
    expect(await bcrypt.compare(presentedToken, siblingHash)).toBe(true);
    const tokens = { update: vi.fn(), find: vi.fn().mockResolvedValue([
      { id: siblingId, identityProviderId: 'wrong-provider', providerSubjectId: 'other', tokenHash: siblingHash },
      { id: sessionId, identityProviderId: 'right-provider', providerSubjectId: 'current', tokenHash: await bcrypt.hash(presentedToken, 4) },
    ]) };
    const providers = { findOne: vi.fn().mockResolvedValue(null) };
    vi.mocked(getDataSource).mockResolvedValue({ getRepository: (entity: unknown) => entity === User ? userRepo : entity === RefreshToken ? tokens : providers } as any);
    expect((await request(app).post('/api/auth/logout').set('Authorization', 'Bearer test').send({ refreshToken: presentedToken })).status).toBe(200);
    expect(providers.findOne).toHaveBeenCalledWith({ where: { id: 'right-provider' } });
  });

  it('keeps legacy logout local instead of guessing a provider from truncated hashes', async () => {
    const legacy = generateRefreshToken({ id: 'user-1' });
    const tokens = { update: vi.fn(), find: vi.fn().mockResolvedValue([
      { id: sessionId, identityProviderId: 'provider-1', providerSubjectId: 'subject-1', tokenHash: await bcrypt.hash(legacy, 4) },
    ]) };
    const providers = { findOne: vi.fn() };
    vi.mocked(getDataSource).mockResolvedValue({ getRepository: (entity: unknown) => entity === User ? userRepo : entity === RefreshToken ? tokens : providers } as any);
    const response = await request(app).post('/api/auth/logout').set('Authorization', 'Bearer test').send({ refreshToken: legacy });
    expect(response.status).toBe(200);
    expect(response.body.federatedLogoutUrl).toBeNull();
    expect(userRepo.increment).toHaveBeenCalledOnce(); expect(tokens.update).toHaveBeenCalledOnce();
    expect(providers.findOne).not.toHaveBeenCalled();
  });
});
