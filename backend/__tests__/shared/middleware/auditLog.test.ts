import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { auditRequest } from '@enterpriseglue/shared/middleware/auditLog.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: vi.fn(),
}));

describe('audit middleware tenancy', () => {
  it('records global routes as global regardless of a legacy platform role claim', async () => {
    const req = {
      method: 'POST',
      path: '/api/platform/example',
      originalUrl: '/api/platform/example',
      headers: {},
      params: {},
      body: {},
      socket: {},
      user: { userId: 'user-1', platformRole: 'user' },
    } as unknown as Request;
    const next = vi.fn() as NextFunction;
    (logAudit as any).mockResolvedValue(undefined);

    await auditRequest('platform.example')(req, {} as Response, next);

    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ tenantId: undefined, userId: 'user-1' }));
    expect(next).toHaveBeenCalledOnce();
  });

  it('keeps tenant-scoped requests attached to their resolved tenant', async () => {
    const req = {
      method: 'POST',
      path: '/api/t/acme/projects',
      originalUrl: '/api/t/acme/projects',
      headers: {},
      params: {},
      body: {},
      socket: {},
      tenant: { tenantId: 'tenant-acme' },
      user: { userId: 'user-1', platformRole: 'admin' },
    } as unknown as Request;
    const next = vi.fn() as NextFunction;
    (logAudit as any).mockResolvedValue(undefined);

    await auditRequest('project.create')(req, {} as Response, next);

    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-acme', userId: 'user-1' }));
    expect(next).toHaveBeenCalledOnce();
  });
});
