import type { AuthzResourceType } from '@enterpriseglue/shared/authz/permission-actions.js';

export type CoreAssignmentResourceType =
  | 'platform'
  | 'tenant'
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
  { key: 'tenantExpiry', header: 'Tenant / expiry' },
  { key: 'lineage', header: 'Lineage' },
  { key: 'audit', header: 'Audit' },
];

const effectiveAccessResourceTypes = new Set<AuthzResourceType>([
  'platform',
  'tenant',
  'project',
  'engine',
  'engine_set',
  'engine_runtime_resource',
  'engine_runtime_resource_set',
  'project_engine_target',
  'external_engine_system',
]);

export function isEffectiveAccessTabRequested(searchParams: URLSearchParams): boolean {
  return searchParams.get('tab')?.replace('-', '_') === 'effective_access';
}

export function effectiveAccessDefaultsFromSearchParams(searchParams: URLSearchParams): {
  permission: string;
  resourceType: AuthzResourceType;
  resourceId: string;
} {
  const requestedResourceType = searchParams.get('resourceType') as AuthzResourceType | null;
  return {
    permission: searchParams.get('permissionId') || '',
    resourceType: requestedResourceType && effectiveAccessResourceTypes.has(requestedResourceType) ? requestedResourceType : 'platform',
    resourceId: searchParams.get('resourceId') || '',
  };
}
