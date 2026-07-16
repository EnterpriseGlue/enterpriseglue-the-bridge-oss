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
});
