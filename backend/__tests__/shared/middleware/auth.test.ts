import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireAuth, requireAdmin, optionalAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { AppError } from '@enterpriseglue/shared/middleware/errorHandler.js';
import * as jwt from '@enterpriseglue/shared/utils/jwt.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { Request, Response, NextFunction } from 'express';

vi.mock('@enterpriseglue/shared/utils/jwt.js', () => ({
  verifyToken: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

// Test fixture tokens — not real secrets (CWE-547)
const TEST_BEARER_TOKEN = `test-bearer-${Date.now()}`;
const TEST_COOKIE_TOKEN = `test-cookie-${Date.now()}`;

describe('auth middleware', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = { headers: {}, cookies: {}, path: '' };
    res = {};
    next = vi.fn();
    vi.clearAllMocks();
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

      expect(req.user).toEqual({ userId: 'user-1', type: 'access', platformRole: 'user', email: 'user@example.com' });
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

    it('reports missing token', async () => {
      await requireAuth(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      const error = (next as any).mock.calls[0][0];
      expect(error).toBeInstanceOf(AppError);
      expect(error?.message).toContain('No token provided');
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
    it('allows admin users', () => {
      req.user = { userId: 'admin-1', type: 'access', platformRole: 'admin', email: 'admin@example.com' };

      requireAdmin(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
    });

    it('reports non-admin users', () => {
      req.user = { userId: 'user-1', type: 'access', platformRole: 'user', email: 'user@example.com' };

      requireAdmin(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      const error = (next as any).mock.calls[0][0];
      expect(error).toBeInstanceOf(AppError);
      expect(error?.message).toContain('Admin access required');
    });

    it('reports when no user', () => {
      requireAdmin(req as Request, res as Response, next);

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
  });
});
