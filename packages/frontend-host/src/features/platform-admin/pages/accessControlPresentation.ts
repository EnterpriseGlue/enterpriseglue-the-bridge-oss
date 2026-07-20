import type {
  EffectiveAccessResult,
  EngineSetSelector,
  ExternalEngineCapabilityDiagnostics,
  ExternalEngineReconcileResponse,
} from '../hooks/useAuthzApi';

type EffectiveAccessSource = EffectiveAccessResult['sources'][number];

export function formatLabels(labels: Record<string, string>) {
  const entries = Object.entries(labels);
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(', ') : '-';
}

export function formatFieldOwnership(ownership?: Record<string, 'manual' | 'external'>) {
  const entries = Object.entries(ownership || {});
  if (!entries.length) return '-';
  const external = entries.filter(([, owner]) => owner === 'external').map(([key]) => key).join(', ');
  const manual = entries.filter(([, owner]) => owner === 'manual').map(([key]) => key).join(', ');
  return [
    external ? `External: ${external}` : '',
    manual ? `Manual: ${manual}` : '',
  ].filter(Boolean).join(' | ') || '-';
}

export function formatStatusLabel(value: string | null | undefined) {
  if (!value) return '-';
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatCapabilityDiagnostics(diagnostics?: ExternalEngineCapabilityDiagnostics | null) {
  if (!diagnostics) return '-';
  if (diagnostics.status === 'in_sync') return 'All expected operations and query capabilities reported';
  if (diagnostics.reportedOperations.length === 0) return 'No operation capabilities reported';
  if (diagnostics.missingOperations.length > 0) return `Missing: ${diagnostics.missingOperations.join(', ')}`;
  if (diagnostics.mismatchedQueryCapabilities.length > 0) return `Query filters: ${diagnostics.mismatchedQueryCapabilities.join(', ')}`;
  if (diagnostics.extraOperations.length > 0) return `Extra: ${diagnostics.extraOperations.join(', ')}`;
  return diagnostics.issues[0] || diagnostics.recommendation || '-';
}

export function formatReconcileSummary(result: ExternalEngineReconcileResponse) {
  const capability = formatCapabilityDiagnostics(result.capabilityDiagnostics);
  const materialization = result.materializationDiagnostics?.summary || 'Engine Sets checked';
  return `${capability}. ${materialization}.`;
}

export function formatEngineSetSelector(selector: EngineSetSelector) {
  if (selector.mode === 'all') return 'All active engines';
  if (selector.mode === 'engine_ids') return `Engine IDs: ${selector.engineIds.join(', ') || '-'}`;
  const labels = Object.entries(selector.labels || {})
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
  return `Labels (${selector.labelMatch || 'all'}): ${labels || '-'}`;
}

export function formatEngineSetMatchedBy(matchedBy: Record<string, unknown>) {
  const entries = Object.entries(matchedBy || {});
  return entries.length ? entries.map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`).join(', ') : '-';
}

export function formatEffectiveAccessGrant(source: EffectiveAccessSource) {
  if (source.roleId) return source.roleId;
  if (source.role) return source.role;
  if (source.permission) return source.permission;
  return '-';
}

export function formatEffectiveAccessPrincipal(source: EffectiveAccessSource) {
  if (source.principalType === 'group' && (source.groupName || source.groupKey || source.groupId)) {
    return `group:${source.groupName || source.groupKey || source.groupId}`;
  }
  if (!source.principalType && !source.principalId) return '-';
  return `${source.principalType || 'principal'}:${source.principalId || '-'}`;
}

export function formatEffectiveAccessScope(source: EffectiveAccessSource) {
  if (source.engineSetId) {
    const engineSetLabel = source.engineSetName || source.engineSetKey || source.engineSetId;
    return `Engine Set: ${engineSetLabel}`;
  }
  if (source.scopeType || source.scopeId) {
    return `${source.scopeType || 'scope'}:${source.scopeId || 'all'}`;
  }
  return '-';
}

function formatIdentityEntitlementMappingLineage(source: EffectiveAccessSource) {
  const mapping = source.identityEntitlementMapping;
  if (!mapping) return null;
  const value = mapping.matchOperator === 'exists' ? 'any value' : mapping.externalId || '-';
  return `Identity mapping: ${mapping.entitlementType} ${mapping.matchOperator} ${value}`;
}

function formatEngineRegistrationLineage(source: EffectiveAccessSource) {
  const registration = source.engineRegistration;
  if (!registration) return null;
  const parts = [
    registration.registrationSource || 'manual',
    registration.externalId ? `externalId=${registration.externalId}` : null,
    registration.externalSystemId ? `system=${registration.externalSystemId}` : null,
    registration.lifecycleStatus ? `lifecycle=${registration.lifecycleStatus}` : null,
  ].filter((part): part is string => Boolean(part));
  return `Engine registration: ${parts.join(' ') || registration.engineId}`;
}

function formatConfigBundleLineage(source: EffectiveAccessSource) {
  const config = source.configBundle;
  if (!config) return null;
  const apply = config.applyRun
    ? `apply=${config.applyRun.id} hash=${config.applyRun.canonicalHash}`
    : 'apply=unresolved';
  return `Config bundle: ${config.bundleKey} ${config.objectType}:${config.objectId} ${apply} drift=${config.driftStatus || 'unknown'}`;
}

export function formatEffectiveAccessLineage(source: EffectiveAccessSource) {
  const parts = [
    source.source ? `Assignment source: ${source.source}` : null,
    source.groupMembership ? `Group membership: ${source.groupMembership.source}` : null,
    formatIdentityEntitlementMappingLineage(source),
    source.selectorFingerprint ? `Selector: ${source.selectorFingerprint}` : null,
    formatEngineRegistrationLineage(source),
    source.matchedBy ? `Matched by: ${formatEngineSetMatchedBy(source.matchedBy)}` : null,
    source.lineage ? `Lineage: ${formatEngineSetMatchedBy(source.lineage)}` : null,
    formatConfigBundleLineage(source),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' | ') : '-';
}
