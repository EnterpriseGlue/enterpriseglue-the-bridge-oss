import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { PermissionGrant } from '@enterpriseglue/shared/db/entities/PermissionGrant.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { permissionGrantService } from '@enterpriseglue/shared/services/platform-admin/PermissionGrantService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('PermissionGrantService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts a project deploy grant when allowed is true', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const insertBuilder = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      orIgnore: vi.fn().mockReturnThis(),
      execute,
    };
    const grantRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(insertBuilder),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PermissionGrant) return grantRepo;
        if (entity === Project) return { findOne: vi.fn().mockResolvedValue({ id: 'project-1', tenantId: 'tenant-a' }) };
        throw new Error('Unexpected repository');
      },
    });

    await permissionGrantService.setProjectDeployAllowed('project-1', 'user-1', true, 'admin-1');

    expect(grantRepo.createQueryBuilder).toHaveBeenCalled();
    expect(insertBuilder.values).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.any(String),
      tenantId: 'tenant-a',
      userId: 'user-1',
      permission: 'project:deploy',
      resourceType: 'project',
      resourceId: 'project-1',
      grantedById: 'admin-1',
      createdAt: expect.any(Number),
    }));
    expect(insertBuilder.orIgnore).toHaveBeenCalled();
    expect(execute).toHaveBeenCalled();
  });

  it('deletes matching deploy grants when allowed is false', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const deleteBuilder = {
      delete: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      execute,
    };
    const grantRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(deleteBuilder),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PermissionGrant) return grantRepo;
        if (entity === Project) return { findOne: vi.fn().mockResolvedValue({ id: 'project-1', tenantId: 'tenant-a' }) };
        throw new Error('Unexpected repository');
      },
    });

    await permissionGrantService.setProjectDeployAllowed('project-1', 'user-1', false, 'admin-1');

    expect(deleteBuilder.delete).toHaveBeenCalled();
    expect(deleteBuilder.where).toHaveBeenCalledWith('userId = :userId', { userId: 'user-1' });
    expect(deleteBuilder.andWhere).toHaveBeenCalledWith('permission IN (:...perms)', { perms: ['project:deploy', 'project.deploy'] });
    expect(deleteBuilder.andWhere).toHaveBeenCalledWith('resourceType = :resourceType', { resourceType: 'project' });
    expect(deleteBuilder.andWhere).toHaveBeenCalledWith('resourceId = :resourceId', { resourceId: 'project-1' });
    expect(deleteBuilder.andWhere).toHaveBeenCalledWith('tenantId = :tenantId', { tenantId: 'tenant-a' });
    expect(execute).toHaveBeenCalled();
  });

  it('returns early when listing deploy grants for an empty user list', async () => {
    const result = await permissionGrantService.listProjectDeployGrantedUserIds('project-1', []);

    expect(result).toEqual([]);
    expect(getDataSource).not.toHaveBeenCalled();
  });

  it('lists deploy-granted user ids for a project', async () => {
    const selectBuilder = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([{ userId: 'user-1' }, { userId: 2 }]),
    };
    const grantRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(selectBuilder),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PermissionGrant) return grantRepo;
        if (entity === Project) return { findOne: vi.fn().mockResolvedValue({ id: 'project-1', tenantId: 'tenant-a' }) };
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionGrantService.listProjectDeployGrantedUserIds('project-1', ['user-1', '2']);

    expect(grantRepo.createQueryBuilder).toHaveBeenCalledWith('pg');
    expect(selectBuilder.where).toHaveBeenCalledWith('pg.userId IN (:...userIds)', { userIds: ['user-1', '2'] });
    expect(selectBuilder.andWhere).toHaveBeenCalledWith('pg.tenantId = :tenantId', { tenantId: 'tenant-a' });
    expect(result).toEqual(['user-1', '2']);
  });
});
