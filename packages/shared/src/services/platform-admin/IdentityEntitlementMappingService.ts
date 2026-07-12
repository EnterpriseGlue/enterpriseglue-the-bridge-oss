import { ExternalEntitlement, NormalizedExternalIdentity } from './IdentityProviderAdapter.js';

export type IdentityEntitlementMatchOperator = 'exact' | 'contains' | 'exists';

export interface IdentityEntitlementMappingMatch {
  entitlementType: ExternalEntitlement['type'];
  externalId?: string | null;
  matchOperator: IdentityEntitlementMatchOperator;
}

export function matchesIdentityEntitlement(mapping: IdentityEntitlementMappingMatch, identity: NormalizedExternalIdentity): boolean {
  const candidates = identity.entitlements.filter((entitlement) => entitlement.type === mapping.entitlementType);
  if (mapping.matchOperator === 'exists') return candidates.length > 0;
  const expected = mapping.externalId?.trim();
  if (!expected) return false;
  return candidates.some((candidate) => mapping.matchOperator === 'exact'
    ? candidate.externalId === expected
    : candidate.externalId.includes(expected));
}
