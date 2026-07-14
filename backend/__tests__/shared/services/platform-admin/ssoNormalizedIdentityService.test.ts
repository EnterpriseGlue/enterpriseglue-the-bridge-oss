import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroupMembership, ExternalIdentity, IdentityEntitlementMapping, SsoNormalizedIdentity } from '@enterpriseglue/shared/db/entities/index.js';
import { ssoNormalizedIdentityService } from '@enterpriseglue/shared/services/platform-admin/SsoNormalizedIdentityService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));
const syncMembershipsInStore = vi.hoisted(() => vi.fn().mockResolvedValue({ created: 0, removed: 0 }));
const matchesIdentityEntitlement = vi.hoisted(() => vi.fn((mapping: { entitlementType: string; externalId?: string | null; matchOperator: string }, identity: { entitlements: Array<{ type: string; externalId: string }> }) => {
  const candidates = identity.entitlements.filter((entitlement) => entitlement.type === mapping.entitlementType);
  if (mapping.matchOperator === 'exists') return candidates.length > 0;
  return candidates.some((candidate) => mapping.matchOperator === 'exact' ? candidate.externalId === mapping.externalId : candidate.externalId.includes(mapping.externalId || ''));
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityEntitlementMappingService.js', () => ({
  identityEntitlementMappingService: { syncMembershipsInStore }, matchesIdentityEntitlement,
}));

describe('ssoNormalizedIdentityService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts a normalized SSO identity snapshot when no provider subject exists', async () => {
    const getOne = vi.fn().mockResolvedValue(null);
    const qb = {
      where: vi.fn(() => qb),
      andWhere: vi.fn(() => qb),
      getOne,
    };
    const insert = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue(undefined);
    const repo = {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
      insert,
      update,
    };
    const externalRepo = { findOne: vi.fn().mockResolvedValue(null), insert: vi.fn().mockResolvedValue(undefined), update: vi.fn().mockResolvedValue(undefined) };
    const dataSource = {
      getRepository: vi.fn((entity: unknown) => {
        if (entity === SsoNormalizedIdentity) return repo;
        if (entity === ExternalIdentity) return externalRepo;
        throw new Error('Unexpected repository');
      }),
    };
    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    const result = await ssoNormalizedIdentityService.upsertIdentity({
      tenantId: 'tenant-a',
      providerId: 'provider-1',
      providerType: 'saml',
      providerSubject: 'subject-1',
      subjectClaim: 'name_id',
      providerTenantId: 'idp-tenant',
      userId: 'user-1',
      email: 'USER@example.com',
      displayName: 'User One',
      firstName: 'User',
      lastName: 'One',
      claims: {
        email: 'user@example.com',
        groups: ['ops', 'ops', 'deployers'],
        roles: ['operator'],
        department: 'engineering',
      },
      now: 1234,
    });

    expect(result).toEqual({ id: expect.any(String), created: true, groupMembershipsCreated: 0, groupMembershipsRemoved: 0 });
    expect(qb.where).toHaveBeenCalledWith('identity.providerId = :providerId', { providerId: 'provider-1' });
    expect(qb.andWhere).toHaveBeenCalledWith('identity.providerSubject = :providerSubject', { providerSubject: 'subject-1' });
    expect(qb.andWhere).toHaveBeenCalledWith('identity.tenantId = :tenantId', { tenantId: 'tenant-a' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      providerId: 'provider-1',
      providerType: 'saml',
      providerSubject: 'subject-1',
      subjectClaim: 'name_id',
      providerTenantId: 'idp-tenant',
      userId: 'user-1',
      email: 'user@example.com',
      groupsJson: JSON.stringify(['deployers', 'ops']),
      rolesJson: JSON.stringify(['operator']),
      claimsJson: JSON.stringify({ groups: ['deployers', 'ops'], roles: ['operator'] }),
      providerStatus: 'active',
      lastSeenAt: 1234,
      lastProviderCheckAt: null,
      createdAt: 1234,
      updatedAt: 1234,
    }));
    expect(update).not.toHaveBeenCalled();
    expect(externalRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a', directoryTenantId: 'idp-tenant', providerId: 'provider-1', subjectId: 'subject-1', userId: 'user-1', emailHint: 'user@example.com', identityKey: expect.any(String),
    }));
    expect(syncMembershipsInStore).toHaveBeenCalledWith(dataSource, 'user-1', 'tenant-a', expect.objectContaining({ providerKey: 'provider-1', providerType: 'saml' }));
  });

  it('updates an existing normalized identity snapshot by provider subject', async () => {
    const getOne = vi.fn().mockResolvedValue({ id: 'identity-1' });
    const qb = {
      where: vi.fn(() => qb),
      andWhere: vi.fn(() => qb),
      getOne,
    };
    const insert = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue(undefined);
    const repo = {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
      insert,
      update,
    };
    const externalRepo = { findOne: vi.fn().mockResolvedValue({ id: 'external-identity-1', userId: 'user-1' }), insert: vi.fn(), update: vi.fn().mockResolvedValue(undefined) };
    const dataSource = {
      getRepository: vi.fn((entity: unknown) => {
        if (entity === SsoNormalizedIdentity) return repo;
        if (entity === ExternalIdentity) return externalRepo;
        throw new Error('Unexpected repository');
      }),
    };
    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    const result = await ssoNormalizedIdentityService.upsertIdentity({
      providerId: 'microsoft',
      providerType: 'microsoft',
      providerSubject: 'oid-1',
      subjectClaim: 'oid',
      userId: 'user-1',
      email: 'user@example.com',
      claims: {
        email: 'user@example.com',
        groups: ['engines'],
        roles: ['deployer'],
      },
      now: 5678,
    });

    expect(result).toEqual({ id: 'identity-1', created: false, groupMembershipsCreated: 0, groupMembershipsRemoved: 0 });
    expect(qb.andWhere).toHaveBeenCalledWith('identity.tenantId IS NULL');
    expect(update).toHaveBeenCalledWith({ id: 'identity-1' }, expect.objectContaining({
      providerId: 'microsoft',
      providerType: 'microsoft',
      providerSubject: 'oid-1',
      userId: 'user-1',
      groupsJson: JSON.stringify(['engines']),
      rolesJson: JSON.stringify(['deployer']),
      lastSeenAt: 5678,
      updatedAt: 5678,
    }));
    expect(insert).not.toHaveBeenCalled();
    expect(externalRepo.update).toHaveBeenCalledWith({ id: 'external-identity-1' }, expect.objectContaining({
      providerId: 'microsoft', subjectId: 'oid-1', userId: 'user-1', lastSeenAt: 5678,
    }));
    expect(syncMembershipsInStore).toHaveBeenCalledWith(dataSource, 'user-1', null, expect.objectContaining({ providerKey: 'microsoft', providerType: 'oidc' }));
  });

  it('replays stored normalized identities without contacting the external provider', async () => {
    const getMany = vi.fn().mockResolvedValue([
      { id: 'identity-1', tenantId: 'tenant-a', providerId: 'provider-1', providerType: 'oidc', providerSubject: 'subject-1', providerTenantId: null, userId: 'user-1', email: 'user@example.com', claimsJson: JSON.stringify({ groups: ['ops'] }), providerStatus: 'active', lastSeenAt: 1234 },
      { id: 'identity-2', tenantId: 'tenant-a', providerId: 'provider-1', providerType: 'oidc', providerSubject: 'subject-2', providerTenantId: null, userId: 'user-2', email: 'user2@example.com', claimsJson: '{invalid', providerStatus: 'active', lastSeenAt: 1235 },
    ]);
    const qb = { where: vi.fn(), andWhere: vi.fn(), orderBy: vi.fn(), addOrderBy: vi.fn(), take: vi.fn(), getMany } as any;
    qb.where.mockReturnValue(qb); qb.andWhere.mockReturnValue(qb); qb.orderBy.mockReturnValue(qb); qb.addOrderBy.mockReturnValue(qb); qb.take.mockReturnValue(qb);
    const dataSource = { getRepository: vi.fn(() => ({ createQueryBuilder: vi.fn(() => qb) })) };
    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);
    syncMembershipsInStore
      .mockResolvedValueOnce({ created: 1, removed: 0 })
      .mockResolvedValueOnce({ created: 0, removed: 1 });

    const result = await ssoNormalizedIdentityService.replayMemberships({ tenantId: 'tenant-a', providerIds: ['provider-1'], limit: 1 });

    expect(result).toMatchObject({ scanned: 1, created: 1, removed: 0, failed: 0, truncated: true, nextCursor: expect.any(String) });
    expect(qb.take).toHaveBeenCalledWith(2);
    expect(syncMembershipsInStore).toHaveBeenCalledWith(dataSource, 'user-1', 'tenant-a', expect.objectContaining({ providerKey: 'provider-1', entitlements: expect.any(Array) }));
  });

  it('previews stored snapshot membership changes without persistence or identity details', async () => {
    const getMany = vi.fn().mockResolvedValue([
      { id: 'identity-1', tenantId: 'tenant-a', providerId: 'provider-1', providerType: 'oidc', providerSubject: 'subject-1', providerTenantId: null, userId: 'user-1', email: 'user@example.com', claimsJson: JSON.stringify({ groups: ['operators'] }), providerStatus: 'active', lastSeenAt: 1234 },
    ]);
    const qb = { where: vi.fn(), andWhere: vi.fn(), orderBy: vi.fn(), addOrderBy: vi.fn(), take: vi.fn(), getMany } as any;
    qb.where.mockReturnValue(qb); qb.andWhere.mockReturnValue(qb); qb.orderBy.mockReturnValue(qb); qb.addOrderBy.mockReturnValue(qb); qb.take.mockReturnValue(qb);
    const mappingRepo = { find: vi.fn().mockResolvedValue([
      { id: 'mapping-add', tenantId: 'tenant-a', providerId: 'provider-1', targetGroupId: 'group-operators', entitlementType: 'group', externalId: 'operators', matchOperator: 'exact', syncMode: 'authoritative', isActive: true },
      { id: 'mapping-remove', tenantId: 'tenant-a', providerId: 'provider-1', targetGroupId: 'group-admins', entitlementType: 'group', externalId: 'admins', matchOperator: 'exact', syncMode: 'authoritative', isActive: true },
    ]) };
    const membershipRepo = { find: vi.fn().mockResolvedValue([
      { tenantId: 'tenant-a', userId: 'user-1', groupId: 'group-admins', source: 'identity_provider', sourceRef: 'identity_mapping:mapping-remove' },
    ]) };
    const dataSource = {
      getRepository: vi.fn((entity: unknown) => {
        if (entity === SsoNormalizedIdentity) return { createQueryBuilder: vi.fn(() => qb) };
        if (entity === IdentityEntitlementMapping) return mappingRepo;
        if (entity === AuthzGroupMembership) return membershipRepo;
        throw new Error('Unexpected repository');
      }),
    };
    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    const result = await ssoNormalizedIdentityService.previewMemberships({ tenantId: 'tenant-a', providerId: 'provider-1' });

    expect(result).toEqual({
      scanned: 1, additions: 1, removals: 1, unchanged: 0, failed: 0, truncated: false, nextCursor: null,
      latestSnapshotAt: 1234, warnings: ['stored_snapshots_only'],
      mappings: [
        { mappingId: 'mapping-add', targetGroupId: 'group-operators', additions: 1, removals: 0, unchanged: 0 },
        { mappingId: 'mapping-remove', targetGroupId: 'group-admins', additions: 0, removals: 1, unchanged: 0 },
      ],
    });
    expect(result).not.toHaveProperty('identities');
    expect(syncMembershipsInStore).not.toHaveBeenCalled();
    expect(qb.take).toHaveBeenCalledWith(501);
  });
});
