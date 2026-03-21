import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  requirePlatformAdmin,
  requirePlatformRole,
  checkPlatformAdmin,
  isPlatformAdmin,
} from '@enterpriseglue/shared/middleware/platformAuth.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', platformRole: 'admin' };
    next();
  },
}));

describe('platformAuth middleware', () => {
  let req: any;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
    res = {};
    next = vi.fn();
    vi.clearAllMocks();
  });

  it('enforces platform admin role', () => {
    req.user = { userId: 'user-1', platformRole: 'admin' };
    requirePlatformAdmin(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('runs requireAuth when user missing', () => {
    req.user = undefined;
    requirePlatformAdmin(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects non-admin users', () => {
    req.user = { userId: 'user-1', platformRole: 'user' };
    expect(() => requirePlatformAdmin(req as Request, res as Response, next)).toThrow(
      Errors.adminRequired()
    );
  });

  it('allows specific platform roles', () => {
    req.user = { userId: 'user-1', platformRole: 'user' };
    const middleware = requirePlatformRole('admin', 'user');
    middleware(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('sets isPlatformAdmin flag', () => {
    req.user = { userId: 'user-1', platformRole: 'admin' };
    checkPlatformAdmin(req as Request, res as Response, next);
    expect((req as any).isPlatformAdmin).toBe(true);
  });

  it('detects platform admin via helper', () => {
    req.user = { userId: 'user-1', platformRole: 'admin' };
    expect(isPlatformAdmin(req as Request)).toBe(true);
  });
});
