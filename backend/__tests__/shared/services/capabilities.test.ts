import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildUserCapabilities } from '@enterpriseglue/shared/services/capabilities.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { engineService } from '@enterpriseglue/shared/services/platform-admin/EngineService.js';

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  PlatformPermissions: {
    USER_MANAGE: 'platform:user:manage',
    AUDIT_VIEW: 'platform:audit:view',
    SETTINGS_MANAGE: 'platform:settings:manage',
  },
  ProjectPermissions: {
    PROJECT_SETTINGS: 'project:settings:manage',
    MEMBERS_MANAGE: 'project:members:manage',
  },
  EnginePermissions: {
    ENGINE_EDIT: 'engine:edit',
    MEMBERS_MANAGE: 'engine:members:manage',
  },
  permissionService: {
    hasPermission: vi.fn(),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/EngineService.js', () => ({
  engineService: {
    getUserEngines: vi.fn(),
  },
}));

describe('buildUserCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (permissionService.hasPermission as any).mockResolvedValue(false);
    (engineService.getUserEngines as any).mockResolvedValue([]);
  });

  it('derives Mission Control visibility from canonical engine discovery', async () => {
    (engineService.getUserEngines as any).mockResolvedValue([{ engine: { id: 'engine-1' } }]);

    const capabilities = await buildUserCapabilities({ userId: 'user-1', platformRole: 'admin' });

    expect(capabilities.canViewMissionControl).toBe(true);
    expect(engineService.getUserEngines).toHaveBeenCalledWith('user-1');
  });

  it('does not pass the legacy platform role into permission evaluation', async () => {
    await buildUserCapabilities({ userId: 'user-1', platformRole: 'admin' });

    expect(permissionService.hasPermission).toHaveBeenCalledTimes(7);
    for (const [, context] of (permissionService.hasPermission as any).mock.calls) {
      expect(context).toEqual({ userId: 'user-1' });
    }
  });
});
