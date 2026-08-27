import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
const tenantServiceMock = vi.hoisted(() => ({
  getById: vi.fn(),
  getBySlug: vi.fn(),
  getByHostname: vi.fn(),
  verifyPlacementClaim: vi.fn(),
  verifyPlacementClaimV2: vi.fn(),
  listForUser: vi.fn(),
}));
const getActivePlatformAdministratorUserIds = vi.hoisted(() => vi.fn());

vi.mock('@enterpriseglue/shared/services/platform-admin/TenantService.js', () => ({
  tenantService: tenantServiceMock,
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/PlatformAdministratorMembershipService.js', () => ({
  getActivePlatformAdministratorUserIds,
}));

import {
  resolveTenantContext,
  requireTenantRole,
  checkTenantAdmin,
} from '@enterpriseglue/shared/middleware/tenant.js';
import { config } from '@enterpriseglue/shared/config/index.js';

describe('tenant middleware', () => {
  const originalTenancyMode = config.tenancyMode;
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
    getActivePlatformAdministratorUserIds.mockImplementation(async (userIds: string[]) => new Set(userIds.filter((id) => id === 'admin-1')));
    tenantServiceMock.listForUser.mockResolvedValue([{
      tenantId: 't1', tenantSlug: 'default', tenantName: 'Default', tenantStatus: 'active', role: 'admin',
    }]);
    tenantServiceMock.getByHostname.mockResolvedValue(null);
  });

  afterEach(() => {
    (config as any).tenancyMode = originalTenancyMode;
    vi.restoreAllMocks();
  });

  it('resolves tenant context from default when multiTenant disabled', async () => {
    await resolveTenantContext()(req as Request, res as Response, next);

    expect(req.tenant).toEqual({
      tenantId: 'tenant-default', tenantSlug: 'default', placementKey: 'local', placementEpoch: 1,
    });
    expect(next).toHaveBeenCalled();
  });

  it('preserves an enterprise-resolved tenant context', async () => {
    req.tenant = { tenantId: 'tenant-1', tenantSlug: 'acme' };

    await resolveTenantContext()(req as Request, res as Response, next);

    expect(req.tenant).toEqual({ tenantId: 'tenant-1', tenantSlug: 'acme' });
    expect(next).toHaveBeenCalled();
  });

  it('rejects a pooled route that conflicts with an authenticated tenant context', async () => {
    (config as any).tenancyMode = 'pooled';
    req.params = { tenantSlug: 'bravo' };
    req.tenant = { tenantId: 'tenant-alpha', tenantSlug: 'alpha' };

    await resolveTenantContext()(req as Request, res as Response, next);

    expect(req.tenant).toEqual({ tenantId: 'tenant-alpha', tenantSlug: 'alpha' });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(tenantServiceMock.getBySlug).not.toHaveBeenCalled();
  });

  it('rejects a tenant route that conflicts with a verified tenant hostname', async () => {
    (config as any).tenancyMode = 'pooled';
    req.params = { tenantSlug: 'beta' };
    req.hostname = 'acme.example.test';
    tenantServiceMock.getBySlug.mockResolvedValue({ id: 'tenant-beta', slug: 'beta', status: 'active' });
    tenantServiceMock.getByHostname.mockResolvedValue({ id: 'tenant-acme', slug: 'acme', status: 'active' });

    await resolveTenantContext()(req as Request, res as Response, next);

    expect(req.tenant).toBeUndefined();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('resolves a route-bound placement v2 assertion and retains its correlation', async () => {
    (config as any).tenancyMode = 'pooled';
    req.params = { tenantSlug: 'alpha' };
    req.hostname = 'app.enterpriseglue.test';
    req.originalUrl = '/api/t/alpha/projects';
    req.headers['x-eg-tenant-placement-v2'] = 'header.payload.signature';
    tenantServiceMock.verifyPlacementClaimV2.mockReturnValue({
      tenantId: 'tenant-alpha', tenantSlug: 'alpha', shardId: 'shard-a', placementEpoch: 7,
      correlationId: 'correlation-001',
    });
    tenantServiceMock.getById.mockResolvedValue({
      id: 'tenant-alpha', slug: 'alpha', status: 'active', placementKey: 'shard-a', placementEpoch: 7,
    });

    await resolveTenantContext()(req as Request, res as Response, next);

    expect(tenantServiceMock.verifyPlacementClaimV2).toHaveBeenCalledWith(
      'header.payload.signature', 'app.enterpriseglue.test', '/api/t/alpha/projects',
    );
    expect(req.tenant).toMatchObject({
      tenantId: 'tenant-alpha', tenantSlug: 'alpha', placementAssertionVersion: 'v2',
      placementCorrelationId: 'correlation-001',
    });
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects mixed placement v1 and v2 headers before tenant lookup', async () => {
    (config as any).tenancyMode = 'pooled';
    req.headers = {
      'x-eg-tenant-placement': 'payload',
      'x-eg-tenant-placement-signature': 'signature',
      'x-eg-tenant-placement-v2': 'header.payload.signature',
    };

    await resolveTenantContext()(req as Request, res as Response, next);

    expect(tenantServiceMock.getById).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
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
    tenantServiceMock.listForUser.mockResolvedValue([{
      tenantId: 't1', tenantSlug: 'default', tenantName: 'Default', tenantStatus: 'active', role: 'member',
    }]);

    await expect(checkTenantAdmin(req as Request, 't1')).resolves.toBe(false);
  });
});
