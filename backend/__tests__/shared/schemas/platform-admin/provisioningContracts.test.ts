import { describe, expect, it } from 'vitest';
import {
  IdentityProvisioningCredentialMetadataSchema,
  IdentityProvisioningDirectoryConfigSchema,
  IdentityProvisioningDirectoryCreateSchema,
  IdentityProvisioningDirectoryRecordSchema,
  IdentityProvisioningIdempotencyKeySchema,
  UserDeactivateRequestSchema,
  UserDirectoryListResponseSchema,
  UserIdentityContextSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/index.js';
import {
  SCIM_GROUP_SCHEMA,
  SCIM_PATCH_OP_SCHEMA,
  SCIM_USER_SCHEMA,
  ScimErrorSchema,
  ScimGroupCreateSchema,
  ScimListQuerySchema,
  ScimPatchRequestSchema,
  ScimUserCreateSchema,
  ScimUserListResponseSchema,
} from '@enterpriseglue/shared/schemas/scim.js';

describe('authoritative identity provisioning contracts', () => {
  it('defines a separate, disabled-by-default authoritative directory', () => {
    expect(IdentityProvisioningDirectoryCreateSchema.parse({
      key: 'entra-workforce',
      displayName: 'Microsoft Entra workforce',
      identityProviderKey: 'entra-oidc',
    })).toEqual({
      key: 'entra-workforce',
      displayName: 'Microsoft Entra workforce',
      identityProviderKey: 'entra-oidc',
      isEnabled: false,
      authoritative: true,
    });
    expect(() => IdentityProvisioningDirectoryCreateSchema.parse({
      key: 'Invalid Key', displayName: 'Invalid', authoritative: false,
    })).toThrow();
  });

  it('keeps raw credentials and hashes out of configuration and API metadata', () => {
    expect(IdentityProvisioningDirectoryConfigSchema.parse({
      key: 'entra-workforce', displayName: 'Entra', credentialSecretRef: 'vault:scim/entra',
    }).credentialSecretRef).toBe('vault:scim/entra');
    expect(() => IdentityProvisioningDirectoryConfigSchema.parse({
      key: 'entra-workforce', displayName: 'Entra', token: 'raw-secret',
    })).toThrow();
    expect(() => IdentityProvisioningCredentialMetadataSchema.parse({
      id: 'credential-1', directoryId: 'directory-1', name: 'Primary', fingerprint: 'abcdef123456',
      status: 'active', createdAt: 1, expiresAt: null, overlapEndsAt: null, lastUsedAt: null, revokedAt: null,
      tokenHash: 'must-not-leak',
    })).toThrow();
  });

  it('accepts bounded automation idempotency keys', () => {
    expect(IdentityProvisioningIdempotencyKeySchema.parse('deployment:2026-08-15:001')).toBe('deployment:2026-08-15:001');
    expect(() => IdentityProvisioningIdempotencyKeySchema.parse('short')).toThrow();
    expect(() => IdentityProvisioningIdempotencyKeySchema.parse('contains spaces')).toThrow();
  });

  it('exposes bounded source-aware user directory records', () => {
    const user = {
      id: 'user-1', email: 'alice@example.com', firstName: 'Alice', lastName: 'Example', displayName: 'Alice Example',
      status: 'active', platformRole: 'user', authenticationSources: ['oidc'] as const, provisioningSource: 'scim' as const,
      provisioningDirectoryKey: 'entra-workforce', lastSignInAt: 1, lastProvisionedAt: 2, provisioningHealth: 'healthy' as const,
    };
    expect(UserDirectoryListResponseSchema.parse({ items: [user], total: 1, limit: 50, offset: 0 }).items[0]?.provisioningSource).toBe('scim');
    expect(UserIdentityContextSchema.parse({
      user,
      linkedIdentities: [{ id: 'link-1', sourceType: 'provisioning_directory', sourceKey: 'entra-workforce', sourceName: 'Entra', externalSubject: 'external-alice', status: 'active', linkedAt: 1, lastSeenAt: 2 }],
      fieldOwnership: [{ field: 'email', owner: 'directory', sourceKey: 'entra-workforce' }],
      recoveryAdministrator: false,
    }).fieldOwnership[0]?.owner).toBe('directory');
    expect(() => UserDeactivateRequestSchema.parse({ reason: 'x' })).toThrow();
  });

  it('keeps persisted provisioning-directory responses explicit and secret-free', () => {
    expect(IdentityProvisioningDirectoryRecordSchema.parse({
      id: 'directory-1', tenantId: null, key: 'entra-workforce', directoryKeyIdentity: 'identity-1',
      displayName: 'Entra', description: null, type: 'scim_v2', identityProviderKey: 'entra-oidc', authoritative: true,
      status: 'active', ownershipMode: 'manual', sourceRef: null, sourceHash: null, lastAppliedAt: null,
      credentialSecretRef: null,
      driftStatus: null, createdAt: 1, updatedAt: 2, archivedAt: null,
    }).type).toBe('scim_v2');
  });
});

describe('SCIM 2.0 canonical contracts', () => {
  it('accepts a bounded core user while rejecting missing schema and raw extensions', () => {
    expect(ScimUserCreateSchema.parse({
      schemas: [SCIM_USER_SCHEMA], externalId: 'entra-object-1', userName: 'alice@example.com',
      name: { givenName: 'Alice', familyName: 'Example' }, emails: [{ value: 'alice@example.com', primary: true }], active: true,
    }).externalId).toBe('entra-object-1');
    expect(() => ScimUserCreateSchema.parse({ schemas: [], userName: 'alice@example.com' })).toThrow();
    expect(ScimUserCreateSchema.parse({
      schemas: [SCIM_USER_SCHEMA], userName: 'alice@example.com', password: 'accepted-but-never-stored',
    }).password).toBe('accepted-but-never-stored');
  });

  it('accepts groups and validates atomic patch operation shape', () => {
    expect(ScimGroupCreateSchema.parse({
      schemas: [SCIM_GROUP_SCHEMA], externalId: 'group-object-1', displayName: 'Engineering', members: [{ value: 'user-1' }],
    }).members).toHaveLength(1);
    expect(ScimPatchRequestSchema.parse({
      schemas: [SCIM_PATCH_OP_SCHEMA],
      Operations: [{ op: 'replace', path: 'active', value: false }],
    }).Operations[0]?.op).toBe('replace');
    expect(() => ScimPatchRequestSchema.parse({ schemas: [SCIM_PATCH_OP_SCHEMA], Operations: [{ op: 'remove' }] })).toThrow();
    expect(() => ScimPatchRequestSchema.parse({
      schemas: [SCIM_PATCH_OP_SCHEMA], Operations: Array.from({ length: 101 }, () => ({ op: 'remove', path: 'members' })),
    })).toThrow();
  });

  it('defines SCIM pagination and sanitized protocol errors', () => {
    expect(ScimListQuerySchema.parse({ startIndex: '1', count: '100' })).toMatchObject({ startIndex: 1, count: 100 });
    expect(ScimUserListResponseSchema.parse({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'], totalResults: 0, startIndex: 1, itemsPerPage: 0, Resources: [],
    }).Resources).toEqual([]);
    expect(ScimErrorSchema.parse({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: '409', scimType: 'uniqueness', detail: 'The external identity already exists.' }).status).toBe('409');
    expect(() => ScimErrorSchema.parse({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: '500', stack: 'secret diagnostic' })).toThrow();
  });
});
