export type CoreAssignmentResourceType =
  | 'platform'
  | 'project'
  | 'engine'
  | 'engine_runtime_resource'
  | 'engine_runtime_resource_set'
  | 'external_engine_system';

export const effectiveAccessSourceHeaders = [
  { key: 'type', header: 'Source' },
  { key: 'grant', header: 'Grant' },
  { key: 'principal', header: 'Principal' },
  { key: 'scope', header: 'Scope' },
  { key: 'lineage', header: 'Lineage' },
  { key: 'audit', header: 'Audit' },
];
