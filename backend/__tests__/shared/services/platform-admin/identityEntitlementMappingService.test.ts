import { describe, expect, it } from 'vitest';
import { identityProviderMembershipSourceRef, matchesIdentityEntitlement, identityEntitlementMappingService } from '@enterpriseglue/shared/services/platform-admin/IdentityEntitlementMappingService.js';
import { authorizationAttributeEntitlementId } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderAdapter.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroup, AuthzGroupMembership, IdentityEntitlementMapping, IdentityProvider, SsoNormalizedIdentity } from '@enterpriseglue/shared/db/entities/index.js';
import { vi, type Mock } from 'vitest';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

const identity = { providerKey: 'entra', providerType: 'oidc' as const, subjectId: 'u1', observedAt: 1, entitlements: [{ type: 'authenticated' as const, externalId: 'authenticated' }, { type: 'group' as const, externalId: 'group-prod' }, { type: 'role' as const, externalId: 'operator' }] };
describe('identity entitlement mapping', () => {
  it('matches exact, contains, and exists mappings only within the declared entitlement type', () => {
    expect(matchesIdentityEntitlement({ entitlementType: 'group', externalId: 'group-prod', matchOperator: 'exact' }, identity)).toBe(true);
    expect(matchesIdentityEntitlement({ entitlementType: 'group', externalId: 'prod', matchOperator: 'contains' }, identity)).toBe(true);
    expect(matchesIdentityEntitlement({ entitlementType: 'scope', matchOperator: 'exists' }, identity)).toBe(false);
    expect(matchesIdentityEntitlement({ entitlementType: 'authenticated', externalId: 'authenticated', matchOperator: 'exact' }, identity)).toBe(true);
  });

  it('matches LDAP group access by immutable id rather than a mutable display name', () => {
    const mapping = { entitlementType: 'group' as const, externalId: 'group-uuid-1', matchOperator: 'exact' as const };
    const renamedGroup = {
      providerKey: 'ldap', providerType: 'ldap' as const, subjectId: 'subject-1', observedAt: 1,
      entitlements: [{ type: 'group' as const, externalId: 'group-uuid-1' }],
    };
    const reusedDisplayName = {
      ...renamedGroup,
      entitlements: [{ type: 'group' as const, externalId: 'group-uuid-2' }],
    };

    expect(matchesIdentityEntitlement(mapping, renamedGroup)).toBe(true);
    expect(matchesIdentityEntitlement(mapping, reusedDisplayName)).toBe(false);
  });

  it('matches duplicate normalized group, role, and allowlisted attribute entitlements without creating duplicate memberships', async () => {
    const attributeId = authorizationAttributeEntitlementId('clearance', 'release');
    const mappings = [
      { id: 'group-mapping', providerId: 'entra', entitlementType: 'group', externalId: 'group-prod', matchOperator: 'exact', targetGroupId: 'group-1', syncMode: 'authoritative', isActive: true },
      { id: 'role-mapping', providerId: 'entra', entitlementType: 'role', externalId: 'operator', matchOperator: 'exact', targetGroupId: 'group-2', syncMode: 'authoritative', isActive: true },
      { id: 'attribute-mapping', providerId: 'entra', entitlementType: 'attribute', externalId: attributeId, matchOperator: 'exact', targetGroupId: 'group-3', syncMode: 'authoritative', isActive: true },
      { id: 'no-match', providerId: 'entra', entitlementType: 'group', externalId: 'not-present', matchOperator: 'exact', targetGroupId: 'group-4', syncMode: 'authoritative', isActive: true },
    ];
    const membershipRepo = { findOne: vi.fn().mockResolvedValue(null), insert: vi.fn().mockResolvedValue(undefined), delete: vi.fn() };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === IdentityEntitlementMapping ? { find: vi.fn().mockResolvedValue(mappings) }
        : entity === AuthzGroupMembership ? membershipRepo
          : {},
    });

    await expect(identityEntitlementMappingService.syncMemberships('user-1', 'tenant-a', {
      providerKey: 'entra', providerType: 'oidc', subjectId: 'subject-1', observedAt: 1,
      entitlements: [
        { type: 'group', externalId: 'group-prod' }, { type: 'group', externalId: 'group-prod' },
        { type: 'role', externalId: 'operator' }, { type: 'attribute', externalId: attributeId },
      ],
    })).resolves.toEqual({ created: 3, removed: 0 });

    expect(membershipRepo.insert).toHaveBeenCalledTimes(3);
    expect(membershipRepo.insert).not.toHaveBeenCalledWith(expect.objectContaining({ groupId: 'group-4' }));
  });

  it('previews aggregate proposed mapping matches from stored snapshots only', async () => {
    const providerRepo = { findOne: vi.fn().mockResolvedValue({ id: 'provider-1', key: 'identity.oidc.main', protocol: 'oidc' }) };
    const snapshotRepo = { find: vi.fn().mockResolvedValue([
      { providerSubject: 'subject-1', email: 'user@example.test', providerTenantId: null, claimsJson: JSON.stringify({ groups: ['operators'] }), lastSeenAt: 100 },
      { providerSubject: 'subject-2', email: 'user2@example.test', providerTenantId: null, claimsJson: JSON.stringify({ groups: ['viewers'] }), lastSeenAt: 101 },
    ]) };
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => entity === IdentityProvider ? providerRepo : entity === SsoNormalizedIdentity ? snapshotRepo : {} });

    const result = await identityEntitlementMappingService.previewStoredSnapshots({ providerKey: 'identity.oidc.main', entitlementType: 'group', externalId: 'operators', matchOperator: 'exact' }, 'tenant-a');

    expect(result).toEqual({ scanned: 2, matches: 1, nonMatches: 1, failed: 0, truncated: false, latestSnapshotAt: 101, warnings: ['stored_snapshots_only'] });
    expect(result).not.toHaveProperty('identities');
  });

  it('keeps stored-snapshot previews and ad-hoc mapping tests side-effect free', async () => {
    const providerRepo = {
      findOne: vi.fn().mockResolvedValue({ id: 'provider-1', key: 'identity.oidc.main', protocol: 'oidc' }),
      insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const snapshotRepo = {
      find: vi.fn().mockResolvedValue([{ providerSubject: 'subject-1', email: 'user@example.test', providerTenantId: null, claimsJson: JSON.stringify({ groups: ['operators'] }), lastSeenAt: 100 }]),
      insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const transaction = vi.fn();
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === IdentityProvider ? providerRepo : entity === SsoNormalizedIdentity ? snapshotRepo : {},
      transaction,
    });

    await expect(identityEntitlementMappingService.previewStoredSnapshots({
      providerKey: 'identity.oidc.main', entitlementType: 'group', externalId: 'operators', matchOperator: 'exact',
    }, 'tenant-a')).resolves.toMatchObject({ scanned: 1, matches: 1 });
    await expect(identityEntitlementMappingService.test({
      providerKey: 'identity.oidc.main', entitlementType: 'group', externalId: 'operators', matchOperator: 'exact',
      claims: { sub: 'preview-subject', groups: ['operators'] },
    }, 'tenant-a')).resolves.toMatchObject({ matches: true });

    expect(transaction).not.toHaveBeenCalled();
    for (const repo of [providerRepo, snapshotRepo]) {
      expect(repo.insert).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
      expect(repo.delete).not.toHaveBeenCalled();
    }
  });

  it('rejects OAuth scopes as a human identity-mapping source before inspecting snapshots', async () => {
    await expect(identityEntitlementMappingService.previewStoredSnapshots({
      providerKey: 'identity.oidc.main', entitlementType: 'scope', externalId: 'engines.read', matchOperator: 'exact',
    }, 'tenant-a')).rejects.toThrow('OAuth scopes cannot be used for human identity mappings');
  });

  it('rejects identity mappings that reference a provider or group outside the requested tenant', async () => {
    const mappingRepo = { insert: vi.fn() };
    const providerRepo = { findOne: vi.fn().mockResolvedValue(null) };
    const groupRepo = { findOne: vi.fn().mockResolvedValue(null) };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === IdentityProvider ? providerRepo
        : entity === AuthzGroup ? groupRepo
          : entity === IdentityEntitlementMapping ? mappingRepo
            : {},
    });

    await expect(identityEntitlementMappingService.create({
      providerKey: 'foreign-provider', targetGroupKey: 'foreign-group', entitlementType: 'group', externalId: 'operators', matchOperator: 'exact',
    }, 'tenant-a')).rejects.toThrow('Identity provider not found');

    for (const repo of [providerRepo, groupRepo]) {
      expect(repo.findOne).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-a' }),
      }));
    }
    expect(mappingRepo.insert).not.toHaveBeenCalled();
  });

  it('removes legacy scope-derived memberships regardless of their prior sync mode', async () => {
    const mappingRepo = { find: vi.fn().mockResolvedValue([{ id: 'legacy-scope', providerId: 'entra', entitlementType: 'scope', externalId: 'engines.read', matchOperator: 'exact', targetGroupId: 'group-1', syncMode: 'additive', isActive: true }]) };
    const membershipRepo = { findOne: vi.fn().mockResolvedValue({ id: 'membership-1', userId: 'user-1', groupId: 'group-1', source: 'identity_provider', sourceRef: identityProviderMembershipSourceRef('entra', 'legacy-scope') }), insert: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) };
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => entity === IdentityEntitlementMapping ? mappingRepo : entity === AuthzGroupMembership ? membershipRepo : {} });

    await expect(identityEntitlementMappingService.syncMemberships('user-1', 'tenant-a', identity)).resolves.toEqual({ created: 0, removed: 1 });
    expect(membershipRepo.insert).not.toHaveBeenCalled();
    expect(membershipRepo.delete).toHaveBeenCalledWith({ id: 'membership-1' });
  });

  it('reconciles only provider-owned memberships for the matching mapping', async () => {
    const mappingRepo = { find: vi.fn().mockResolvedValue([{ id: 'mapping-1', providerId: 'entra', entitlementType: 'group', externalId: 'group-prod', matchOperator: 'exact', targetGroupId: 'group-1', syncMode: 'authoritative', isActive: true }]) };
    const membershipRepo = { findOne: vi.fn().mockResolvedValue(null), insert: vi.fn().mockResolvedValue(undefined), delete: vi.fn() };
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => entity === IdentityEntitlementMapping ? mappingRepo : entity === AuthzGroupMembership ? membershipRepo : {} });
    await expect(identityEntitlementMappingService.syncMemberships('user-1', 'tenant-a', identity)).resolves.toEqual({ created: 1, removed: 0 });
    expect(membershipRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', groupId: 'group-1', source: 'identity_provider', sourceRef: identityProviderMembershipSourceRef('entra', 'mapping-1') }));
  });

  it('preserves additive, cross-provider, and manual memberships while authoritative sync removes only its stale row', async () => {
    const mappings = [
      { id: 'mapping-a-additive', providerId: 'provider-a', entitlementType: 'group', externalId: 'additive-group', matchOperator: 'exact', targetGroupId: 'group-shared', syncMode: 'additive', isActive: true },
      { id: 'mapping-a-authoritative', providerId: 'provider-a', entitlementType: 'group', externalId: 'authoritative-group', matchOperator: 'exact', targetGroupId: 'group-shared', syncMode: 'authoritative', isActive: true },
      { id: 'mapping-b-authoritative', providerId: 'provider-b', entitlementType: 'group', externalId: 'other-provider-group', matchOperator: 'exact', targetGroupId: 'group-shared', syncMode: 'authoritative', isActive: true },
    ];
    const memberships = [
      { id: 'membership-a-additive', userId: 'user-1', groupId: 'group-shared', source: 'identity_provider', sourceRef: 'identity_mapping:mapping-a-additive' },
      { id: 'membership-a-authoritative', userId: 'user-1', groupId: 'group-shared', source: 'identity_provider', sourceRef: 'identity_mapping:mapping-a-authoritative' },
      { id: 'membership-b-authoritative', userId: 'user-1', groupId: 'group-shared', source: 'identity_provider', sourceRef: 'identity_mapping:mapping-b-authoritative' },
      { id: 'membership-manual', userId: 'user-1', groupId: 'group-shared', source: 'manual', sourceRef: null },
    ];
    const mappingRepo = { find: vi.fn().mockResolvedValue(mappings) };
    const membershipRepo = {
      findOne: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(memberships.find((membership) =>
        membership.userId === where.userId
        && membership.groupId === where.groupId
        && membership.source === where.source
        && membership.sourceRef === where.sourceRef
      ) || null)),
      insert: vi.fn(),
      delete: vi.fn().mockImplementation(({ id }: { id: string }) => {
        const index = memberships.findIndex((membership) => membership.id === id);
        if (index >= 0) memberships.splice(index, 1);
        return Promise.resolve(undefined);
      }),
    };
    const store = {
      getRepository: (entity: unknown) => entity === IdentityEntitlementMapping ? mappingRepo : entity === AuthzGroupMembership ? membershipRepo : {},
    } as any;
    const identityWithoutGroups = {
      providerKey: 'provider-a', providerType: 'oidc' as const, subjectId: 'subject-1', observedAt: 1,
      entitlements: [{ type: 'authenticated' as const, externalId: 'authenticated' }],
    };

    await expect(identityEntitlementMappingService.syncMembershipsInStore(store, 'user-1', 'tenant-a', identityWithoutGroups))
      .resolves.toEqual({ created: 0, removed: 1 });

    expect(membershipRepo.delete).toHaveBeenCalledOnce();
    expect(membershipRepo.delete).toHaveBeenCalledWith({ id: 'membership-a-authoritative' });
    expect(memberships.map((membership) => membership.id)).toEqual([
      'membership-a-additive',
      'membership-b-authoritative',
      'membership-manual',
    ]);
    expect(membershipRepo.findOne).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sourceRef: 'identity_mapping:mapping-b-authoritative' }),
    }));
  });

  it('removes only memberships created by a manually managed mapping', async () => {
    const mappingRepo = { findOne: vi.fn().mockResolvedValue({ id: 'mapping-1', providerId: 'provider-1', sourceRef: null }), delete: vi.fn().mockResolvedValue(undefined) };
    const membershipRepo = { delete: vi.fn().mockResolvedValue(undefined) };
    const repositories = (entity: unknown) => entity === IdentityEntitlementMapping ? mappingRepo : entity === AuthzGroupMembership ? membershipRepo : {};
    (getDataSource as unknown as Mock).mockResolvedValue({ transaction: vi.fn(async (callback: any) => callback({ getRepository: repositories })) });
    await identityEntitlementMappingService.remove('mapping-1', 'tenant-a');
    expect(membershipRepo.delete).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', source: 'identity_provider' }));
    expect(membershipRepo.delete.mock.calls[0][0].sourceRef.value).toEqual([
      identityProviderMembershipSourceRef('provider-1', 'mapping-1'), 'identity_mapping:mapping-1',
    ]);
    expect(mappingRepo.delete).toHaveBeenCalledWith({ id: 'mapping-1' });
  });

  it('cleans only its derived memberships when a manual mapping is disabled', async () => {
    const existing = {
      id: 'mapping-1', tenantId: 'tenant-a', providerId: 'provider-1', targetGroupId: 'group-1', entitlementType: 'group',
      externalId: 'ops', matchOperator: 'exact', syncMode: 'authoritative', isActive: true, sourceRef: null,
    };
    const mappingRepo = {
      findOne: vi.fn().mockResolvedValue(existing),
      find: vi.fn().mockResolvedValue([existing]),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const providerRepo = {
      find: vi.fn().mockResolvedValue([{ id: 'provider-1', key: 'identity.oidc.main' }]),
      findOne: vi.fn().mockResolvedValue({ id: 'provider-1', key: 'identity.oidc.main' }),
    };
    const groupRepo = {
      find: vi.fn().mockResolvedValue([{ id: 'group-1', key: 'group.operators' }]),
      findOne: vi.fn().mockResolvedValue({ id: 'group-1', key: 'group.operators' }),
    };
    const membershipRepo = { delete: vi.fn().mockResolvedValue(undefined) };
    const repositories = (entity: unknown) => entity === IdentityEntitlementMapping ? mappingRepo
      : entity === IdentityProvider ? providerRepo
        : entity === AuthzGroupMembership ? membershipRepo
          : entity === AuthzGroup ? groupRepo
            : {};
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: repositories,
      transaction: vi.fn(async (callback: any) => callback({ getRepository: repositories })),
    });

    await identityEntitlementMappingService.update('mapping-1', { isActive: false }, 'tenant-a');

    expect(membershipRepo.delete).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', source: 'identity_provider' }));
    expect(membershipRepo.delete.mock.calls[0][0].sourceRef.value).toEqual([
      identityProviderMembershipSourceRef('provider-1', 'mapping-1'), 'identity_mapping:mapping-1',
    ]);
    expect(mappingRepo.update).toHaveBeenCalledWith({ id: 'mapping-1' }, expect.objectContaining({ isActive: false }));
  });

  it('normalizes a legacy mapping-only membership reference after the matching provider sync', async () => {
    const mappingRepo = { find: vi.fn().mockResolvedValue([{
      id: 'mapping-1', providerId: 'provider-1', entitlementType: 'group', externalId: 'group-prod', matchOperator: 'exact', targetGroupId: 'group-1', syncMode: 'authoritative', isActive: true,
    }]) };
    const legacyMembership = { id: 'membership-1', userId: 'user-1', groupId: 'group-1', source: 'identity_provider', sourceRef: 'identity_mapping:mapping-1' };
    const membershipRepo = {
      findOne: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(legacyMembership),
      insert: vi.fn(), update: vi.fn().mockResolvedValue(undefined), delete: vi.fn(),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => entity === IdentityEntitlementMapping ? mappingRepo : entity === AuthzGroupMembership ? membershipRepo : {} });

    await expect(identityEntitlementMappingService.syncMemberships('user-1', 'tenant-a', {
      ...identity, providerKey: 'provider-1',
    })).resolves.toEqual({ created: 0, removed: 0 });

    expect(membershipRepo.insert).not.toHaveBeenCalled();
    expect(membershipRepo.update).toHaveBeenCalledWith({ id: 'membership-1' }, expect.objectContaining({
      sourceRef: identityProviderMembershipSourceRef('provider-1', 'mapping-1'),
    }));
  });
});
