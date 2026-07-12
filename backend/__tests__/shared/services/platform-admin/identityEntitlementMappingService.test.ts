import { describe, expect, it } from 'vitest';
import { matchesIdentityEntitlement, identityEntitlementMappingService } from '@enterpriseglue/shared/services/platform-admin/IdentityEntitlementMappingService.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroupMembership, IdentityEntitlementMapping } from '@enterpriseglue/shared/db/entities/index.js';
import { vi, type Mock } from 'vitest';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

const identity = { providerKey: 'entra', providerType: 'oidc' as const, subjectId: 'u1', observedAt: 1, entitlements: [{ type: 'group' as const, externalId: 'group-prod' }, { type: 'role' as const, externalId: 'operator' }] };
describe('identity entitlement mapping', () => {
  it('matches exact, contains, and exists mappings only within the declared entitlement type', () => {
    expect(matchesIdentityEntitlement({ entitlementType: 'group', externalId: 'group-prod', matchOperator: 'exact' }, identity)).toBe(true);
    expect(matchesIdentityEntitlement({ entitlementType: 'group', externalId: 'prod', matchOperator: 'contains' }, identity)).toBe(true);
    expect(matchesIdentityEntitlement({ entitlementType: 'scope', matchOperator: 'exists' }, identity)).toBe(false);
  });

  it('reconciles only provider-owned memberships for the matching mapping', async () => {
    const mappingRepo = { find: vi.fn().mockResolvedValue([{ id: 'mapping-1', providerId: 'entra', entitlementType: 'group', externalId: 'group-prod', matchOperator: 'exact', targetGroupId: 'group-1', syncMode: 'authoritative', isActive: true }]) };
    const membershipRepo = { findOne: vi.fn().mockResolvedValue(null), insert: vi.fn().mockResolvedValue(undefined), delete: vi.fn() };
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => entity === IdentityEntitlementMapping ? mappingRepo : entity === AuthzGroupMembership ? membershipRepo : {} });
    await expect(identityEntitlementMappingService.syncMemberships('user-1', 'tenant-a', identity)).resolves.toEqual({ created: 1, removed: 0 });
    expect(membershipRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', groupId: 'group-1', source: 'identity_provider', sourceRef: 'identity_mapping:mapping-1' }));
  });
});
