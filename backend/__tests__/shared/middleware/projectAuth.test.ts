import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { requireFileAccess, requireProjectAccess, requireProjectRole } from '@enterpriseglue/shared/middleware/projectAuth.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  permissionService: {
    hasPermission: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/index.js', () => ({
  engineService: {},
}));

describe('projectAuth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (permissionService.hasPermission as Mock).mockResolvedValue(false);
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({
        findOne: vi.fn().mockResolvedValue({ projectId: 'project-1' }),
      }),
    });
  });

  function request(overrides: Record<string, unknown> = {}) {
    return {
      user: { userId: 'user-1', platformRole: 'user' },
      params: { projectId: 'project-1' },
      body: {},
      query: {},
      ...overrides,
    } as any;
  }

  it('denies role-only project middleware without an explicit permission', async () => {
    const next = vi.fn();

    await requireProjectRole(['owner'] as any)(request(), {} as any, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
    }));
    expect(permissionService.hasPermission).not.toHaveBeenCalled();
  });

  it('allows project role middleware through scoped project permissions', async () => {
    (permissionService.hasPermission as Mock).mockResolvedValue(true);
    const next = vi.fn();

    await requireProjectRole(['owner'] as any, { permission: 'project:settings:manage' as any })(request(), {} as any, next);

    expect(next).toHaveBeenCalledWith();
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'project:settings:manage',
      expect.objectContaining({
        userId: 'user-1',
        platformRole: 'user',
        resourceType: 'project',
        resourceId: 'project-1',
      })
    );
  });

  it('allows project access middleware through scoped project permissions', async () => {
    (permissionService.hasPermission as Mock).mockResolvedValue(true);
    const next = vi.fn();

    await requireProjectAccess({ permission: 'project:files:view' as any })(request(), {} as any, next);

    expect(next).toHaveBeenCalledWith();
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'project:files:view',
      expect.objectContaining({
        userId: 'user-1',
        resourceType: 'project',
        resourceId: 'project-1',
      })
    );
  });

  it('allows file access middleware through scoped project permissions', async () => {
    (permissionService.hasPermission as Mock).mockResolvedValue(true);
    const next = vi.fn();

    await requireFileAccess({ permission: 'project:files:view' as any })(request({
      params: { fileId: '11111111-1111-1111-8111-111111111111' },
    }), {} as any, next);

    expect(next).toHaveBeenCalledWith();
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'project:files:view',
      expect.objectContaining({
        userId: 'user-1',
        resourceType: 'project',
        resourceId: 'project-1',
      })
    );
  });

  it('passes an authorization error when scoped permission does not match', async () => {
    const next = vi.fn();

    await requireProjectRole(['owner'] as any, { permission: 'project:delete' as any })(request(), {} as any, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
    }));
  });
});
