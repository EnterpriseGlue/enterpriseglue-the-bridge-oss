import type {
  AuthzGroupMembership,
  IdentityEntitlementMapping,
  SsoAssignmentMapping,
  SsoGroupMapping,
  RoleAssignment,
} from '../../hooks/useAuthzApi';

function sourceRefMappingId(sourceRef: string | null | undefined) {
  if (!sourceRef) return null;
  return sourceRef.includes(':') ? sourceRef.split(':').pop() || sourceRef : sourceRef;
}

export function findSsoAssignmentMappingForAssignment(assignment: RoleAssignment, mappings: SsoAssignmentMapping[]) {
  const mappingId = assignment.sourceMappingId || sourceRefMappingId(assignment.sourceRef);
  return mappingId ? mappings.find((mapping) => mapping.id === mappingId) || null : null;
}

export function findSsoGroupMappingForMembership(membership: AuthzGroupMembership, mappings: SsoGroupMapping[]) {
  const mappingId = sourceRefMappingId(membership.sourceRef);
  if (mappingId) {
    const exact = mappings.find((mapping) => mapping.id === mappingId);
    if (exact) return exact;
  }
  return membership.source === 'sso'
    ? mappings.find((mapping) => mapping.isActive && mapping.targetGroupId === membership.groupId) || null
    : null;
}

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
