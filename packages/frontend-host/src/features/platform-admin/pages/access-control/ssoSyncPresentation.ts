import type { SsoSyncEvent, SsoSyncRun } from '../../hooks/useAuthzApi';

export const ssoSyncRunHeaders = [
  { key: 'status', header: 'Status' }, { key: 'provider', header: 'Provider' }, { key: 'user', header: 'User' },
  { key: 'trigger', header: 'Trigger' }, { key: 'changes', header: 'Changes' }, { key: 'started', header: 'Started' },
  { key: 'duration', header: 'Duration' }, { key: 'error', header: 'Error' }, { key: 'actions', header: '' },
];
export const ssoSyncEventHeaders = [
  { key: 'severity', header: 'Severity' }, { key: 'type', header: 'Type' }, { key: 'message', header: 'Message' },
  { key: 'resource', header: 'Resource' }, { key: 'mapping', header: 'Mapping' }, { key: 'created', header: 'Created' }, { key: 'details', header: 'Details' },
];

export interface SsoSyncDiagnosticsOptions {
  includeProviderChecks: boolean;
  includeSnapshotReplay: boolean;
  refreshProviderClaims: boolean;
  includeCleanup: boolean;
}

export const DEFAULT_SSO_DIAGNOSTICS_OPTIONS: SsoSyncDiagnosticsOptions = {
  includeProviderChecks: false,
  includeSnapshotReplay: false,
  refreshProviderClaims: false,
  includeCleanup: false,
};

export function formatSsoSyncStatus(value: string) { return value ? value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') : '-'; }
export function formatSsoSyncTimestamp(value: number | null | undefined) { return value ? new Date(value).toLocaleString() : '-'; }
export function formatSsoSyncProvider(providerId: string | null | undefined) { return providerId || 'Any provider'; }
export function getSsoSyncStatusTagType(status: SsoSyncRun['status']) { return status === 'success' ? 'green' : status === 'failed' ? 'red' : 'blue'; }
export function getSsoSyncSeverityTagType(severity: SsoSyncEvent['severity']) { return severity === 'error' ? 'red' : severity === 'warning' ? 'magenta' : 'gray'; }
export function formatSsoSyncCounts(run: SsoSyncRun) {
  return `Groups ${run.groupMembershipsCreated + run.groupMembershipsUpdated + run.groupMembershipsRemoved}; assignments ${run.assignmentsCreated + run.assignmentsUpdated + run.assignmentsRemoved}`;
}
export function formatSsoSyncDuration(run: SsoSyncRun) {
  if (!run.completedAt) return run.status === 'running' ? 'Running' : '-';
  const durationMs = Math.max(run.completedAt - run.startedAt, 0);
  return durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(1)} s`;
}
export function formatSsoSyncDetails(details: string | null | undefined) {
  if (!details || details === '{}') return '-';
  try {
    const parsed = JSON.parse(details);
    if (!parsed || typeof parsed !== 'object') return String(parsed);
    const entries = Object.entries(parsed as Record<string, unknown>);
    return entries.length ? entries.map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`).join(', ') : '-';
  } catch { return details.length > 160 ? `${details.slice(0, 157)}...` : details; }
}
export function formatSsoSyncResource(event: SsoSyncEvent) { return event.resourceType ? `${event.resourceType}:${event.resourceId || '*'}` : '-'; }
export function formatSsoSyncMapping(event: SsoSyncEvent) { const parts = [event.mappingType || '', event.mappingId || ''].filter(Boolean); return parts.length ? parts.join(':') : '-'; }
