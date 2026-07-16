import { describe, expect, it } from 'vitest';
import {
  ApiClientWithTokenSchema,
  AuthzGroupMembershipSchema,
  AuthzGroupSchema,
  PermissionCatalogEntrySchema,
  RoleAssignmentSchema,
  RoleDetailSchema,
  ServiceAccountWithTokenSchema,
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

  it('keeps one reveal-once credential response shape for machine principals', () => {
    expect(ApiClientWithTokenSchema.parse({
      client: {
        id: 'client-a', name: 'CI deployer', tokenPrefix: 'eg_client_', scopes: ['deployment:execute'],
        isActive: true, createdById: 'user-a', lastUsedAt: null, revokedAt: null, createdAt: 1, updatedAt: 1,
      },
      token: 'reveal-once-client-token',
    }).client.tokenPrefix).toBe('eg_client_');

    expect(ServiceAccountWithTokenSchema.parse({
      account: {
        id: 'service-account-a', name: 'Release service account', tokenPrefix: null, scopes: ['deployment:execute'],
        description: null, isActive: true, createdById: 'user-a', lastUsedAt: null, revokedAt: null, createdAt: 1, updatedAt: 1,
      },
      token: 'reveal-once-service-token',
    }).account.id).toBe('service-account-a');
  });

  it('exposes permission catalog metadata through the shared response contract', () => {
    expect(PermissionCatalogEntrySchema.parse({
      key: 'project.deploy.create',
      scope: 'project',
      category: 'Deployment',
      label: 'Deploy project resources',
      description: 'Allows deployment to eligible project engine targets.',
      kind: 'system',
      isEditable: false,
      isArchived: false,
      createdById: null,
      createdAt: 1,
      updatedAt: 1,
    }).key).toBe('project.deploy.create');
  });

  it('keeps config provenance on role detail responses', () => {
    expect(RoleDetailSchema.parse({
      id: 'role-operators',
      tenantId: 'tenant-a',
      key: 'custom.engine.operator',
      name: 'Engine Operator',
      description: null,
      scope: 'engine',
      kind: 'custom',
      isEditable: true,
      isAssignable: true,
      isArchived: false,
      source: 'config',
      sourceRef: 'bundle:production-authz',
      ownershipMode: 'config_locked',
      sourceHash: 'role-hash',
      lastAppliedAt: 1,
      driftStatus: null,
      permissionCount: 1,
      permissions: ['engine:instance:view'],
      createdAt: 1,
      updatedAt: 1,
    }).ownershipMode).toBe('config_locked');
  });
});
