import { describe, expect, it } from 'vitest';
import {
  ApiClientWithTokenSchema,
  AuthzGroupMembershipSchema,
  AuthzGroupSchema,
  CurrentUserPermissionsSchema,
  DeploymentEligibilityEvaluateResponseSchema,
  ExternalEngineRegistrationSchema,
  PermissionCatalogEntrySchema,
  RoleAssignmentSchema,
  RoleDetailSchema,
  RuntimeResourceSetMaterializationResultSchema,
  SsoAssignmentMappingSchema,
  SsoGroupMappingSchema,
  ServiceAccountWithTokenSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';
import { EngineMetadataReconciliationResultSchema } from '@enterpriseglue/shared/schemas/platform-admin/deployment-receipt.js';

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

  it('includes transport mode in external engine registration responses', () => {
    expect(ExternalEngineRegistrationSchema.parse({
      id: 'engine-registration-a',
      name: 'Payments engine',
      baseUrl: 'https://payments-sidecar.example.test/engine-rest',
      type: 'operaton',
      connectionMode: 'customer_sidecar',
      externalId: 'payments-prod',
      labels: { environment: 'production' },
      registrationSource: 'external',
      externalUpdatedAt: null,
      createdAt: 1,
      updatedAt: 1,
    }).connectionMode).toBe('customer_sidecar');
  });

  it('keeps legacy mapping response fields canonical during provider-neutral migration', () => {
    expect(SsoAssignmentMappingSchema.parse({
      id: 'assignment-mapping-a', providerId: null, claimType: 'group', claimKey: 'groups', claimValue: 'operators',
      targetScope: 'engine', targetSelectorType: 'engine_id', targetEngineId: 'engine-a', targetExternalEngineId: null,
      targetLabelKey: null, targetLabelValue: null, targetRoleId: 'role-operator', syncMode: 'authoritative', priority: 10,
      isActive: true, createdAt: 1, updatedAt: 1,
    }).targetSelectorType).toBe('engine_id');
    expect(SsoGroupMappingSchema.parse({
      id: 'group-mapping-a', providerId: null, claimType: 'group', claimKey: 'groups', claimValue: 'operators',
      targetGroupId: 'group-operators', targetGroupKey: 'operators', targetGroupName: 'Operators', syncMode: 'additive',
      priority: 20, isActive: true, createdAt: 1, updatedAt: 1,
    }).targetGroupKey).toBe('operators');
  });

  it('shares runtime resource materialization and reconciliation responses', () => {
    expect(RuntimeResourceSetMaterializationResultSchema.parse({
      runtimeResourceSetId: 'runtime-set-a', matched: 4, created: 1, updated: 2, removed: 3,
    }).matched).toBe(4);
    expect(EngineMetadataReconciliationResultSchema.parse({
      created: 1, updated: 2, deactivated: 3, materializedSets: 4, runtimeSkipped: true,
      deployments: { created: 5, updated: 6, artifactsCreated: 7, skipped: true },
    }).deployments.artifactsCreated).toBe(7);
  });

  it('shares permission snapshots and deployment eligibility decisions', () => {
    expect(CurrentUserPermissionsSchema.parse({
      userId: 'user-a', platform: ['platform:authz:view'], projects: [{ resourceId: 'project-a', permissions: ['project:read'] }],
      engines: [{ resourceId: 'engine-a', permissions: ['engine:read'] }], authorizationVersion: 'version-a', generatedAt: 1,
    }).authorizationVersion).toBe('version-a');
    expect(DeploymentEligibilityEvaluateResponseSchema.parse({
      allowed: true, decision: 'allow', mode: 'ci', projectId: 'project-a', engineId: 'engine-a',
      checks: [{ id: 'target.ci', allowed: true, reason: 'CI deployment is enabled' }], reasons: [],
    }).mode).toBe('ci');
  });
});
