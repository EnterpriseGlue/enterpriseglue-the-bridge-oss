export type ConfigBundleDiffChange = {
  objectType: string;
  key: string;
  operation: string;
  reason: string;
  currentId?: string;
  permissionChanges?: {
    additions: string[];
    removals: string[];
    effectivePermissions: string[];
  };
  affectedAssignmentCount?: number;
  runtimeResourceChanges?: {
    matchedCount: number;
    unmatchedCount: number;
    newlyMatched: Array<{ resourceKind: string; resourceKey: string; runtimeTenantId: string | null }>;
    noLongerMatched: Array<{ resourceKind: string; resourceKey: string; runtimeTenantId: string | null }>;
    detailsTruncated: boolean;
  };
  identitySnapshotPreview?: { scanned: number; matches: number; nonMatches: number; failed: number; truncated: boolean; latestSnapshotAt: number | null; warnings: string[] };
};

const effectiveAccessResourceTypes: Record<string, string> = {
  engine: 'engine',
  engine_set: 'engine_set',
  project_engine_target: 'project_engine_target',
  runtime_resource_set: 'engine_runtime_resource_set',
};

export function getConfigBundleEffectiveAccessHref(change: ConfigBundleDiffChange): string | null {
  const resourceType = effectiveAccessResourceTypes[change.objectType];
  if (!resourceType || !change.currentId) return null;
  const params = new URLSearchParams({ tab: 'effective-access', resourceType, resourceId: change.currentId });
  return `/admin/access-control?${params.toString()}`;
}

export type ConfigBundleChangeRisk = 'requires_attention' | 'review' | 'informational';

const objectTypeLabels: Record<string, string> = {
  assignment: 'Scoped role assignment',
  engine: 'Engine',
  engine_set: 'Engine Set',
  group: 'Group',
  identity_mapping: 'Identity mapping',
  identity_provider: 'Identity provider',
  project_engine_target: 'Project-engine target',
  role: 'Role',
  runtime_resource_set: 'Runtime resource set',
};

export function formatConfigBundleObjectType(objectType: string): string {
  return objectTypeLabels[objectType] || objectType.replace(/_/g, ' ');
}

export function getConfigBundleChangeRisk(change: ConfigBundleDiffChange): ConfigBundleChangeRisk {
  if (change.operation === 'conflict' || change.operation === 'archive') return 'requires_attention';
  if (change.operation === 'update') return 'review';
  return 'informational';
}

export function filterConfigBundleChanges(
  changes: ConfigBundleDiffChange[],
  filters: {
    query?: string;
    operation?: string;
    objectType?: string;
    risk?: ConfigBundleChangeRisk | 'all';
  },
): ConfigBundleDiffChange[] {
  const query = filters.query?.trim().toLowerCase() || '';
  return changes.filter((change) => {
    const matchesQuery = !query || [change.objectType, change.key, change.operation, change.reason]
      .some((value) => value.toLowerCase().includes(query));
    return matchesQuery
      && (!filters.operation || filters.operation === 'all' || change.operation === filters.operation)
      && (!filters.objectType || filters.objectType === 'all' || change.objectType === filters.objectType)
      && (!filters.risk || filters.risk === 'all' || getConfigBundleChangeRisk(change) === filters.risk);
  });
}

export function groupConfigBundleChanges(changes: ConfigBundleDiffChange[]): Array<{
  risk: ConfigBundleChangeRisk;
  changes: ConfigBundleDiffChange[];
}> {
  const risks: ConfigBundleChangeRisk[] = ['requires_attention', 'review', 'informational'];
  return risks.map((risk) => ({
    risk,
    changes: changes.filter((change) => getConfigBundleChangeRisk(change) === risk),
  })).filter((group) => group.changes.length > 0);
}

export function groupConfigBundleChangesByObjectType(changes: ConfigBundleDiffChange[]): Array<{
  objectType: string;
  changes: ConfigBundleDiffChange[];
}> {
  return Array.from(changes.reduce((groups, change) => {
    groups.set(change.objectType, [...(groups.get(change.objectType) || []), change]);
    return groups;
  }, new Map<string, ConfigBundleDiffChange[]>()).entries())
    .map(([objectType, groupedChanges]) => ({ objectType, changes: groupedChanges }))
    .sort((left, right) => formatConfigBundleObjectType(left.objectType).localeCompare(formatConfigBundleObjectType(right.objectType)));
}
