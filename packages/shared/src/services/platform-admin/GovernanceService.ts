import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { Engine } from '@enterpriseglue/shared/db/entities/Engine.js';
import { addCaseInsensitiveLike } from '@enterpriseglue/shared/db/adapters/index.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { permissionService } from './permissions.js';

class GovernanceServiceImpl {
  async searchUsers(query: string, limit = 10) {
    if (!query || query.length < 2) return [];

    const dataSource = await getDataSource();
    const userRepo = dataSource.getRepository(User);
    let qb = userRepo.createQueryBuilder('u')
      .select(['u.id', 'u.email', 'u.firstName', 'u.lastName', 'u.platformRole'])
      .take(limit)
      .orderBy('u.email', 'ASC');
    qb = addCaseInsensitiveLike(qb, 'u', 'email', 'query', `%${query}%`);

    return qb.getMany();
  }

  async listProjects(search?: string) {
    const dataSource = await getDataSource();
    const projectRepo = dataSource.getRepository(Project);

    let qb = projectRepo.createQueryBuilder('p')
      .orderBy('p.name', 'ASC');
    if (search) {
      qb = addCaseInsensitiveLike(qb, 'p', 'name', 'search', `%${search}%`)
        .take(50);
    }

    const projectList = await qb.getMany();

    return projectList.map((p) => ({
      id: p.id,
      name: p.name,
      ownerEmail: null,
      ownerName: null,
      delegateEmail: null,
      delegateName: null,
      createdAt: Number(p.createdAt),
    }));
  }

  async listEngines(search?: string) {
    const dataSource = await getDataSource();
    const engineRepo = dataSource.getRepository(Engine);

    let qb = engineRepo.createQueryBuilder('e')
      .orderBy('e.name', 'ASC');
    if (search) {
      qb = addCaseInsensitiveLike(qb, 'e', 'name', 'search', `%${search}%`)
        .take(50);
    }

    const engineList = await qb.getMany();

    return engineList.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      ownerEmail: null,
      ownerName: null,
      delegateEmail: null,
      delegateName: null,
      createdAt: Number(e.createdAt),
    }));
  }

  async assignEngineDelegate(engineId: string, userId: string | null): Promise<{ previousDelegateId: string | null; engineName: string }> {
    const dataSource = await getDataSource();
    const engineRepo = dataSource.getRepository(Engine);
    const userRepo = dataSource.getRepository(User);

    const engine = await engineRepo.findOne({
      where: { id: engineId },
      select: ['id', 'name', 'delegateId'],
    });

    if (!engine) {
      throw Errors.notFound('Engine');
    }

    const previousDelegateId = engine.delegateId;

    if (userId) {
      const targetUser = await userRepo.findOneBy({ id: userId });
      if (!targetUser) {
        throw Errors.notFound('Target user');
      }
    }

    const now = Date.now();
    await engineRepo.update({ id: engineId }, {
      delegateId: userId || null,
      updatedAt: now,
    });
    await permissionService.syncLegacyRoleAssignments({ engineIds: [engineId] })
      .catch((error) => logger.warn('Failed to sync legacy engine role assignments', { engineId, error }));

    return {
      previousDelegateId: previousDelegateId || null,
      engineName: engine.name,
    };
  }
}

export const governanceService = new GovernanceServiceImpl();
