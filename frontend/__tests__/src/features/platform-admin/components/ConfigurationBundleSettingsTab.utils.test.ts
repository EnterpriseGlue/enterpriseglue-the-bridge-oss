import { describe, expect, it } from 'vitest';
import {
  filterConfigBundleChanges,
  getConfigBundleChangeRisk,
  groupConfigBundleChanges,
} from '@src/features/platform-admin/components/configBundleDiff';

const changes = [
  { objectType: 'role', key: 'role.deployers', operation: 'create', reason: 'New config role' },
  { objectType: 'engine', key: 'engine.shared', operation: 'update', reason: 'Changed labels' },
  { objectType: 'group', key: 'group.legacy', operation: 'archive', reason: 'Removed from bundle' },
  { objectType: 'target', key: 'payments-prod', operation: 'conflict', reason: 'Manual target already exists' },
];

describe('ConfigurationBundleSettingsTab diff helpers', () => {
  it('classifies conflicts and archives as changes requiring attention', () => {
    expect(getConfigBundleChangeRisk(changes[0])).toBe('informational');
    expect(getConfigBundleChangeRisk(changes[1])).toBe('review');
    expect(getConfigBundleChangeRisk(changes[2])).toBe('requires_attention');
    expect(getConfigBundleChangeRisk(changes[3])).toBe('requires_attention');
  });

  it('filters changes by search, object type, operation, and review priority', () => {
    expect(filterConfigBundleChanges(changes, { query: 'manual' })).toEqual([changes[3]]);
    expect(filterConfigBundleChanges(changes, { objectType: 'engine', operation: 'update' })).toEqual([changes[1]]);
    expect(filterConfigBundleChanges(changes, { risk: 'requires_attention' })).toEqual([changes[2], changes[3]]);
  });

  it('groups filtered changes in attention-first review order', () => {
    expect(groupConfigBundleChanges(changes).map((group) => [group.risk, group.changes.length])).toEqual([
      ['requires_attention', 2],
      ['review', 1],
      ['informational', 1],
    ]);
  });
});
