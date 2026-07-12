import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  resolveTenantContext,
  requireTenantRole,
  checkTenantAdmin,
} from '@enterpriseglue/shared/middleware/tenant.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';

describe('tenant middleware', () => {
  let req: any;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = {
      params: {},
      headers: {},
      originalUrl: '/api/test',
      user: { userId: 'user-1', platformRole: 'user' },
    };
    res = {};
    next = vi.fn();
    vi.clearAllMocks();
  });

  it('resolves tenant context from default when multiTenant disabled', async () => {
    await resolveTenantContext()(req as Request, res as Response, next);

    expect(req.tenant).toEqual({ tenantId: 'tenant-default', tenantSlug: 'default' });
    expect(next).toHaveBeenCalled();
  });

  it('preserves an enterprise-resolved tenant context', async () => {
    req.tenant = { tenantId: 'tenant-1', tenantSlug: 'acme' };

    await resolveTenantContext()(req as Request, res as Response, next);

    expect(req.tenant).toEqual({ tenantId: 'tenant-1', tenantSlug: 'acme' });
    expect(next).toHaveBeenCalled();
  });

  it('requires tenant role for members', async () => {
    req.tenant = { tenantId: 't1', tenantSlug: 'default' };

    const middleware = requireTenantRole('tenant_admin');
    await middleware(req as Request, res as Response, next);

    expect(req.tenantRole).toBe('tenant_admin');
    expect(next).toHaveBeenCalled();
  });

  it('allows platform admin without tenant membership', async () => {
    req.user = { userId: 'admin-1', platformRole: 'admin' };

    const middleware = requireTenantRole('tenant_admin');
    await middleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
  });

  it('checkTenantAdmin allows platform admin', async () => {
    req.user = { userId: 'admin-1', platformRole: 'admin' };

    const result = await checkTenantAdmin(req as Request, 't1');
    expect(result).toBe(true);
  });

  it('checkTenantAdmin rejects non-admin members', async () => {
    req.user = { userId: 'user-1', platformRole: 'user' };

    await expect(checkTenantAdmin(req as Request, 't1')).resolves.toBe(true);
  });
});
