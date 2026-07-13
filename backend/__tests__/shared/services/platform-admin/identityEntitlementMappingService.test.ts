import { describe, expect, it } from 'vitest';
import { matchesIdentityEntitlement, identityEntitlementMappingService } from '@enterpriseglue/shared/services/platform-admin/IdentityEntitlementMappingService.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroupMembership, IdentityEntitlementMapping, IdentityProvider, SsoNormalizedIdentity } from '@enterpriseglue/shared/db/entities/index.js';
import { vi, type Mock } from 'vitest';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

const identity = { providerKey: 'entra', providerType: 'oidc' as const, subjectId: 'u1', observedAt: 1, entitlements: [{ type: 'group' as const, externalId: 'group-prod' }, { type: 'role' as const, externalId: 'operator' }] };
describe('identity entitlement mapping', () => {
  it('matches exact, contains, and exists mappings only within the declared entitlement type', () => {
    expect(matchesIdentityEntitlement({ entitlementType: 'group', externalId: 'group-prod', matchOperator: 'exact' }, identity)).toBe(true);
    expect(matchesIdentityEntitlement({ entitlementType: 'group', externalId: 'prod', matchOperator: 'contains' }, identity)).toBe(true);
    expect(matchesIdentityEntitlement({ entitlementType: 'scope', matchOperator: 'exists' }, identity)).toBe(false);
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

  it('reconciles only provider-owned memberships for the matching mapping', async () => {
    const mappingRepo = { find: vi.fn().mockResolvedValue([{ id: 'mapping-1', providerId: 'entra', entitlementType: 'group', externalId: 'group-prod', matchOperator: 'exact', targetGroupId: 'group-1', syncMode: 'authoritative', isActive: true }]) };
    const membershipRepo = { findOne: vi.fn().mockResolvedValue(null), insert: vi.fn().mockResolvedValue(undefined), delete: vi.fn() };
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => entity === IdentityEntitlementMapping ? mappingRepo : entity === AuthzGroupMembership ? membershipRepo : {} });
    await expect(identityEntitlementMappingService.syncMemberships('user-1', 'tenant-a', identity)).resolves.toEqual({ created: 1, removed: 0 });
    expect(membershipRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', groupId: 'group-1', source: 'identity_provider', sourceRef: 'identity_mapping:mapping-1' }));
  });

  it('removes only memberships created by a manually managed mapping', async () => {
    const mappingRepo = { findOne: vi.fn().mockResolvedValue({ id: 'mapping-1', sourceRef: null }), delete: vi.fn().mockResolvedValue(undefined) };
    const membershipRepo = { delete: vi.fn().mockResolvedValue(undefined) };
    const repositories = (entity: unknown) => entity === IdentityEntitlementMapping ? mappingRepo : entity === AuthzGroupMembership ? membershipRepo : {};
    (getDataSource as unknown as Mock).mockResolvedValue({ transaction: vi.fn(async (callback: any) => callback({ getRepository: repositories })) });
    await identityEntitlementMappingService.remove('mapping-1', 'tenant-a');
    expect(membershipRepo.delete).toHaveBeenCalledWith({ source: 'identity_provider', sourceRef: 'identity_mapping:mapping-1' });
    expect(mappingRepo.delete).toHaveBeenCalledWith({ id: 'mapping-1' });
  });
});
