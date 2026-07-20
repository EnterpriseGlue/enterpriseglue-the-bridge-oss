import type { AuthzGroupMembership, IdentityEntitlementMapping } from '../../hooks/useAuthzApi';

export function findIdentityEntitlementMappingForMembership(membership: AuthzGroupMembership, mappings: IdentityEntitlementMapping[]) {
  const mappingId = membership.source === 'identity_provider' && membership.sourceRef?.startsWith('identity_mapping:')
    ? membership.sourceRef.slice('identity_mapping:'.length)
    : null;
  return mappingId ? mappings.find((mapping) => mapping.id === mappingId) || null : null;
}

export function joinLineageParts(parts: Array<string | null | undefined>) {
  const filtered = parts.filter((part): part is string => Boolean(part && part !== '-'));
  return filtered.length ? filtered.join('; ') : '-';
}
