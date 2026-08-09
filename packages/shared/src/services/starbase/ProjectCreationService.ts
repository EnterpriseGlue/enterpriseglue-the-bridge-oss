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
import { writeProjectMemberRoleAssignments } from '@enterpriseglue/shared/services/platform-admin/project-member-role-assignments.js';
import { OSS_DEFAULT_TENANT_ID, normalizeTenantIdForPersistence } from '@enterpriseglue/shared/authz/tenant-scope.js';

export interface CreateProjectInput {
  name: string;
  ownerId: string;
  /** Resolved tenant context. Callers must never use omission as a cross-tenant scope. */
  tenantId: string;
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
    const projectId = generateId();
    const now = unixTimestamp();
    const nowMs = Date.now();
    const tenantId = normalizeTenantIdForPersistence(input.tenantId) || OSS_DEFAULT_TENANT_ID;

    await dataSource.transaction(async (manager) => {
      await manager.getRepository(Project).insert({
        id: projectId,
        name: input.name,
        ownerId: input.ownerId,
        tenantId,
        createdAt: now,
        updatedAt: now,
      });

      await manager.getRepository(ProjectMember).createQueryBuilder()
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

      await manager.getRepository(ProjectMemberRole).createQueryBuilder()
        .insert()
        .values({
          projectId,
          userId: input.ownerId,
          role: 'owner',
          createdAt: nowMs,
        })
        .orIgnore()
        .execute();

      await writeProjectMemberRoleAssignments(manager, {
        projectId,
        tenantId,
        userId: input.ownerId,
        roles: ['owner'],
        createdById: null,
        createdAt: nowMs,
      });
    });

    return { projectId };
  }
}

export const projectCreationService = new ProjectCreationServiceImpl();
