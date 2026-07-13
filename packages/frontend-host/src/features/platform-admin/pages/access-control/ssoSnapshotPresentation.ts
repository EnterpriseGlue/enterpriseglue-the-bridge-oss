import type { SsoEngineAccessSnapshot } from '../../hooks/useAuthzApi';

export const ssoEngineAccessSnapshotHeaders = [
  { key: 'principal', header: 'Principal' },
  { key: 'engine', header: 'Engine' },
  { key: 'roles', header: 'Current roles' },
  { key: 'status', header: 'Status' },
  { key: 'mapping', header: 'Mapping' },
  { key: 'lastSync', header: 'Last sync' },
  { key: 'lineage', header: 'Lineage' },
];

export function getSsoEngineSnapshotStatusTagType(status: SsoEngineAccessSnapshot['status']) {
  if (status === 'active') return 'green';
  if (status === 'stale') return 'magenta';
  if (status === 'provider_identity_missing' || status === 'provider_group_missing' || status === 'engine_no_longer_matches_selector') return 'red';
  if (status === 'removed_by_sso' || status === 'removed_by_admin' || status === 'mapping_disabled') return 'purple';
  return 'gray';
}
