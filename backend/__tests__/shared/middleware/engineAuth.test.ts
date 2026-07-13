import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { requireEngineAccess, requireEngineDeployer } from '@enterpriseglue/shared/middleware/engineAuth.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { engineService } from '@enterpriseglue/shared/services/platform-admin/index.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/index.js', () => ({
  engineService: {
    getEngineRole: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  permissionService: {
    hasPermission: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock('@enterpriseglue/shared/services/bpmn-engine-request-context.js', () => ({
  updateBpmnEngineRequestContext: vi.fn(),
}));

describe('engineAuth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (engineService.getEngineRole as Mock).mockResolvedValue(null);
    (permissionService.hasPermission as Mock).mockResolvedValue(false);
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({
        findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: null }),
      }),
    });
  });

  function request(overrides: Record<string, unknown> = {}) {
    return {
      user: { userId: 'user-1', platformRole: 'user' },
      params: { engineId: 'engine-1' },
      body: {},
      query: {},
      method: 'GET',
      path: '/mission-control-api/process-instances',
      ...overrides,
    } as any;
  }

  it('denies engine access through a legacy engine role without scoped permission', async () => {
    (engineService.getEngineRole as Mock).mockResolvedValue('operator');
    const next = vi.fn();

    await requireEngineAccess({ engineIdFrom: 'params' })(request(), {} as any, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
    }));
    expect(permissionService.hasPermission).not.toHaveBeenCalled();
  });

  it('allows engine access through a scoped engine permission when no legacy role matches', async () => {
    (permissionService.hasPermission as Mock).mockImplementation(async (permission: string) =>
      permission === 'engine:instance:view'
    );
    const next = vi.fn();

    await requireEngineAccess({ engineIdFrom: 'params', permission: 'engine:instance:view' as any })(
      request(),
      {} as any,
      next
    );

    expect(next).toHaveBeenCalledWith();
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
  });

  it('allows engine mutation middleware through a route-specific scoped engine permission', async () => {
    (permissionService.hasPermission as Mock).mockImplementation(async (permission: string) =>
      permission === 'engine:variables:edit'
    );
    const next = vi.fn();

    await requireEngineDeployer({ engineIdFrom: 'body', permission: 'engine:variables:edit' as any })(
      request({
        body: { engineId: 'engine-1' },
        method: 'POST',
        path: '/mission-control-api/process-instances/pi-1/variables',
      }),
      {} as any,
      next
    );

    expect(next).toHaveBeenCalledWith();
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:variables:edit', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
  });

  it('passes an authorization error when scoped permission does not match', async () => {
    const next = vi.fn();

    await requireEngineAccess({ engineIdFrom: 'params', permission: 'engine:instance:view' as any })(
      request(),
      {} as any,
      next
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
    }));
  });
});
