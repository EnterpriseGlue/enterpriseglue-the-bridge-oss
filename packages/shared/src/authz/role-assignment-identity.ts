/**
 * Stable identity for a scoped role assignment. It deliberately includes all
 * authorization inputs and avoids nullable SQL unique-constraint semantics.
 */
export interface CanonicalRoleAssignmentIdentity {
  tenantId?: string | null;
  principalType: string;
  principalId: string;
  roleId: string;
  scopeType: string;
  scopeId?: string | null;
  source: string;
  sourceRef?: string | null;
}

export function normalizeRoleAssignmentSourceRef(value?: string | null): string {
  return value || '';
}

function encode(value?: string | null): string {
  const normalized = value || '';
  return `${normalized.length}:${normalized}`;
}

export function canonicalRoleAssignmentKey(identity: CanonicalRoleAssignmentIdentity): string {
  return [
    identity.tenantId,
    identity.principalType,
    identity.principalId,
    identity.roleId,
    identity.scopeType,
    identity.scopeId,
    identity.source,
    normalizeRoleAssignmentSourceRef(identity.sourceRef),
  ].map(encode).join('|');
}
