import React from 'react';
import { Button } from '@carbon/react';
import type {
  AuthzAuditEntry,
  AuthzGroupMembership,
  EffectiveAccessResult,
  IdentityEntitlementMapping,
  RoleAssignment,
} from '../../hooks/useAuthzApi';

type EffectiveAccessSource = EffectiveAccessResult['sources'][number];

function context(entry: AuthzAuditEntry): Record<string, unknown> {
  if (!entry.context) return {};
  try { const parsed = JSON.parse(entry.context); return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}
function references(entry: AuthzAuditEntry, values: Array<string | null | undefined>) {
  const raw = entry.context || '';
  const parsed = context(entry);
  return values.filter(Boolean).some((value) => entry.resourceId === String(value) || Object.values(parsed).some((item) => String(item) === String(value)) || raw.includes(String(value)));
}
function mutating(action: string) { return /\.(create|update|delete|remove|archive|enable|disable|sync|cleanup|reconcile|acknowledge|rotate|revoke)\b/.test(action); }
function formatTimestamp(value: number | null | undefined) { return value ? new Date(value).toLocaleString() : '-'; }

export function findAssignmentAuditEntries(
  assignment: RoleAssignment,
  entries: AuthzAuditEntry[],
) {
  const ids = [assignment.id, assignment.sourceRef].filter(Boolean);
  return entries.filter((entry) => {
    if (!mutating(entry.action)) return false;
    if (entry.resourceType === 'role_assignment' && references(entry, [assignment.id])) return true;
    return references(entry, ids);
  });
}

export function findMembershipAuditEntries(
  membership: AuthzGroupMembership,
  entries: AuthzAuditEntry[],
  mapping?: IdentityEntitlementMapping | null,
) {
  const ids = [membership.id, membership.sourceRef, mapping?.id, membership.groupId, membership.userId].filter(Boolean);
  return entries.filter((entry) => {
    if (!mutating(entry.action)) return false;
    if (entry.resourceType === 'authz_group_membership' && references(entry, [membership.id])) return true;
    if (mapping && entry.resourceType === 'identity_entitlement_mapping' && references(entry, [mapping.id])) return true;
    return references(entry, ids);
  });
}

export function findMachineIdentityAuditEntries(
  principalType: 'api_client' | 'service_account',
  principalId: string,
  entries: AuthzAuditEntry[],
) {
  return entries.filter((entry) => {
    if (!mutating(entry.action)) return false;
    if (entry.resourceType === principalType && references(entry, [principalId])) return true;
    if (entry.resourceType === 'role_assignment' && references(entry, [principalId])) return true;
    return references(entry, [principalId, `${principalType}:${principalId}`]);
  });
}

export function findEffectiveAccessSourceAuditEntries(source: EffectiveAccessSource, entries: AuthzAuditEntry[]) {
  const ids = [source.assignmentId, source.sourceRef, source.groupMembership?.id, source.groupMembership?.sourceRef, source.identityEntitlementMapping?.id, source.engineSetId, source.materializationId, source.engineRegistration?.registrationId, source.engineRegistration?.engineId, source.matchedEngineId, source.principalId, source.roleId, source.scopeId];
  return entries.filter((entry) => {
    if (!mutating(entry.action)) return false;
    if (source.assignmentId && entry.resourceType === 'role_assignment' && references(entry, [source.assignmentId])) return true;
    if (source.groupMembership?.id && entry.resourceType === 'authz_group_membership' && references(entry, [source.groupMembership.id])) return true;
    if (source.identityEntitlementMapping?.id && entry.resourceType === 'identity_entitlement_mapping' && references(entry, [source.identityEntitlementMapping.id])) return true;
    if (source.engineSetId && entry.resourceType === 'engine_set' && references(entry, [source.engineSetId])) return true;
    return references(entry, ids);
  });
}
export function formatAuditReferences(entries: AuthzAuditEntry[]) { return [...entries].sort((a, b) => b.timestamp - a.timestamp).slice(0, 2).map((entry) => `${entry.action} @ ${formatTimestamp(entry.timestamp)}`).join('; ') || '-'; }
export function AuditReferenceLinks({ entries, onOpen }: { entries: AuthzAuditEntry[]; onOpen?: (entry: AuthzAuditEntry) => void }) {
  const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp).slice(0, 2);
  if (sorted.length === 0) return <>-</>;
  if (!onOpen) return <>{formatAuditReferences(sorted)}</>;
  return <div style={{ display: 'grid', justifyItems: 'start', gap: 'var(--spacing-1)' }}>{sorted.map((entry) => {
    const label = `${entry.action} @ ${formatTimestamp(entry.timestamp)}`;
    return <Button key={entry.id} kind="ghost" size="sm" aria-label={`Open audit event ${label}`} onClick={() => onOpen(entry)}>{label}</Button>;
  })}</div>;
}
