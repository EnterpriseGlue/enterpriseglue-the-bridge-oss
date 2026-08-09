import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { PermissionGrant } from '@enterpriseglue/shared/db/entities/PermissionGrant.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';

class PermissionGrantServiceImpl {
  async setProjectDeployAllowed(projectId: string, userId: string, allowed: boolean, grantedById: string): Promise<void> {
    const dataSource = await getDataSource();
    const grantRepo = dataSource.getRepository(PermissionGrant);
    const project = await dataSource.getRepository(Project).findOne({
      where: { id: projectId },
      select: ['id', 'tenantId'],
    });
    if (!project?.tenantId) throw Errors.notFound('Project', projectId);
    const now = Date.now();

    if (allowed) {
      await grantRepo.createQueryBuilder()
        .insert()
        .values({
          id: generateId(),
          tenantId: project.tenantId,
          userId,
          permission: 'project:deploy',
          resourceType: 'project',
          resourceId: projectId,
          grantedById,
          createdAt: now,
        })
        .orIgnore()
        .execute();
      return;
    }

    await grantRepo.createQueryBuilder()
      .delete()
      .where('userId = :userId', { userId })
      .andWhere('permission IN (:...perms)', { perms: ['project:deploy', 'project.deploy'] })
      .andWhere('resourceType = :resourceType', { resourceType: 'project' })
      .andWhere('resourceId = :resourceId', { resourceId: projectId })
      .andWhere('tenantId = :tenantId', { tenantId: project.tenantId })
      .execute();
  }

  async listProjectDeployGrantedUserIds(projectId: string, userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) {
      return [];
    }

    const dataSource = await getDataSource();
    const grantRepo = dataSource.getRepository(PermissionGrant);
    const project = await dataSource.getRepository(Project).findOne({
      where: { id: projectId },
      select: ['id', 'tenantId'],
    });
    if (!project?.tenantId) throw Errors.notFound('Project', projectId);
    const rows = await grantRepo.createQueryBuilder('pg')
      .select(['pg.userId'])
      .where('pg.userId IN (:...userIds)', { userIds })
      .andWhere('pg.permission IN (:...perms)', { perms: ['project:deploy', 'project.deploy'] })
      .andWhere('pg.resourceType = :resourceType', { resourceType: 'project' })
      .andWhere('pg.resourceId = :resourceId', { resourceId: projectId })
      .andWhere('pg.tenantId = :tenantId', { tenantId: project.tenantId })
      .getMany();

    return rows.map((row) => String(row.userId));
  }
}

export const permissionGrantService = new PermissionGrantServiceImpl();
