import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireAuth, requireAdmin, optionalAuth } from '../../../src/shared/middleware/auth.js';
import * as jwt from '../../../src/shared/utils/jwt.js';
import { getDataSource } from '../../../src/shared/db/data-source.js';
import { User } from '../../../src/shared/db/entities/User.js';
import { Request, Response, NextFunction } from 'express';

vi.mock('@shared/utils/jwt.js', () => ({
  verifyToken: vi.fn(),
}));

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

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
      req.headers = { authorization: 'Bearer valid-token' };
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
      req.cookies = { accessToken: 'cookie-token' };
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

    it('throws on missing token', async () => {
      await expect(requireAuth(req as Request, res as Response, next)).rejects.toThrow('No token provided');
    });

    it('throws on invalid token type', async () => {
      req.headers = { authorization: 'Bearer refresh-token' };
      (jwt.verifyToken as any).mockReturnValue({ userId: 'user-1', type: 'refresh', email: 'user@example.com' });

      await expect(requireAuth(req as Request, res as Response, next)).rejects.toThrow('Invalid token type');
    });

    it('blocks unverified users from protected paths', async () => {
      req = { ...req, path: '/api/users', headers: { authorization: 'Bearer valid-token' } };
      (jwt.verifyToken as any).mockReturnValue({ userId: 'user-1', type: 'access', platformRole: 'user', email: 'user@example.com' });
      (getDataSource as any).mockResolvedValue({
        getRepository: (entity: unknown) => {
          if (entity === User) return { findOneBy: vi.fn().mockResolvedValue({ isActive: true, isEmailVerified: false }) };
          throw new Error('Unexpected repository');
        },
      });

      await expect(requireAuth(req as Request, res as Response, next)).rejects.toThrow('Email verification required');
    });
  });

  describe('requireAdmin', () => {
    it('allows admin users', () => {
      req.user = { userId: 'admin-1', type: 'access', platformRole: 'admin', email: 'admin@example.com' };

      requireAdmin(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
    });

    it('throws for non-admin users', () => {
      req.user = { userId: 'user-1', type: 'access', platformRole: 'user', email: 'user@example.com' };

      expect(() => requireAdmin(req as Request, res as Response, next)).toThrow('Admin access required');
    });

    it('throws when no user', () => {
      expect(() => requireAdmin(req as Request, res as Response, next)).toThrow('Authentication required');
    });
  });

  describe('optionalAuth', () => {
    it('adds user when token present', () => {
      req.headers = { authorization: 'Bearer valid-token' };
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
