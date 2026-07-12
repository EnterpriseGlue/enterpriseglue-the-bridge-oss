/**
 * ProjectCreationService
 * Encapsulates the common pattern of creating a project with owner membership.
 * Used by clone, createOnline, and other routes that create projects.
 */

import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { ProjectMember } from '@enterpriseglue/shared/db/entities/ProjectMember.js';
import { ProjectMemberRole } from '@enterpriseglue/shared/db/entities/ProjectMemberRole.js';
import { generateId, unixTimestamp } from '@enterpriseglue/shared/utils/id.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';

export interface CreateProjectInput {
  name: string;
  ownerId: string;
}

export interface CreateProjectResult {
  projectId: string;
}

class ProjectCreationServiceImpl {
  /**
   * Create a project and add the owner as a member with owner role.
   */
  async createWithOwner(input: CreateProjectInput): Promise<CreateProjectResult> {
    const dataSource = await getDataSource();
    const projectRepo = dataSource.getRepository(Project);
    const projectMemberRepo = dataSource.getRepository(ProjectMember);
    const projectMemberRoleRepo = dataSource.getRepository(ProjectMemberRole);

    const projectId = generateId();
    const now = unixTimestamp();
    const nowMs = Date.now();

    await projectRepo.insert({
      id: projectId,
      name: input.name,
      ownerId: input.ownerId,
      createdAt: now,
      updatedAt: now,
    });

    await projectMemberRepo.createQueryBuilder()
      .insert()
      .values({
        id: generateId(),
        projectId,
        userId: input.ownerId,
        role: 'owner',
        invitedById: null,
        joinedAt: nowMs,
        createdAt: nowMs,
        updatedAt: nowMs,
      })
      .orIgnore()
      .execute();

    await projectMemberRoleRepo.createQueryBuilder()
      .insert()
      .values({
        projectId,
        userId: input.ownerId,
        role: 'owner',
        createdAt: nowMs,
      })
      .orIgnore()
      .execute();

    await permissionService.syncLegacyRoleAssignments({ projectIds: [projectId] })
      .catch((error) => logger.warn('Failed to sync legacy project role assignments', { projectId, error }));

    return { projectId };
  }
}

export const projectCreationService = new ProjectCreationServiceImpl();
