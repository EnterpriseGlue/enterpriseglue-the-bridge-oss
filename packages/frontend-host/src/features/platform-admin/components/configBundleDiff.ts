export type ConfigBundleDiffChange = {
  objectType: string;
  key: string;
  operation: string;
  reason: string;
};

export type ConfigBundleChangeRisk = 'requires_attention' | 'review' | 'informational';

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
