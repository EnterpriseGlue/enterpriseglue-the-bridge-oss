import { describe, expect, it } from 'vitest';
import { matchesIdentityEntitlement } from '@enterpriseglue/shared/services/platform-admin/IdentityEntitlementMappingService.js';

const identity = { providerKey: 'entra', providerType: 'oidc' as const, subjectId: 'u1', observedAt: 1, entitlements: [{ type: 'group' as const, externalId: 'group-prod' }, { type: 'role' as const, externalId: 'operator' }] };
describe('identity entitlement mapping', () => {
  it('matches exact, contains, and exists mappings only within the declared entitlement type', () => {
    expect(matchesIdentityEntitlement({ entitlementType: 'group', externalId: 'group-prod', matchOperator: 'exact' }, identity)).toBe(true);
    expect(matchesIdentityEntitlement({ entitlementType: 'group', externalId: 'prod', matchOperator: 'contains' }, identity)).toBe(true);
    expect(matchesIdentityEntitlement({ entitlementType: 'scope', matchOperator: 'exists' }, identity)).toBe(false);
  });
});
