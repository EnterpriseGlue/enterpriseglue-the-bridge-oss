import type { RoleSummary } from '../../hooks/useAuthzApi';

export type RoleScopeFilter = 'all' | RoleSummary['scope'];

export const ROLE_SCOPE_FILTERS: Array<{ id: RoleScopeFilter; label: string }> = [
  { id: 'all', label: 'All scopes' },
  { id: 'platform', label: 'Platform' },
  { id: 'project', label: 'Project' },
  { id: 'engine', label: 'Engine' },
  { id: 'external_engine_system', label: 'External system' },
];
