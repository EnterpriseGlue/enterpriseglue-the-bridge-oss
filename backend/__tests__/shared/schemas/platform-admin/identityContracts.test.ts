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
  LegacyGlobalMappingRetirementRequestSchema,
  LegacyIdentityProviderMigrationDraftSchema,
  LegacyMappingCoverageItemSchema,
  LegacyMappingCoverageVerifyRequestSchema,
  LegacyMappingRetirementReadinessSchema,
  LegacyMappingRetirementRequestSchema,
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

  it('keeps legacy provider migration drafts provider-neutral and secret-reference-only', () => {
    const draft = {
      legacyProvider: { id: 'legacy-1', name: 'Legacy OIDC', type: 'oidc', enabled: true, clientSecretConfigured: true },
      provider: {
        key: 'legacy-oidc-legacy-1', protocol: 'oidc', isEnabled: false, authenticationMode: 'direct', directoryTenantId: null,
        configuration: { issuerUrl: 'https://issuer.example.test', clientId: 'client-1', callbackUrl: 'https://app.example.test/api/auth/identity/callback', scopes: ['openid'], clientSecretRef: 'env://OIDC_CLIENT_SECRET' },
      },
      requirements: ['client_secret_reference', 'identity_provider_redirect_uri', 'identity_mappings', 'legacy_provider_cutover'],
      warnings: ['The generated provider is disabled.'],
    };
    expect(LegacyIdentityProviderMigrationDraftSchema.parse(draft).provider.protocol).toBe('oidc');
    expect(() => LegacyIdentityProviderMigrationDraftSchema.parse({
      ...draft,
      provider: { ...draft.provider, configuration: { ...draft.provider.configuration, clientSecret: 'raw-secret' } },
    })).toThrow();
  });
});
