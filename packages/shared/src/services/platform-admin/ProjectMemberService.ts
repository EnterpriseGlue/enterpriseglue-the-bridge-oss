/**
 * Project Member Service
 * Handles project collaboration - inviting members, managing roles
 * 
 * Note: Project members and user data are stored in the main database.
 */

import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ProjectMember } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectMember.js';
import { ProjectMemberRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectMemberRole.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { In } from 'typeorm';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { SYSTEM_ROLE_IDS } from './permissions.js';
import {
  removeLegacyProjectMemberRoleAssignments,
} from './legacy-project-role-assignments.js';
import {
  removeProjectMemberRoleAssignments,
  writeProjectMemberRoleAssignments,
} from './project-member-role-assignments.js';

type ProjectRole = 'owner' | 'delegate' | 'developer' | 'editor' | 'viewer';

const PROJECT_ROLE_ORDER: ProjectRole[] = ['owner', 'delegate', 'developer', 'editor', 'viewer'];

function normalizeRoles(input: ProjectRole[]): ProjectRole[] {
  const uniq = Array.from(new Set(input));
  if (uniq.includes('owner')) return ['owner'];
  return uniq;
}

function computeEffectiveRole(roles: ProjectRole[]): ProjectRole {
  const normalized = normalizeRoles(roles);
  for (const r of PROJECT_ROLE_ORDER) {
    if (normalized.includes(r)) return r;
  }
  return 'viewer';
}

export interface ProjectMemberWithUser {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  roles: ProjectRole[];
  joinedAt: number;
  invitedById: string | null;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
}

export class ProjectMemberService {
  /**
   * Get all members of a project with user details
   */
  async getMembers(projectId: string): Promise<ProjectMemberWithUser[]> {
    const dataSource = await getDataSource();
    const memberRepo = dataSource.getRepository(ProjectMember);
    const userRepo = dataSource.getRepository(User);
    const roleRepo = dataSource.getRepository(ProjectMemberRole);

    // Get project members
    const members = await memberRepo.find({ where: { projectId } });

    if (members.length === 0) {
      return [];
    }

    // Get user details
    const userIds = members.map((m) => m.userId);
    const userList = await userRepo.find({
      where: { id: In(userIds) },
      select: ['id', 'email', 'firstName', 'lastName']
    });

    // Create user lookup map
    const userMap = new Map(userList.map(u => [u.id, u]));

    const roleRows = await roleRepo.find({ where: { projectId } });
    const roleMap = new Map<string, ProjectRole[]>();
    for (const rr of roleRows) {
      const uid = String(rr.userId);
      const role = rr.role as ProjectRole;
      const arr = roleMap.get(uid) || [];
      arr.push(role);
      roleMap.set(uid, arr);
    }

    // Combine members with user details
    return members.map((member) => ({
      id: member.id,
      projectId: member.projectId,
      userId: member.userId,
      role: computeEffectiveRole(
        normalizeRoles(roleMap.get(String(member.userId)) || [member.role as ProjectRole])
      ),
      roles: normalizeRoles(roleMap.get(String(member.userId)) || [member.role as ProjectRole]),
      joinedAt: member.joinedAt,
      invitedById: member.invitedById,
      user: userMap.get(member.userId) || null,
    }));
  }

  /**
   * Get a user's membership in a project
   */
  async getMembership(projectId: string, userId: string) {
    const dataSource = await getDataSource();
    const memberRepo = dataSource.getRepository(ProjectMember);
    const roleRepo = dataSource.getRepository(ProjectMemberRole);

    const membership = await memberRepo.findOne({ where: { projectId, userId } });

    const rolesRows = await roleRepo.find({ where: { projectId, userId } });
    const rolesFromTable = normalizeRoles(rolesRows.map((r) => r.role as ProjectRole));

    if (membership) {
      const roles = rolesFromTable.length > 0
        ? rolesFromTable
        : normalizeRoles([membership.role as ProjectRole]);
      return {
        ...membership,
        role: computeEffectiveRole(roles),
        roles,
      };
    }

    return null;
  }

  /**
   * Check if user has access to project
   */
  async hasAccess(projectId: string, userId: string): Promise<boolean> {
    const membership = await this.getMembership(projectId, userId);
    return membership !== null;
  }

  /**
   * Check if user has a specific role or higher
   */
  async hasRole(projectId: string, userId: string, requiredRoles: ProjectRole[]): Promise<boolean> {
    const membership = await this.getMembership(projectId, userId);
    if (membership) {
      const roles: ProjectRole[] = Array.isArray((membership as any).roles)
        ? ((membership as any).roles as ProjectRole[])
        : [membership.role as ProjectRole];
      return requiredRoles.some((r) => roles.includes(r));
    }

    return false;
  }

  /**
   * Add a new member to a project
   */
  async addMember(
    projectId: string,
    userId: string,
    roleOrRoles: ProjectRole | ProjectRole[],
    invitedById: string
  ): Promise<{ id: string; projectId: string; userId: string; role: ProjectRole; roles: ProjectRole[] }> {
    const dataSource = await getDataSource();
    const memberRepo = dataSource.getRepository(ProjectMember);
    const roleRepo = dataSource.getRepository(ProjectMemberRole);
    const now = Date.now();

    const requestedRoles = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles];
    const roles = normalizeRoles(requestedRoles);
    const effectiveRole = computeEffectiveRole(roles);

    const existing = await memberRepo.findOne({
      where: { projectId, userId },
      select: ['id']
    });
    if (existing) {
      await this.updateRoles(projectId, userId, roles);
      return { id: String(existing.id), projectId, userId, role: effectiveRole, roles };
    }

    const id = generateId();

    await memberRepo.insert({
      id,
      projectId,
      userId,
      role: effectiveRole,
      invitedById,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    for (const r of roles) {
      await roleRepo.createQueryBuilder()
        .insert()
        .values({ projectId, userId, role: r, createdAt: now })
        .orIgnore()
        .execute();
    }

    await this.writeProjectMemberAssignments(dataSource, {
      projectId,
      userId,
      roles,
      createdById: invitedById,
      createdAt: now,
    });

    return { id, projectId, userId, role: effectiveRole, roles };
  }

  /**
   * Update a member's role
   */
  async updateRole(projectId: string, userId: string, newRole: ProjectRole): Promise<void> {
    await this.updateRoles(projectId, userId, [newRole]);
  }

  async updateRoles(projectId: string, userId: string, rolesInput: ProjectRole[]): Promise<void> {
    const dataSource = await getDataSource();
    const memberRepo = dataSource.getRepository(ProjectMember);
    const roleRepo = dataSource.getRepository(ProjectMemberRole);
    const roles = normalizeRoles(rolesInput);
    if (roles.length === 0) return;
    const now = Date.now();
    const effectiveRole = computeEffectiveRole(roles);

    await memberRepo.update({ projectId, userId }, { role: effectiveRole, updatedAt: now });

    await roleRepo.delete({ projectId, userId });
    await removeProjectMemberRoleAssignments(dataSource, projectId, userId);
    // Old compatibility projections must not retain access after a current
    // membership command changes the role set.
    await removeLegacyProjectMemberRoleAssignments(dataSource, projectId, userId);

    for (const r of roles) {
      await roleRepo.createQueryBuilder()
        .insert()
        .values({ projectId, userId, role: r, createdAt: now })
        .orIgnore()
        .execute();
    }

    await this.writeProjectMemberAssignments(dataSource, {
      projectId,
      userId,
      roles,
      createdById: null,
      createdAt: now,
    });
  }

  /**
   * Remove a member from a project
   */
  async removeMember(projectId: string, userId: string): Promise<void> {
    const dataSource = await getDataSource();
    const memberRepo = dataSource.getRepository(ProjectMember);
    const roleRepo = dataSource.getRepository(ProjectMemberRole);

    await roleRepo.delete({ projectId, userId });
    await memberRepo.delete({ projectId, userId });
    await removeProjectMemberRoleAssignments(dataSource, projectId, userId);
    await removeLegacyProjectMemberRoleAssignments(dataSource, projectId, userId);
  }

  /**
   * Get canonical project owners for governance workflows. The persisted
   * project owner is accountable metadata only, used as a recovery fallback
   * for rows that predate the one-time canonical projection.
   */
  async getProjectOwners(projectId: string): Promise<string[]> {
    const dataSource = await getDataSource();
    const projectRepo = dataSource.getRepository(Project);
    const owners = await dataSource.getRepository(RbacRoleAssignment).find({
      where: {
        principalType: 'user',
        roleId: SYSTEM_ROLE_IDS.PROJECT_OWNER,
        scopeType: 'project',
        scopeId: projectId,
      },
      select: ['principalId'],
    });
    if (owners.length > 0) {
      return Array.from(new Set(owners.map((assignment) => String(assignment.principalId)).filter(Boolean)));
    }

    const project = await projectRepo.findOne({ where: { id: projectId }, select: ['ownerId'] });
    return project ? [String(project.ownerId)] : [];
  }

  /**
   * Transfer ownership to another member
   */
  async transferOwnership(
    projectId: string,
    fromUserId: string,
    toUserId: string
  ): Promise<void> {
    const dataSource = await getDataSource();
    const projectRepo = dataSource.getRepository(Project);

    await this.updateRoles(projectId, fromUserId, ['delegate']);
    await this.updateRoles(projectId, toUserId, ['owner']);

    // Update project owner_id
    await projectRepo.update({ id: projectId }, { ownerId: toUserId });
  }

  private async writeProjectMemberAssignments(
    dataSource: Awaited<ReturnType<typeof getDataSource>>,
    input: { projectId: string; userId: string; roles: ProjectRole[]; createdById: string | null; createdAt: number },
  ): Promise<void> {
    const project = await dataSource.getRepository(Project).findOne({
      where: { id: input.projectId },
      select: ['id', 'tenantId'],
    });
    if (!project) {
      throw new Error('Project not found');
    }

    await writeProjectMemberRoleAssignments(dataSource, {
      ...input,
      tenantId: project.tenantId ?? null,
    });
  }

  /**
   * Count members in a project
   */
  async getMemberCount(projectId: string): Promise<number> {
    const dataSource = await getDataSource();
    const memberRepo = dataSource.getRepository(ProjectMember);
    return memberRepo.count({ where: { projectId } });
  }
}

// Export singleton instance
export const projectMemberService = new ProjectMemberService();
