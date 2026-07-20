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
  LegacyGlobalMappingRetirementRequestSchema,
  LegacySsoProviderResponseSchema,
  LegacyMappingCoverageItemSchema,
  LegacyMappingCoverageVerifyRequestSchema,
  LegacyMappingRetirementReadinessSchema,
  LegacyMappingRetirementRequestSchema,
  LegacySsoGroupMappingMigrationRequestSchema,
  LegacySsoGroupMappingMigrationResponseSchema,
  LegacySsoMappingMigrationRequestSchema,
  LegacySsoPlatformMappingCreateRequestSchema,
  LegacySsoPlatformMappingUpdateRequestSchema,
  LegacySsoPlatformMappingMigrationResponseSchema,
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
  SsoAssignmentMappingTestResponseSchema,
  SsoAssignmentMappingInsertSchema,
  SsoAssignmentMappingUpdateSchema,
  SsoGroupMappingTestResponseSchema,
  SsoGroupMappingInsertSchema,
  SsoGroupMappingUpdateSchema,
  SamlAuthenticationStatusSchema,
  SsoMappingTestRequestSchema,
  SsoPlatformMappingTestResponseSchema,
  SsoSyncEventSchema,
  SsoSyncRunSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';

describe('provider-neutral identity shared contracts', () => {
  it('limits public SAML status to safe readiness indicators', () => {
    expect(SamlAuthenticationStatusSchema.parse({
      enabled: false,
      message: 'SAML provider is not configured',
      providerConfigured: false,
      providerEnabled: false,
      missingFields: ['entityId', 'ssoUrl', 'certificate'],
    }).missingFields).toEqual(['entityId', 'ssoUrl', 'certificate']);
    expect(() => SamlAuthenticationStatusSchema.parse({
      enabled: true,
      message: 'configured',
      providerConfigured: true,
      providerEnabled: true,
      missingFields: [],
      certificate: 'must-not-be-exposed',
    })).toThrow();
  });

  it('shares the retained legacy platform-mapping write contracts', () => {
    expect(LegacySsoPlatformMappingCreateRequestSchema.parse({
      claimType: 'group', claimKey: 'groups', targetRole: 'user', priority: 0,
    })).toMatchObject({ claimValue: '', claimType: 'group' });
    expect(LegacySsoPlatformMappingUpdateRequestSchema.parse({ priority: 10 })).toMatchObject({ priority: 10, claimValue: '' });
    expect(() => LegacySsoPlatformMappingCreateRequestSchema.parse({
      claimType: 'group', claimKey: 'groups', targetRole: 'operator',
    })).toThrow();
  });

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

  it('shares the legacy mapping replacement and retirement gate contracts', () => {
    expect(LegacyMappingCoverageItemSchema.parse({
      id: 'legacy-1', family: 'engine_assignment', status: 'replacement_candidate', reason: 'Ready to verify',
      candidateIdentityMappingIds: ['mapping-1'],
      verification: { candidateIdentityMappingId: 'mapping-1', verifiedById: null, verifiedAt: 1, note: 'Representative sign-in verified.' },
    }).family).toBe('engine_assignment');
    expect(LegacyMappingRetirementReadinessSchema.parse({
      ready: false, activeLegacyMappingCount: 1, verifiedReplacementCount: 0,
      blockers: [{ id: 'legacy-1', family: 'group', reason: 'Verification required.' }],
    }).blockers).toHaveLength(1);
    expect(LegacyMappingCoverageVerifyRequestSchema.parse({ family: 'platform_role', candidateIdentityMappingId: 'mapping-1', note: 'Verified.' }).note).toBe('Verified.');
    expect(LegacyMappingRetirementRequestSchema.parse({ confirmation: 'RETIRE_LEGACY_MAPPINGS' }).confirmation).toBe('RETIRE_LEGACY_MAPPINGS');
    expect(LegacyGlobalMappingRetirementRequestSchema.parse({ confirmation: 'RETIRE_GLOBAL_LEGACY_MAPPINGS' }).confirmation).toBe('RETIRE_GLOBAL_LEGACY_MAPPINGS');
    expect(() => LegacyMappingCoverageVerifyRequestSchema.parse({ family: 'scope', candidateIdentityMappingId: 'mapping-1', note: 'no' })).toThrow();
  });

  it('keeps legacy SSO provider responses redacted while preserving configured-value indicators', () => {
    const provider = LegacySsoProviderResponseSchema.parse({
      id: 'provider-1', name: 'Legacy SAML', type: 'saml', enabled: false,
      clientId: null, tenantId: null, issuerUrl: null, authorizationUrl: null, tokenUrl: null, userInfoUrl: null, scopes: [],
      entityId: 'enterpriseglue', ssoUrl: 'https://idp.example.test/sso', sloUrl: null, signatureAlgorithm: 'sha256', callbackUrl: 'https://app.example.test/api/auth/saml/callback',
      iconUrl: null, buttonLabel: null, buttonColor: null, displayOrder: 0, autoProvision: true, defaultRole: 'user', createdAt: 1, updatedAt: 2,
      hasClientSecret: true, hasCertificate: true,
    });
    expect(provider.hasCertificate).toBe(true);
    expect(Object.keys(provider)).not.toContain('certificate');
    expect(() => LegacySsoProviderResponseSchema.parse({ ...provider, clientSecret: 'raw-secret' })).toThrow();
  });

  it('shares retained legacy SSO mapping preview contracts across route, API, and UI boundaries', () => {
    expect(SsoMappingTestRequestSchema.parse({ claims: { groups: ['operators'] }, providerId: 'provider-1' }).providerId).toBe('provider-1');
    expect(SsoPlatformMappingTestResponseSchema.parse({
      resolvedRole: 'user',
      matchedMappings: [{ id: 'mapping-1', name: 'group:operators', targetRole: 'user' }],
    }).matchedMappings).toHaveLength(1);
    expect(SsoAssignmentMappingTestResponseSchema.parse({
      matchedMappings: [{
        id: 'mapping-1', providerId: null, claimType: 'group', claimKey: 'groups', claimValue: 'operators', claimOperator: 'equals',
        targetScope: 'engine', targetSelectorType: 'engine_id', targetEngineId: 'engine-1', targetExternalEngineId: null,
        targetLabelKey: null, targetLabelValue: null, targetRoleId: 'system.engine.operator', syncMode: 'authoritative', priority: 0,
        isActive: true, createdAt: 1, updatedAt: 2, targetResourceId: 'engine-1', targetResourceIds: ['engine-1'],
      }],
      assignments: [{ roleId: 'system.engine.operator', resourceType: 'engine', resourceId: 'engine-1', mappingId: 'mapping-1' }],
    }).assignments[0]?.resourceType).toBe('engine');
    expect(SsoGroupMappingTestResponseSchema.parse({
      matchedMappings: [{
        id: 'mapping-1', providerId: null, claimType: 'group', claimKey: 'groups', claimValue: 'operators', claimOperator: 'equals',
        targetGroupId: 'group-1', targetGroupKey: 'operators', targetGroupName: 'Operators', syncMode: 'authoritative', priority: 0,
        isActive: true, createdAt: 1, updatedAt: 2,
      }],
      memberships: [{ groupId: 'group-1', mappingId: 'mapping-1' }],
    }).memberships[0]?.groupId).toBe('group-1');
  });

  it('keeps retained assignment and group mapping writes strict and provider-compatible', () => {
    expect(SsoAssignmentMappingInsertSchema.parse({
      providerId: null, claimType: 'group', claimKey: 'groups', targetSelectorType: 'all_engines', targetRoleId: 'system.engine.operator',
    }).claimValue).toBe('');
    expect(SsoAssignmentMappingUpdateSchema.parse({ targetSelectorType: 'engine_label', targetLabelKey: 'environment', targetLabelValue: 'prod' }).targetSelectorType).toBe('engine_label');
    expect(SsoGroupMappingInsertSchema.parse({
      providerId: null, claimType: 'group', claimKey: 'groups', targetGroupId: 'group-1',
    }).targetGroupId).toBe('group-1');
    expect(SsoGroupMappingUpdateSchema.parse({ priority: 10 }).priority).toBe(10);
    expect(() => SsoGroupMappingInsertSchema.parse({ providerId: '', claimType: 'group', claimKey: 'groups', targetGroupId: 'group-1' })).toThrow();
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

  it('keeps legacy mapping conversion additive and validates shared provider-neutral contracts', () => {
    expect(LegacySsoMappingMigrationRequestSchema.parse({
      providerKey: 'identity.oidc.example', targetGroupKey: 'operators',
    }).targetGroupKey).toBe('operators');
    expect(() => LegacySsoMappingMigrationRequestSchema.parse({
      providerKey: 'identity.oidc.example', targetGroupKey: 'operators', newGroup: { key: 'operators', name: 'Operators' },
    })).toThrow();
    expect(LegacySsoGroupMappingMigrationRequestSchema.parse({ providerKey: 'identity.oidc.example' }).providerKey).toBe('identity.oidc.example');
    const identityMapping = {
      id: 'mapping-1', providerId: 'provider-1', providerKey: 'identity.oidc.example', targetGroupId: 'group-1', targetGroupKey: 'operators',
      entitlementType: 'group', externalId: 'operations', matchOperator: 'exact', syncMode: 'authoritative', isActive: true, configKey: null, sourceRef: null,
    } as const;
    expect(LegacySsoPlatformMappingMigrationResponseSchema.parse({
      legacyMappingId: 'legacy-1', created: true, mapping: identityMapping,
      assignment: { id: 'assignment-1', warnings: [] }, createdGroup: { id: 'group-1', key: 'operators' },
    }).created).toBe(true);
    expect(LegacySsoGroupMappingMigrationResponseSchema.parse({
      legacyMappingId: 'legacy-1', providerKey: 'identity.oidc.example', created: false, identityMapping,
    }).created).toBe(false);
  });
});
