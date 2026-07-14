import type { DataSource, EntityManager } from 'typeorm';
import { In } from 'typeorm';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { canonicalRoleAssignmentKey } from '@enterpriseglue/shared/authz/role-assignment-identity.js';
import { SYSTEM_ROLE_IDS } from './permissions.js';

export type LegacyProjectRole = 'owner' | 'delegate' | 'developer' | 'editor' | 'viewer';

const PROJECT_MEMBER_ROLE_TO_SYSTEM_ROLE_ID: Record<LegacyProjectRole, string> = {
  owner: SYSTEM_ROLE_IDS.PROJECT_OWNER,
  delegate: SYSTEM_ROLE_IDS.PROJECT_DELEGATE,
  developer: SYSTEM_ROLE_IDS.PROJECT_DEVELOPER,
  editor: SYSTEM_ROLE_IDS.PROJECT_EDITOR,
  viewer: SYSTEM_ROLE_IDS.PROJECT_VIEWER,
};

type AssignmentStore = DataSource | EntityManager;

/**
 * Keep legacy project membership synchronized through canonical assignment
 * identity while allowing the originating command to update only the affected
 * principal. Deprecated alias columns remain readable for old rows, but new
 * compatibility assignments must not repopulate them.
 */
export async function writeLegacyProjectMemberRoleAssignments(
  store: AssignmentStore,
  input: {
    projectId: string;
    tenantId?: string | null;
    userId: string;
    roles: LegacyProjectRole[];
    createdById: string | null;
    createdAt: number;
  },
): Promise<void> {
  const now = Date.now();
  const assignments = input.roles.map((role) => {
    const roleId = PROJECT_MEMBER_ROLE_TO_SYSTEM_ROLE_ID[role];
    const sourceRef = `project_member_role:${input.projectId}:${input.userId}:${role}`;
    return {
      id: `legacy:project:${input.projectId}:${input.userId}:${roleId}`,
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
        source: 'legacy',
        sourceRef,
      }),
      roleId,
      scopeType: 'project' as const,
      scopeId: input.projectId,
      source: 'legacy' as const,
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

export async function removeLegacyProjectMemberRoleAssignments(
  store: AssignmentStore,
  projectId: string,
  userId: string,
): Promise<void> {
  await store.getRepository(RbacRoleAssignment).delete({
    id: In(Object.values(PROJECT_MEMBER_ROLE_TO_SYSTEM_ROLE_ID).map((roleId) => `legacy:project:${projectId}:${userId}:${roleId}`)),
  });
}
