import React from 'react';
import { Button } from '@carbon/react';
import type { AuthzAuditEntry, EffectiveAccessResult } from '../../hooks/useAuthzApi';

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

export function findEffectiveAccessSourceAuditEntries(source: EffectiveAccessSource, entries: AuthzAuditEntry[]) {
  const ids = [source.assignmentId, source.sourceMappingId, source.sourceRef, source.groupMembership?.id, source.groupMembership?.sourceRef, source.ssoMapping?.id, source.ssoGroupMapping?.id, source.identityEntitlementMapping?.id, source.engineSetId, source.materializationId, source.engineRegistration?.registrationId, source.engineRegistration?.engineId, source.matchedEngineId, source.principalId, source.roleId, source.scopeId];
  return entries.filter((entry) => mutating(entry.action) && references(entry, ids));
}
export function formatAuditReferences(entries: AuthzAuditEntry[]) { return [...entries].sort((a, b) => b.timestamp - a.timestamp).slice(0, 2).map((entry) => `${entry.action} @ ${new Date(entry.timestamp).toLocaleString()}`).join('; ') || '-'; }
export function AuditReferenceLinks({ entries, onOpen }: { entries: AuthzAuditEntry[]; onOpen?: (entry: AuthzAuditEntry) => void }) {
  const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp).slice(0, 2);
  if (!onOpen) return <>{formatAuditReferences(sorted)}</>;
  return <div style={{ display: 'grid', justifyItems: 'start', gap: 'var(--spacing-1)' }}>{sorted.map((entry) => <Button key={entry.id} kind="ghost" size="sm" onClick={() => onOpen(entry)}>{entry.action} @ {new Date(entry.timestamp).toLocaleString()}</Button>)}</div>;
}
