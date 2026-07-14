import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireAuth, requireAdmin, optionalAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { AppError } from '@enterpriseglue/shared/middleware/errorHandler.js';
import * as jwt from '@enterpriseglue/shared/utils/jwt.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { permissionService, PlatformPermissions } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { Request, Response, NextFunction } from 'express';

vi.mock('@enterpriseglue/shared/utils/jwt.js', () => ({
  verifyToken: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  permissionService: {
    hasPermission: vi.fn(),
  },
  PlatformPermissions: {
    AUTHZ_ROLES_MANAGE: 'platform:authz:roles:manage',
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

  describe('requireAuth', () => {
    it('accepts valid bearer token', async () => {
      req.headers = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };
      (jwt.verifyToken as any).mockReturnValue({ userId: 'user-1', type: 'access', platformRole: 'user', email: 'user@example.com' });
      (getDataSource as any).mockResolvedValue({
        getRepository: (entity: unknown) => {
          if (entity === User) return { findOneBy: vi.fn().mockResolvedValue({ isActive: true, isEmailVerified: true }) };
          throw new Error('Unexpected repository');
        },
      });

      await requireAuth(req as Request, res as Response, next);

      expect(req.user).toEqual({ userId: 'user-1', type: 'access', platformRole: 'user', email: 'user@example.com', principalType: 'user', principalId: 'user-1' });
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

    it('rejects an access token after its user session version advances', async () => {
      req.headers = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };
      (jwt.verifyToken as any).mockReturnValue({ userId: 'user-1', type: 'access', email: 'user@example.com', authSessionVersion: 0 });
      (getDataSource as any).mockResolvedValue({
        getRepository: () => ({ findOneBy: vi.fn().mockResolvedValue({ isActive: true, isEmailVerified: true, email: 'user@example.com', authSessionVersion: 1 }) }),
      });

      await requireAuth(req as Request, res as Response, next);

      expect((req as any).user?.authSessionVersion).toBe(0);
      expect((next as any).mock.calls[0][0]?.message).toContain('Session has been revoked');
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
      req.user = { userId: 'admin-1', type: 'access', platformRole: 'user', email: 'admin@example.com' };
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
      req.user = { userId: 'user-1', type: 'access', platformRole: 'admin', email: 'user@example.com' };

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

  describe('optionalAuth', () => {
    it('adds user when token present', () => {
      req.headers = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };
      (jwt.verifyToken as any).mockReturnValue({ userId: 'user-1', type: 'access', platformRole: 'user', email: 'user@example.com' });

      optionalAuth(req as Request, res as Response, next);

      expect(req.user).toBeDefined();
      expect(next).toHaveBeenCalled();
    });

    it('continues without user when no token', () => {
      optionalAuth(req as Request, res as Response, next);

      expect(req.user).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });

    it('ignores malformed tokens without attempting verification', () => {
      req.headers = { authorization: 'Bearer invalid token with spaces' };

      optionalAuth(req as Request, res as Response, next);

      expect(jwt.verifyToken).not.toHaveBeenCalled();
      expect(req.user).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });
  });
});
