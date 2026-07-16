import { describe, expect, it } from 'vitest';
import {
  AuthzGroupMembershipSchema,
  AuthzGroupSchema,
  RoleAssignmentSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';

describe('authorization response contracts', () => {
  it('preserves identity-provider provenance for groups and memberships', () => {
    const group = {
      id: 'group-operators',
      tenantId: 'tenant-a',
      key: 'operators',
      name: 'Operators',
      description: null,
      source: 'identity_provider',
      sourceRef: 'identity_provider:entra:mapping:operators',
      ownershipMode: 'manual',
      sourceHash: null,
      lastAppliedAt: null,
      driftStatus: null,
      isSystem: false,
      isArchived: false,
      createdById: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const membership = {
      id: 'membership-operators-user-a',
      tenantId: 'tenant-a',
      groupId: group.id,
      groupKey: group.key,
      groupName: group.name,
      userId: 'user-a',
      source: 'identity_provider',
      sourceRef: group.sourceRef,
      expiresAt: null,
      createdById: null,
      createdAt: 1,
      updatedAt: 1,
    };

    expect(AuthzGroupSchema.parse(group).source).toBe('identity_provider');
    expect(AuthzGroupMembershipSchema.parse(membership).source).toBe('identity_provider');
  });

  it('shares configuration provenance across assignment and group contracts', () => {
    expect(RoleAssignmentSchema.parse({
      id: 'assignment-a',
      userId: 'user-a',
      principalType: 'user',
      principalId: 'user-a',
      roleId: 'role-a',
      roleKey: 'project.viewer',
      roleName: 'Project Viewer',
      roleScope: 'project',
      resourceType: 'project',
      resourceId: 'project-a',
      scopeType: 'project',
      scopeId: 'project-a',
      source: 'config',
      sourceMappingId: null,
      sourceRef: 'bundle:prod',
      ownershipMode: 'config_locked',
      sourceHash: 'assignment-hash',
      lastAppliedAt: 1,
      driftStatus: null,
      expiresAt: null,
      lastSeenAt: null,
      createdById: null,
      createdAt: 1,
      updatedAt: 1,
    }).ownershipMode).toBe('config_locked');
  });
});
