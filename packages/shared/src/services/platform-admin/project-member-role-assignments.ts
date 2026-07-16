import type { DataSource, EntityManager } from 'typeorm';
import { In } from 'typeorm';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { canonicalRoleAssignmentKey } from '@enterpriseglue/shared/authz/role-assignment-identity.js';
import { SYSTEM_ROLE_IDS } from './permissions.js';

export type ProjectMemberRole = 'owner' | 'delegate' | 'developer' | 'editor' | 'viewer';

const PROJECT_MEMBER_ROLE_TO_SYSTEM_ROLE_ID: Record<ProjectMemberRole, string> = {
  owner: SYSTEM_ROLE_IDS.PROJECT_OWNER,
  delegate: SYSTEM_ROLE_IDS.PROJECT_DELEGATE,
  developer: SYSTEM_ROLE_IDS.PROJECT_DEVELOPER,
  editor: SYSTEM_ROLE_IDS.PROJECT_EDITOR,
  viewer: SYSTEM_ROLE_IDS.PROJECT_VIEWER,
};

type AssignmentStore = DataSource | EntityManager;

function projectMemberAssignmentId(projectId: string, userId: string, roleId: string): string {
  return `manual:project:${projectId}:${userId}:${roleId}`;
}

function projectMemberSourceRef(projectId: string, userId: string, role: ProjectMemberRole): string {
  return `project_membership:${projectId}:${userId}:${role}`;
}

/**
 * Write the canonical access projection for a current project-membership
 * command. The ProjectMember and ProjectMemberRole rows remain compatibility
 * and collaboration-display records; they are not the authorization source.
 */
export async function writeProjectMemberRoleAssignments(
  store: AssignmentStore,
  input: {
    projectId: string;
    tenantId?: string | null;
    userId: string;
    roles: ProjectMemberRole[];
    createdById: string | null;
    createdAt: number;
  },
): Promise<void> {
  const now = Date.now();
  const assignments = input.roles.map((role) => {
    const roleId = PROJECT_MEMBER_ROLE_TO_SYSTEM_ROLE_ID[role];
    const sourceRef = projectMemberSourceRef(input.projectId, input.userId, role);
    return {
      id: projectMemberAssignmentId(input.projectId, input.userId, roleId),
      tenantId: input.tenantId ?? null,
      principalType: 'user' as const,
      principalId: input.userId,
      assignmentKey: canonicalRoleAssignmentKey({
        tenantId: input.tenantId ?? null,
        principalType: 'user',
        principalId: input.userId,
        roleId,
        scopeType: 'project',
        scopeId: input.projectId,
        source: 'manual',
        sourceRef,
      }),
      roleId,
      scopeType: 'project' as const,
      scopeId: input.projectId,
      source: 'manual' as const,
      sourceRef,
      expiresAt: null,
      lastSeenAt: now,
      createdById: input.createdById,
      createdAt: input.createdAt || now,
      updatedAt: now,
    };
  });

  if (assignments.length > 0) {
    await store.getRepository(RbacRoleAssignment).upsert(assignments, {
      conflictPaths: ['id'],
      skipUpdateIfNoValuesChanged: true,
    });
  }
}

/** Remove only the canonical assignments owned by project-membership commands. */
export async function removeProjectMemberRoleAssignments(
  store: AssignmentStore,
  projectId: string,
  userId: string,
): Promise<void> {
  await store.getRepository(RbacRoleAssignment).delete({
    id: In(Object.values(PROJECT_MEMBER_ROLE_TO_SYSTEM_ROLE_ID).map((roleId) => projectMemberAssignmentId(projectId, userId, roleId))),
  });
}
