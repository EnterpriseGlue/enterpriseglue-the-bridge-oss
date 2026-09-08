import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireAuth, requireCloudAccountOrTenantAuth, requireAdmin, requireOnboarding, optionalAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireOnboarding as requireOnboardingFromInterfaces } from '@enterpriseglue/shared/interfaces/middleware/auth.js';
import { AppError } from '@enterpriseglue/shared/middleware/errorHandler.js';
import * as jwt from '@enterpriseglue/shared/utils/jwt.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { permissionService, PlatformPermissions } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { Request, Response, NextFunction } from 'express';
import { config } from '@enterpriseglue/shared/config/index.js';
import { tenantService } from '@enterpriseglue/shared/services/platform-admin/TenantService.js';
import { getTenantDatabaseContext } from '@enterpriseglue/shared/services/tenant-database-context.js';

const bpmnRequestContext = vi.hoisted(() => ({
  updateBpmnEngineRequestContext: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/utils/jwt.js', () => ({
  verifyToken: vi.fn(),
  normalizeUserJwtPayload: (payload: any) => {
    const principalType = payload.principalType ?? 'user';
    const principalId = payload.principalId ?? payload.userId;
    if (principalType !== 'user' || !principalId || (payload.userId !== undefined && payload.userId !== principalId)) {
      throw new Error('Invalid user principal');
    }
    return { ...payload, userId: principalId, principalType, principalId };
  },
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/bpmn-engine-request-context.js', () => bpmnRequestContext);

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  permissionService: {
    hasPermission: vi.fn(),
  },
  PlatformPermissions: {
    AUTHZ_ROLES_MANAGE: 'platform:authz:roles:manage',
  },
  SYSTEM_ROLE_IDS: {
    TENANT_ADMIN: 'system.tenant.admin',
    TENANT_ENGINE_OPERATOR: 'system.tenant.engine_operator',
    TENANT_VIEWER: 'system.tenant.viewer',
  },
}));

// Test fixture tokens — not real secrets (CWE-547)
// Must look like valid JWTs (three base64url segments) to pass format validation
const TEST_BEARER_TOKEN = `eyJhbGciOiJIUzI1NiJ9.eyJ0ZXN0IjoiYmVhcmVyIn0.${Date.now()}`;
const TEST_COOKIE_TOKEN = `eyJhbGciOiJIUzI1NiJ9.eyJ0ZXN0IjoiY29va2llIn0.${Date.now()}`;

describe('auth middleware', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = { headers: {}, cookies: {}, path: '' };
    res = {};
    next = vi.fn();
    vi.clearAllMocks();
    (permissionService.hasPermission as any).mockResolvedValue(false);
  });

  describe.each([['required', requireAuth], ['optional', optionalAuth]] as const)('%s exact-session authentication', (_label, middleware) => {
    it.each([true, false])('establishes identity only when its durable session is active (%s)', async (active) => {
      const sessionId = '00000000-0000-0000-0000-000000000001';
      req.headers = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };
      vi.mocked(jwt.verifyToken).mockReturnValue({ userId: 'user-1', type: 'access', sessionId });
      const findSession = vi.fn().mockResolvedValue(active ? { id: sessionId } : null);
      vi.mocked(getDataSource).mockResolvedValue({ getRepository: (entity: unknown) => {
        if (entity === User) return { findOneBy: vi.fn().mockResolvedValue({ isActive: true, isEmailVerified: true, email: 'user@example.test' }) };
        if (entity === RefreshToken) return { findOneBy: findSession };
        throw new Error('Unexpected repository');
      } } as any);
      await middleware(req as Request, res as Response, next);
      expect(findSession).toHaveBeenCalledWith({ id: sessionId, userId: 'user-1', tenantId: expect.objectContaining({ _type: 'isNull' }), revokedAt: expect.objectContaining({ _type: 'isNull' }), expiresAt: expect.objectContaining({ _type: 'moreThan' }) });
      if (active) {
        expect(req.user).toMatchObject({ userId: 'user-1', sessionId });
        expect(next).toHaveBeenCalledWith();
      } else {
        expect(req.user).toBeUndefined();
        expect(bpmnRequestContext.updateBpmnEngineRequestContext).not.toHaveBeenCalled();
        if (middleware === requireAuth) expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
        else expect(next).toHaveBeenCalledWith();
      }
    });
  });

  describe('managed Cloud account sessions', () => {
    async function withManagedCloudAccount(work: () => Promise<void>) {
      const previous = {
        tenancyMode: config.tenancyMode,
        tenancyCloudRequired: config.tenancyCloudRequired,
        cloudAccountIdentityEnabled: config.cloudAccountIdentityEnabled,
        adminEmailVerificationExempt: config.adminEmailVerificationExempt,
        adminEmail: config.adminEmail,
      };
      config.tenancyMode = 'pooled';
      config.tenancyCloudRequired = true;
      config.cloudAccountIdentityEnabled = true;
      try { await work(); } finally { Object.assign(config, previous); }
    }

    function arrangeCloudAccountSession(options: { verified?: boolean; persisted?: boolean; email?: string } = {}) {
      const sessionId = '00000000-0000-0000-0000-000000000001';
      req = {
        ...req,
        headers: { authorization: `Bearer ${TEST_BEARER_TOKEN}` },
        path: '/api/auth/me',
      };
      vi.mocked(jwt.verifyToken).mockReturnValue({
        principalType: 'user', principalId: 'user-1', type: 'access', sessionId,
        authSessionVersion: 2, authenticationMethod: 'oidc', sessionClass: 'cloud_account',
      });
      vi.mocked(getDataSource).mockResolvedValue({ getRepository: (entity: unknown) => {
        if (entity === User) return { findOneBy: vi.fn().mockResolvedValue({
          id: 'user-1', isActive: true, isEmailVerified: options.verified !== false,
          email: options.email || 'user@example.test', authSessionVersion: 2, createdByUserId: null,
        }) };
        if (entity === RefreshToken) return { findOneBy: vi.fn().mockResolvedValue({
          id: sessionId,
          deviceInfo: options.persisted === false ? '{}' : JSON.stringify({ sessionClass: 'cloud_account' }),
        }) };
        throw new Error('Unexpected repository');
      } } as any);
    }

    it('admits the explicit durable class only through the bounded account-capable middleware', async () => {
      await withManagedCloudAccount(async () => {
        arrangeCloudAccountSession();
        await requireCloudAccountOrTenantAuth(req as Request, res as Response, next);
        expect(req.user).toMatchObject({ userId: 'user-1', sessionClass: 'cloud_account' });
        expect(req.tenant).toBeUndefined();
        expect(next).toHaveBeenCalledExactlyOnceWith();

        req.user = undefined;
        next = vi.fn();
        await requireAuth(req as Request, res as Response, next);
        expect(req.user).toBeUndefined();
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
      });
    });

    it.each([
      ['feature disabled', (): void => { config.cloudAccountIdentityEnabled = false; }],
      ['unverified user', (): void => undefined],
      ['missing durable class', (): void => undefined],
    ] as const)('rejects a neutral session with %s', async (label, mutate) => {
      await withManagedCloudAccount(async () => {
        arrangeCloudAccountSession({
          verified: label !== 'unverified user',
          persisted: label !== 'missing durable class',
        });
        mutate();
        await requireCloudAccountOrTenantAuth(req as Request, res as Response, next);
        expect(req.user).toBeUndefined();
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: expect.any(Number) }));
      });
    });

    it('requires verified email even for the ordinary bootstrap-admin exemption', async () => {
      await withManagedCloudAccount(async () => {
        config.adminEmailVerificationExempt = true;
        config.adminEmail = 'bootstrap@example.test';
        arrangeCloudAccountSession({ verified: false, email: 'bootstrap@example.test' });
        await requireCloudAccountOrTenantAuth(req as Request, res as Response, next);
        expect(req.user).toBeUndefined();
        expect(next).toHaveBeenCalledWith(expect.objectContaining({
          statusCode: 403,
          message: 'Email verification required',
        }));
      });
    });
  });

  describe('requireAuth', () => {
    it('accepts valid bearer token', async () => {
      req.headers = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };
      (jwt.verifyToken as any).mockReturnValue({ userId: 'user-1', type: 'access', platformRole: 'user', email: 'user@example.com' });
      (getDataSource as any).mockResolvedValue({
        getRepository: (entity: unknown) => {
          if (entity === User) return { findOneBy: vi.fn().mockResolvedValue({ isActive: true, isEmailVerified: true, email: 'user@example.com' }) };
          throw new Error('Unexpected repository');
        },
      });

      await requireAuth(req as Request, res as Response, next);

      expect(req.user).toEqual({ userId: 'user-1', type: 'access', platformRole: 'user', email: 'user@example.com', principalType: 'user', principalId: 'user-1' });
      expect(bpmnRequestContext.updateBpmnEngineRequestContext).toHaveBeenCalledWith({ userId: 'user-1' });
      expect(next).toHaveBeenCalled();
    });

    it('accepts token from cookies', async () => {
      req.cookies = { accessToken: TEST_COOKIE_TOKEN };
      (jwt.verifyToken as any).mockReturnValue({ userId: 'user-1', type: 'access', platformRole: 'user', email: 'user@example.com' });
      (getDataSource as any).mockResolvedValue({
        getRepository: (entity: unknown) => {
          if (entity === User) return { findOneBy: vi.fn().mockResolvedValue({ isActive: true, isEmailVerified: true, email: 'user@example.com' }) };
          throw new Error('Unexpected repository');
        },
      });

      await requireAuth(req as Request, res as Response, next);

      expect(req.user).toBeDefined();
      expect(next).toHaveBeenCalled();
    });

    it('accepts a new canonical-principal token without legacy user fields', async () => {
      req.headers = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };
      (jwt.verifyToken as any).mockReturnValue({ principalType: 'user', principalId: 'user-1', type: 'access', authSessionVersion: 2 });
      (getDataSource as any).mockResolvedValue({
        getRepository: () => ({ findOneBy: vi.fn().mockResolvedValue({ id: 'user-1', isActive: true, isEmailVerified: true, email: 'user@example.com', authSessionVersion: 2 }) }),
      });

      await requireAuth(req as Request, res as Response, next);

      expect(req.user).toMatchObject({ userId: 'user-1', principalType: 'user', principalId: 'user-1', email: 'user@example.com' });
      expect(next).toHaveBeenCalledWith();
    });

    it('rejects an access token after its user session version advances', async () => {
      req.headers = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };
      (jwt.verifyToken as any).mockReturnValue({ userId: 'user-1', type: 'access', email: 'user@example.com', authSessionVersion: 0 });
      (getDataSource as any).mockResolvedValue({
        getRepository: () => ({ findOneBy: vi.fn().mockResolvedValue({ isActive: true, isEmailVerified: true, email: 'user@example.com', authSessionVersion: 1 }) }),
      });

      await requireAuth(req as Request, res as Response, next);

      expect(req.user).toBeUndefined();
      expect(bpmnRequestContext.updateBpmnEngineRequestContext).not.toHaveBeenCalled();
      expect((next as any).mock.calls[0][0]?.message).toContain('Session has been revoked');
    });

    it('rejects an existing administrator-recovery access session after membership expires or is removed', async () => {
      req.headers = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };
      (jwt.verifyToken as any).mockReturnValue({
        principalType: 'user', principalId: 'user-1', type: 'access', authSessionVersion: 2, recovery: 'platform_administrator',
      });
      (getDataSource as any).mockResolvedValue({
        getRepository: (entity: unknown) => {
          if (entity === User) return { findOneBy: vi.fn().mockResolvedValue({ id: 'user-1', isActive: true, isEmailVerified: true, email: 'admin@example.com', authSessionVersion: 2 }) };
          if (entity === AuthzGroupMembership) return { find: vi.fn().mockResolvedValue([]) };
          throw new Error('Unexpected repository');
        },
      });

      await requireAuth(req as Request, res as Response, next);

      expect(req.user).toBeUndefined();
      expect(bpmnRequestContext.updateBpmnEngineRequestContext).not.toHaveBeenCalled();
      expect((next as any).mock.calls[0][0]?.message).toContain('Session has been revoked');
    });

    it('does not establish request identity for an inactive user', async () => {
      req.headers = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };
      (jwt.verifyToken as any).mockReturnValue({ userId: 'user-1', type: 'access', email: 'user@example.com' });
      (getDataSource as any).mockResolvedValue({
        getRepository: () => ({ findOneBy: vi.fn().mockResolvedValue(null) }),
      });

      await requireAuth(req as Request, res as Response, next);

      expect(req.user).toBeUndefined();
      expect(bpmnRequestContext.updateBpmnEngineRequestContext).not.toHaveBeenCalled();
      expect((next as any).mock.calls[0][0]?.message).toContain('User not found or inactive');
    });

    it('runs enterprise tenant authorization resolver after user validation', async () => {
      const resolver = vi.fn(async (request: Request) => {
        request.tenantRole = 'tenant_admin';
      });
      req = {
        ...req,
        headers: { authorization: `Bearer ${TEST_BEARER_TOKEN}` },
        app: { locals: { enterpriseTenantAuthorizationResolver: resolver } } as any,
      };
      const user = { id: 'user-1', isActive: true, isEmailVerified: true, email: 'user@example.com', platformRole: 'user' };
      const tokenPayload = { userId: 'user-1', type: 'access', platformRole: 'user', email: 'user@example.com' };
      (jwt.verifyToken as any).mockReturnValue(tokenPayload);
      (getDataSource as any).mockResolvedValue({
        getRepository: (entity: unknown) => {
          if (entity === User) return { findOneBy: vi.fn().mockResolvedValue(user) };
          throw new Error('Unexpected repository');
        },
      });

      await requireAuth(req as Request, res as Response, next);

      expect(resolver).toHaveBeenCalledWith(req, {
        tokenPayload: { ...tokenPayload, principalType: 'user', principalId: 'user-1' },
        user,
      });
      expect(req.tenantRole).toBe('tenant_admin');
      expect(next).toHaveBeenCalled();
    });

    it('reports missing token', async () => {
      await requireAuth(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      const error = (next as any).mock.calls[0][0];
      expect(error).toBeInstanceOf(AppError);
      expect(error?.message).toContain('No token provided');
    });

    it('rejects malformed tokens before verification', async () => {
      req.headers = { authorization: 'Bearer invalid token with spaces' };

      await requireAuth(req as Request, res as Response, next);

      expect(jwt.verifyToken).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
      const error = (next as any).mock.calls[0][0];
      expect(error).toBeInstanceOf(AppError);
      expect(error?.message).toContain('Malformed token');
    });

    it('reports invalid token type', async () => {
      req.headers = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };
      (jwt.verifyToken as any).mockReturnValue({ userId: 'user-1', type: 'refresh', email: 'user@example.com' });

      await requireAuth(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      const error = (next as any).mock.calls[0][0];
      expect(error).toBeInstanceOf(AppError);
      expect(error?.message).toContain('Invalid token type');
    });

    it('rejects a token whose explicit principal does not match its user', async () => {
      req.headers = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };
      (jwt.verifyToken as any).mockReturnValue({ userId: 'user-1', principalType: 'user', principalId: 'user-2', type: 'access', platformRole: 'user', email: 'user@example.com' });

      await requireAuth(req as Request, res as Response, next);

      const error = (next as any).mock.calls[0][0];
      expect(error).toBeInstanceOf(AppError);
      expect(error?.message).toContain('Invalid user principal');
      expect(getDataSource).not.toHaveBeenCalled();
    });

    it('blocks unverified users from protected paths', async () => {
      req = { ...req, path: '/api/users', headers: { authorization: `Bearer ${TEST_BEARER_TOKEN}` } };
      (jwt.verifyToken as any).mockReturnValue({ userId: 'user-1', type: 'access', platformRole: 'user', email: 'user@example.com' });
      (getDataSource as any).mockResolvedValue({
        getRepository: (entity: unknown) => {
          if (entity === User) {
            return { findOneBy: vi.fn().mockResolvedValue({ isActive: true, isEmailVerified: false, email: 'user@example.com' }) };
          }
          throw new Error('Unexpected repository');
        },
      });

      await requireAuth(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      const error = (next as any).mock.calls[0][0];
      expect(error).toBeInstanceOf(AppError);
      expect(error?.message).toContain('Email verification required');
    });
  });

  describe('requireAdmin', () => {
    it('allows users with the canonical platform-administration permission', async () => {
      req.user = { userId: 'admin-1', principalType: 'user', principalId: 'admin-1', type: 'access', platformRole: 'user', email: 'admin@example.com' };
      (permissionService.hasPermission as any).mockResolvedValue(true);

      await requireAdmin(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(permissionService.hasPermission).toHaveBeenCalledWith(PlatformPermissions.AUTHZ_ROLES_MANAGE, {
        userId: 'admin-1',
        tenantId: null,
        resourceType: 'platform',
      });
    });

    it('does not grant admin access from a legacy platform role claim', async () => {
      req.user = { userId: 'user-1', principalType: 'user', principalId: 'user-1', type: 'access', platformRole: 'admin', email: 'user@example.com' };

      await requireAdmin(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      const error = (next as any).mock.calls[0][0];
      expect(error).toBeInstanceOf(AppError);
      expect(error?.message).toContain('Admin access required');
    });

    it('reports when no user', async () => {
      await requireAdmin(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      const error = (next as any).mock.calls[0][0];
      expect(error).toBeInstanceOf(AppError);
      expect(error?.message).toContain('Authentication required');
    });
  });

  describe('requireOnboarding', () => {
    async function withPooledOnboarding(work: () => Promise<void>) {
      const originalMode = config.tenancyMode;
      config.tenancyMode = 'pooled';
      req.cookies = { onboardingToken: TEST_COOKIE_TOKEN };
      vi.mocked(jwt.verifyToken).mockReturnValue({ userId: 'user-1', type: 'onboarding', invitationId: 'invite-1',
        tenantId: 'alpha-id', tenantSlug: 'alpha', authSessionVersion: 0 });
      vi.mocked(getDataSource).mockResolvedValue({ getRepository: () => ({ findOneBy: vi.fn().mockResolvedValue({
        id: 'user-1', isActive: true, authSessionVersion: 0,
      }) }) } as any);
      const tenantRead = vi.spyOn(tenantService, 'getById').mockResolvedValue({ id: 'alpha-id', slug: 'alpha',
        status: 'active', placementKey: 'shard-a', placementEpoch: 7 } as any);
      try { await work(); } finally { tenantRead.mockRestore(); config.tenancyMode = originalMode; }
    }

    it.each([{ tenantId: 'beta-id', tenantSlug: 'beta' }, { tenantId: 'alpha-id', tenantSlug: 'beta' }])('rejects sibling routed context without overwriting it (%j)', async (routed) => {
      await withPooledOnboarding(async () => {
        req.tenant = routed;
        await requireOnboarding(req as Request, res as Response, next);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
        expect(req.tenant).toBe(routed);
        expect(req.onboarding).toBeUndefined();
        expect(bpmnRequestContext.updateBpmnEngineRequestContext).not.toHaveBeenCalled();
      });
    });

    it('preserves verified placement and release metadata in the active database context', async () => {
      await withPooledOnboarding(async () => {
        const routed = { tenantId: 'alpha-id', tenantSlug: 'alpha', placementKey: 'shard-a', placementEpoch: 7,
          placementAssertionVersion: 'v3' as const, placementCorrelationId: 'route-correlation', releaseId: 'release-a', assignmentEpoch: 9 };
        req.tenant = routed;
        next = vi.fn(() => expect(getTenantDatabaseContext()).toBe(routed));
        await requireOnboarding(req as Request, res as Response, next);
        expect(next).toHaveBeenCalledExactlyOnceWith();
        expect(req.tenant).toBe(routed);
        expect(req.onboarding).toMatchObject({ tenantId: 'alpha-id', invitationId: 'invite-1' });
      });
    });

    it.each([{ placementKey: 'old-shard', placementEpoch: 7 }, { placementKey: 'shard-a', placementEpoch: 6 }])('rejects changed placement after route resolution (%j)', async (placement) => {
      await withPooledOnboarding(async () => {
        req.tenant = { tenantId: 'alpha-id', tenantSlug: 'alpha', ...placement };
        await requireOnboarding(req as Request, res as Response, next);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
        expect(req.onboarding).toBeUndefined();
        expect(bpmnRequestContext.updateBpmnEngineRequestContext).not.toHaveBeenCalled();
      });
    });

    it('retains root compatibility by resolving an unrouted pooled onboarding context', async () => {
      await withPooledOnboarding(async () => {
        await requireOnboarding(req as Request, res as Response, next);
        expect(next).toHaveBeenCalledWith();
        expect(req.tenant).toEqual({ tenantId: 'alpha-id', tenantSlug: 'alpha', placementKey: 'shard-a', placementEpoch: 7 });
      });
    });

    it('accepts a compatible legacy onboarding token without principal fields', async () => {
      req.cookies = { onboardingToken: TEST_COOKIE_TOKEN };
      (jwt.verifyToken as any).mockReturnValue({
        userId: 'user-1',
        email: 'user@example.com',
        invitationId: 'invitation-1',
        type: 'onboarding',
      });

      await requireOnboarding(req as Request, res as Response, next);

      expect(req.onboarding).toMatchObject({
        userId: 'user-1',
        principalType: 'user',
        principalId: 'user-1',
      });
      expect(next).toHaveBeenCalledWith();
    });

    it('rejects an onboarding token whose explicit principal does not match its user', async () => {
      req.cookies = { onboardingToken: TEST_COOKIE_TOKEN };
      (jwt.verifyToken as any).mockReturnValue({
        userId: 'user-1',
        email: 'user@example.com',
        invitationId: 'invitation-1',
        principalType: 'user',
        principalId: 'other-user',
        type: 'onboarding',
      });

      await requireOnboarding(req as Request, res as Response, next);

      const error = (next as any).mock.calls[0][0];
      expect(error).toBeInstanceOf(AppError);
      expect(error?.message).toContain('Invalid user principal');
    });

    it('keeps the interfaces compatibility export on the canonical validation path', async () => {
      req.cookies = { onboardingToken: TEST_COOKIE_TOKEN };
      (jwt.verifyToken as any).mockReturnValue({
        userId: 'user-1',
        email: 'user@example.com',
        invitationId: 'invitation-1',
        principalType: 'user',
        principalId: 'other-user',
        type: 'onboarding',
      });

      await requireOnboardingFromInterfaces(req as Request, res as Response, next);

      expect((next as any).mock.calls[0][0]?.message).toContain('Invalid user principal');
    });

    it('rejects a versioned onboarding token after its session is revoked', async () => {
      req.cookies = { onboardingToken: TEST_COOKIE_TOKEN };
      (jwt.verifyToken as any).mockReturnValue({ userId: 'user-1', email: 'user@example.com', invitationId: 'invitation-1', type: 'onboarding', authSessionVersion: 0 });
      (getDataSource as any).mockResolvedValue({ getRepository: () => ({ findOneBy: vi.fn().mockResolvedValue({ id: 'user-1', isActive: true, authSessionVersion: 1 }) }) });

      await requireOnboarding(req as Request, res as Response, next);

      expect((next as any).mock.calls[0][0]?.message).toContain('Session has been revoked');
    });
  });

  describe('optionalAuth', () => {
    it('adds user when token belongs to an active current session', async () => {
      req.headers = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };
      (jwt.verifyToken as any).mockReturnValue({ userId: 'user-1', type: 'access', platformRole: 'user', email: 'user@example.com', authSessionVersion: 2 });
      (getDataSource as any).mockResolvedValue({
        getRepository: () => ({ findOneBy: vi.fn().mockResolvedValue({ id: 'user-1', isActive: true, authSessionVersion: 2 }) }),
      });

      await optionalAuth(req as Request, res as Response, next);

      expect(req.user).toBeDefined();
      expect(bpmnRequestContext.updateBpmnEngineRequestContext).toHaveBeenCalledWith({ userId: 'user-1' });
      expect(next).toHaveBeenCalled();
    });

    it('runs the enterprise tenant resolver before attaching an optional identity', async () => {
      const resolver = vi.fn(async (request: Request) => {
        request.tenantRole = 'member';
      });
      req = {
        ...req,
        headers: { authorization: `Bearer ${TEST_BEARER_TOKEN}` },
        app: { locals: { enterpriseTenantAuthorizationResolver: resolver } } as any,
      };
      const user = { id: 'user-1', isActive: true, authSessionVersion: 2, email: 'user@example.com' };
      const tokenPayload = { principalType: 'user' as const, principalId: 'user-1', type: 'access' as const, authSessionVersion: 2 };
      (jwt.verifyToken as any).mockReturnValue(tokenPayload);
      (getDataSource as any).mockResolvedValue({
        getRepository: () => ({ findOneBy: vi.fn().mockResolvedValue(user) }),
      });

      await optionalAuth(req as Request, res as Response, next);

      expect(resolver).toHaveBeenCalledWith(req, { tokenPayload: { ...tokenPayload, userId: 'user-1' }, user });
      expect(req.user).toMatchObject({ userId: 'user-1', principalType: 'user', principalId: 'user-1' });
      expect(req.tenantRole).toBe('member');
      expect(bpmnRequestContext.updateBpmnEngineRequestContext).toHaveBeenCalledWith({ userId: 'user-1' });
      expect(next).toHaveBeenCalledWith();
    });

    it('continues anonymously when optional tenant resolution fails', async () => {
      req = {
        ...req,
        headers: { authorization: `Bearer ${TEST_BEARER_TOKEN}` },
        app: { locals: { enterpriseTenantAuthorizationResolver: vi.fn().mockRejectedValue(new Error('tenant unavailable')) } } as any,
      };
      (jwt.verifyToken as any).mockReturnValue({ principalType: 'user', principalId: 'user-1', type: 'access', authSessionVersion: 2 });
      (getDataSource as any).mockResolvedValue({
        getRepository: () => ({ findOneBy: vi.fn().mockResolvedValue({ id: 'user-1', isActive: true, authSessionVersion: 2, email: 'user@example.com' }) }),
      });

      await optionalAuth(req as Request, res as Response, next);

      expect(req.user).toBeUndefined();
      expect(bpmnRequestContext.updateBpmnEngineRequestContext).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
    });

    it('continues without user when no token', async () => {
      await optionalAuth(req as Request, res as Response, next);

      expect(req.user).toBeUndefined();
      expect(bpmnRequestContext.updateBpmnEngineRequestContext).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('does not attach a user from a revoked session', async () => {
      req.headers = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };
      (jwt.verifyToken as any).mockReturnValue({ userId: 'user-1', type: 'access', email: 'user@example.com', authSessionVersion: 1 });
      (getDataSource as any).mockResolvedValue({
        getRepository: () => ({ findOneBy: vi.fn().mockResolvedValue({ id: 'user-1', isActive: true, authSessionVersion: 2 }) }),
      });

      await optionalAuth(req as Request, res as Response, next);

      expect(req.user).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });

    it('continues anonymously when an administrator-recovery membership is no longer active', async () => {
      req.headers = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };
      (jwt.verifyToken as any).mockReturnValue({
        userId: 'user-1', type: 'access', authSessionVersion: 2, recovery: 'platform_administrator',
      });
      (getDataSource as any).mockResolvedValue({
        getRepository: (entity: unknown) => {
          if (entity === User) return { findOneBy: vi.fn().mockResolvedValue({ id: 'user-1', isActive: true, authSessionVersion: 2 }) };
          if (entity === AuthzGroupMembership) return { find: vi.fn().mockResolvedValue([]) };
          throw new Error('Unexpected repository');
        },
      });

      await optionalAuth(req as Request, res as Response, next);

      expect(req.user).toBeUndefined();
      expect(bpmnRequestContext.updateBpmnEngineRequestContext).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
    });

    it('ignores malformed tokens without attempting verification', async () => {
      req.headers = { authorization: 'Bearer invalid token with spaces' };

      await optionalAuth(req as Request, res as Response, next);

      expect(jwt.verifyToken).not.toHaveBeenCalled();
      expect(req.user).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });
  });
});
