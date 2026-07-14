import { describe, expect, it } from 'vitest';
import { identityProviderMembershipSourceRef, matchesIdentityEntitlement, identityEntitlementMappingService } from '@enterpriseglue/shared/services/platform-admin/IdentityEntitlementMappingService.js';
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

  it('rejects OAuth scopes as a human identity-mapping source before inspecting snapshots', async () => {
    await expect(identityEntitlementMappingService.previewStoredSnapshots({
      providerKey: 'identity.oidc.main', entitlementType: 'scope', externalId: 'engines.read', matchOperator: 'exact',
    }, 'tenant-a')).rejects.toThrow('OAuth scopes cannot be used for human identity mappings');
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
