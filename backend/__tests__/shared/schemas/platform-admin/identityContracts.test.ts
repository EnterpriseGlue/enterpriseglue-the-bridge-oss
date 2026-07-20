import { describe, expect, it } from 'vitest';
import {
  ExternalIdentitySchema,
  ExternalIdentitySnapshotSchema,
  IdentityEntitlementMappingRecordSchema,
  IdentitySyncDiagnosticSchema,
  IdentitySyncEventSchema,
  IdentitySyncRunSchema,
  NormalizedExternalIdentitySchema,
  ProviderIdentityInputSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/identity.js';
import {
  EffectiveAccessEvaluateResponseSchema,
  IdentityMappingResponseSchema,
  IdentityMappingStoredSnapshotPreviewRequestSchema,
  IdentityMappingStoredSnapshotPreviewResponseSchema,
  IdentityMappingTestRequestSchema,
  IdentityMappingTestResponseSchema,
  AuthzCheckBatchRequestSchema,
  AuthzCheckBatchResponseSchema,
  AuthzCheckRequestSchema,
  AuthzCheckResponseSchema,
  AuthzAuditQuerySchema,
  AuthzAuditLogResponseSchema,
  AuthzCreatedIdResponseSchema,
  AuthzMutationSuccessResponseSchema,
  AuthzPolicyCreateSchema,
  AuthzPolicyResponseSchema,
  AuthzPolicyUpdateSchema,
  ApiClientCreateSchema,
  CustomPermissionCreateResponseSchema,
  EngineSetCreateSchema,
  EngineSetUpdateSchema,
  ExternalEngineLifecycleRequestSchema,
  ProjectEngineTargetSyncLegacyResponseSchema,
  ProjectEngineTargetSyncLegacyRequestSchema,
  RoleAssignmentCreateResponseSchema,
  ServiceAccountCreateSchema,
  SsoSyncEventSchema,
  SsoSyncRunSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';

describe('provider-neutral identity shared contracts', () => {
  it('accepts normalized identity and adapter input without protocol payload fields', () => {
    expect(ProviderIdentityInputSchema.parse({
      providerKey: 'identity.oidc.example', subjectId: 'subject-1', claims: { groups: ['operators'] },
    })).toMatchObject({ providerKey: 'identity.oidc.example', subjectId: 'subject-1' });
    expect(NormalizedExternalIdentitySchema.parse({
      providerKey: 'identity.oidc.example', providerType: 'oidc', subjectId: 'subject-1', observedAt: 1,
      entitlements: [{ type: 'group', externalId: 'operators' }],
    })).toMatchObject({ providerType: 'oidc', entitlements: [{ type: 'group', externalId: 'operators' }] });
  });

  it('rejects raw or unbounded fields from normalized identity and diagnostics', () => {
    expect(() => NormalizedExternalIdentitySchema.parse({
      providerKey: 'identity.oidc.example', providerType: 'oidc', subjectId: 'subject-1', observedAt: 1,
      entitlements: [], rawToken: 'secret',
    })).toThrow();
    expect(() => IdentitySyncDiagnosticSchema.parse({
      providerKey: 'identity.oidc.example', status: 'failed', occurredAt: 1, rawAssertion: '<Assertion />',
    })).toThrow();
  });

  it('captures tenant and external-directory identities across persisted provider contracts', () => {
    expect(ExternalIdentitySchema.parse({
      id: 'external-1', identityKey: 'tenant-a:provider-1:subject-1', tenantId: 'tenant-a', providerId: 'provider-1', providerType: 'ldap',
      subjectId: 'directory-guid-1', directoryTenantId: 'directory-a', userId: 'user-1', emailHint: null, status: 'active', linkedAt: 1, lastSeenAt: 2, createdAt: 1, updatedAt: 2,
    }).subjectId).toBe('directory-guid-1');
    expect(ExternalIdentitySnapshotSchema.parse({
      id: 'snapshot-1', tenantId: 'tenant-a', providerId: 'provider-1', providerType: 'oidc', providerSubject: 'subject-1', subjectClaim: 'sub', providerTenantId: 'directory-a', userId: 'user-1', email: null, displayName: null, firstName: null, lastName: null, groupsJson: '[]', rolesJson: '[]', claimsJson: '{}', providerStatus: 'active', lastSeenAt: 2, lastProviderCheckAt: null, createdAt: 1, updatedAt: 2,
    }).providerTenantId).toBe('directory-a');
    expect(IdentityEntitlementMappingRecordSchema.parse({
      id: 'mapping-1', tenantId: 'tenant-a', providerId: 'provider-1', configKey: null, configKeyIdentity: null, sourceRef: null, sourceHash: null, lastAppliedAt: null, driftStatus: null, entitlementType: 'group', externalId: 'operators', matchOperator: 'exact', targetGroupId: 'group-1', syncMode: 'authoritative', isActive: true, createdAt: 1, updatedAt: 2,
    }).externalId).toBe('operators');
  });

  it('keeps legacy sync exports aligned with shared provider-neutral records', () => {
    const run = { id: 'run-1', tenantId: 'tenant-a', providerId: 'provider-1', userId: null, trigger: 'manual', status: 'success', startedAt: 1, completedAt: 2, groupMembershipsCreated: 1, groupMembershipsUpdated: 0, groupMembershipsRemoved: 0, assignmentsCreated: 0, assignmentsUpdated: 0, assignmentsRemoved: 0, errorCode: null, errorMessage: null, details: '{}' };
    expect(IdentitySyncRunSchema.parse(run)).toEqual(run);
    expect(SsoSyncRunSchema).toBe(IdentitySyncRunSchema);
    expect(SsoSyncEventSchema).toBe(IdentitySyncEventSchema);
    expect(IdentitySyncEventSchema.parse({ id: 'event-1', tenantId: 'tenant-a', providerId: 'provider-1', runId: 'run-1', severity: 'info', type: 'identity_synced', userId: null, mappingType: null, mappingId: null, resourceType: null, resourceId: null, message: 'Completed', details: '{}', createdAt: 2 }).runId).toBe('run-1');
  });

  it('keeps identity mapping and Effective Access provider lineage in shared API contracts', () => {
    expect(IdentityMappingResponseSchema.parse({
      id: 'mapping-1', providerId: 'provider-1', providerKey: 'identity.oidc.example', targetGroupId: 'group-1', targetGroupKey: 'operators',
      entitlementType: 'group', externalId: 'operations', matchOperator: 'exact', syncMode: 'authoritative', isActive: true, configKey: null, sourceRef: null,
    }).syncMode).toBe('authoritative');
    expect(EffectiveAccessEvaluateResponseSchema.parse({
      allowed: true, decision: 'allow', reason: 'Granted by group', baseAllowed: true, baseReason: 'Canonical assignment',
      sources: [{
        type: 'group_membership',
        identityEntitlementMapping: { id: 'mapping-1', providerId: 'provider-1', entitlementType: 'group', externalId: 'operations', matchOperator: 'exact', targetGroupId: 'group-1', syncMode: 'authoritative' },
      }],
    }).sources[0]?.identityEntitlementMapping?.providerId).toBe('provider-1');
  });

  it('shares identity-mapping preview contracts without a UI-local response model', () => {
    expect(IdentityMappingTestRequestSchema.parse({
      providerKey: 'identity.oidc.example', entitlementType: 'group', externalId: 'operations', matchOperator: 'exact', claims: { groups: ['operations'] },
    }).claims).toEqual({ groups: ['operations'] });
    expect(IdentityMappingTestResponseSchema.parse({
      matches: true, entitlements: [{ type: 'group', externalId: 'operations' }],
    }).matches).toBe(true);
    expect(IdentityMappingStoredSnapshotPreviewRequestSchema.parse({
      providerKey: 'identity.oidc.example', entitlementType: 'group', externalId: null, matchOperator: 'exists', limit: 100,
    }).limit).toBe(100);
    expect(IdentityMappingStoredSnapshotPreviewResponseSchema.parse({
      scanned: 10, matches: 4, nonMatches: 6, failed: 0, truncated: false, latestSnapshotAt: null, warnings: [],
    }).scanned).toBe(10);
  });

  it('shares authorization check contracts without trusting caller identity or tenancy', () => {
    expect(AuthzCheckRequestSchema.parse({
      action: 'engine.instances.read', resourceType: 'engine', resourceId: 'engine-1', userAttributes: { department: 'operations' },
    }).action).toBe('engine.instances.read');
    expect(AuthzCheckResponseSchema.parse({
      allowed: true, decision: 'allow', reason: 'Canonical assignment', policyId: 'policy-1', policyName: 'Allow operations',
    }).policyName).toBe('Allow operations');
    expect(AuthzCheckBatchRequestSchema.parse({ checks: [{ action: 'engine.instances.read' }] }).checks).toHaveLength(1);
    expect(AuthzCheckBatchResponseSchema.parse({
      results: [{ action: 'engine.instances.read', allowed: false, reason: 'Missing assignment' }],
    }).results[0]?.allowed).toBe(false);
    expect(() => AuthzCheckRequestSchema.parse({ action: '' })).toThrow();
  });

  it('shares bounded authorization mutation responses across routes and hooks', () => {
    expect(AuthzCreatedIdResponseSchema.parse({ id: 'group-1' }).id).toBe('group-1');
    expect(AuthzMutationSuccessResponseSchema.parse({ success: true }).success).toBe(true);
    expect(() => AuthzMutationSuccessResponseSchema.parse({ success: false })).toThrow();
    expect(CustomPermissionCreateResponseSchema.parse({ id: 'permission-1', key: 'custom.view' }).key).toBe('custom.view');
    expect(RoleAssignmentCreateResponseSchema.parse({ id: 'assignment-1', warnings: [] }).warnings).toEqual([]);
    expect(ProjectEngineTargetSyncLegacyResponseSchema.parse({ createdOrUpdated: 2 }).createdOrUpdated).toBe(2);
  });

  it('shares policy writes without route-local persistence fields', () => {
    expect(AuthzPolicyCreateSchema.parse({
      name: 'Deny risky production action', effect: 'deny', action: 'engine.deploy.execute', conditions: { environment: 'production' },
    }).effect).toBe('deny');
    expect(AuthzPolicyUpdateSchema.parse({ priority: 10, isActive: false })).toMatchObject({ priority: 10, isActive: false });
    expect(() => AuthzPolicyCreateSchema.parse({ name: 'bad', effect: 'allow', priority: -1 })).toThrow();
  });

  it('shares machine-principal write contracts with the route and OpenAPI', () => {
    expect(ApiClientCreateSchema.parse({
      name: 'Engine registration',
      scopes: ['engine:register'],
    })).toMatchObject({ scopes: ['engine:register'] });
    expect(ServiceAccountCreateSchema.parse({
      name: 'Release service',
      description: 'Release automation',
      scopes: ['deployment:execute'],
    })).toMatchObject({ scopes: ['deployment:execute'] });
    expect(() => ApiClientCreateSchema.parse({ name: 'invalid', scopes: ['admin:all'] })).toThrow();
    expect(() => ServiceAccountCreateSchema.parse({ name: 'invalid', scopes: ['engine:register'] })).toThrow();
  });

  it('shares Engine Set selectors and writes with the route and OpenAPI', () => {
    expect(EngineSetCreateSchema.parse({
      name: 'Production engines',
      selector: { mode: 'labels', labels: { environment: 'production' }, labelMatch: 'all' },
    }).selector).toMatchObject({ mode: 'labels', labelMatch: 'all' });
    expect(EngineSetUpdateSchema.parse({
      selector: { mode: 'engine_ids', engineIds: ['engine-1'] },
      riskAcknowledged: true,
    }).selector).toMatchObject({ mode: 'engine_ids', engineIds: ['engine-1'] });
    expect(() => EngineSetCreateSchema.parse({
      name: 'invalid labels',
      selector: { mode: 'labels', labels: {} },
    })).toThrow();
  });

  it('shares deployment-target legacy synchronization input with the route and OpenAPI', () => {
    expect(ProjectEngineTargetSyncLegacyRequestSchema.parse({ projectId: 'project-1' })).toEqual({ projectId: 'project-1' });
    expect(() => ProjectEngineTargetSyncLegacyRequestSchema.parse({ projectId: '' })).toThrow();
  });

  it('shares authorization-audit query bounds with the route and OpenAPI', () => {
    expect(AuthzAuditQuerySchema.parse({ decision: 'deny', limit: '500', offset: '0' })).toMatchObject({
      decision: 'deny', limit: 500, offset: 0,
    });
    expect(() => AuthzAuditQuerySchema.parse({ limit: '501' })).toThrow();
  });

  it('keeps the authorization-audit API view explicit and persistence-safe', () => {
    expect(AuthzAuditLogResponseSchema.parse({
      id: 'audit-1', tenantId: null, userId: 'user-1', action: 'authz.check',
      resourceType: null, resourceId: null, decision: 'allow', reason: 'role assignment',
      policyId: null, context: '{}', ipAddress: null, userAgent: null, timestamp: 1,
    }).context).toBe('{}');
    expect(() => AuthzAuditLogResponseSchema.parse({
      id: 'audit-1', tenantId: null, userId: 'user-1', action: 'authz.check',
      resourceType: null, resourceId: null, decision: 'allow', reason: 'role assignment',
      policyId: null, context: '{}', ipAddress: null, userAgent: null, timestamp: 1, createdAt: 1,
    })).toThrow();
  });

  it('shares bounded external-engine lifecycle notes with the route and OpenAPI', () => {
    expect(ExternalEngineLifecycleRequestSchema.parse({ reason: '  maintenance window  ' })).toEqual({ reason: 'maintenance window' });
    expect(() => ExternalEngineLifecycleRequestSchema.parse({ reason: 'x'.repeat(501) })).toThrow();
  });

  it('keeps the public policy response aligned with the service view', () => {
    expect(AuthzPolicyResponseSchema.parse({
      id: 'policy-1', tenantId: null, name: 'Deny risky production action', effect: 'deny', priority: 10,
      conditions: { environment: 'production' }, isActive: true,
    }).conditions).toEqual({ environment: 'production' });
    expect(() => AuthzPolicyResponseSchema.parse({
      id: 'policy-1', tenantId: null, name: 'Deny', effect: 'deny', priority: 10, conditions: {}, isActive: true, createdAt: 1,
    })).toThrow();
  });
});
