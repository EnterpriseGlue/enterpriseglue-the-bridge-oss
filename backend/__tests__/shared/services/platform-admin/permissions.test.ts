import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { permissionService, PlatformPermissions } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { PermissionGrant } from '@enterpriseglue/shared/db/entities/PermissionGrant.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('permissionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('grants admin role all permissions', async () => {
    const result = await permissionService.hasPermission(PlatformPermissions.USER_VIEW, {
      userId: 'user-1',
      platformRole: 'admin',
    });
    expect(result).toBe(true);
  });

  it('checks explicit grants when roles do not match', async () => {
    const qb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue({ id: 'grant-1' }),
    };
    const repo = {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PermissionGrant) return repo;
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.hasPermission(PlatformPermissions.USER_VIEW, {
      userId: 'user-1',
      platformRole: 'user',
    });

    expect(result).toBe(true);
    expect(repo.createQueryBuilder).toHaveBeenCalledWith('g');
  });

  it('grants and revokes permissions', async () => {
    const insert = vi.fn();
    const execute = vi.fn();
    const deleteBuilder = {
      delete: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      execute,
    };

    const repo = {
      insert,
      createQueryBuilder: vi.fn().mockReturnValue(deleteBuilder),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PermissionGrant) return repo;
        throw new Error('Unexpected repository');
      },
    });

    const grant = await permissionService.grantPermission({
      userId: 'user-1',
      permission: PlatformPermissions.USER_VIEW,
      grantedById: 'admin-1',
    });

    expect(grant.id).toBeTruthy();
    expect(insert).toHaveBeenCalled();

    const revoked = await permissionService.revokePermission('user-1', PlatformPermissions.USER_VIEW);
    expect(revoked).toBe(true);
    expect(execute).toHaveBeenCalled();
  });
});
