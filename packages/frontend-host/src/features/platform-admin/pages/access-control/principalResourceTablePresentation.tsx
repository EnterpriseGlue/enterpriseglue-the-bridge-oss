import { Tag } from '@carbon/react';
import { formatStatusLabel } from '../accessControlPresentation';
import type { PrincipalSummaryStatus } from './principalResourcePresentation';

export const principalOverviewHeaders = [
  { key: 'principal', header: 'Principal' }, { key: 'type', header: 'Type' }, { key: 'directAssignments', header: 'Direct' },
  { key: 'inheritedAssignments', header: 'Inherited' }, { key: 'relationships', header: 'Relationships' }, { key: 'status', header: 'Status' }, { key: 'actions', header: '' },
];
export const principalAssignmentHeaders = [
  { key: 'grantType', header: 'Grant' }, { key: 'role', header: 'Role' }, { key: 'scope', header: 'Scope' }, { key: 'source', header: 'Source' },
  { key: 'lineage', header: 'Lineage' }, { key: 'audit', header: 'Audit' }, { key: 'expires', header: 'Expires' },
];
export const principalRelationshipHeaders = [
  { key: 'name', header: 'Name' }, { key: 'type', header: 'Type' }, { key: 'source', header: 'Source' },
  { key: 'lineage', header: 'Lineage' }, { key: 'audit', header: 'Audit' }, { key: 'expires', header: 'Expires' },
];
export const resourceOverviewHeaders = [
  { key: 'resource', header: 'Resource' }, { key: 'type', header: 'Type' }, { key: 'assignments', header: 'Assignments' },
  { key: 'users', header: 'Users' }, { key: 'groups', header: 'Groups' }, { key: 'machines', header: 'Machines' }, { key: 'status', header: 'Status' }, { key: 'actions', header: '' },
];
export const resourceAssignmentHeaders = [
  { key: 'principal', header: 'Principal' }, { key: 'principalType', header: 'Principal type' }, { key: 'role', header: 'Role' },
  { key: 'source', header: 'Source' }, { key: 'lineage', header: 'Lineage' }, { key: 'audit', header: 'Audit' }, { key: 'expires', header: 'Expires' },
];
export const resourceRelationshipHeaders = [
  { key: 'name', header: 'Name' }, { key: 'type', header: 'Type' }, { key: 'status', header: 'Status' },
  { key: 'source', header: 'Source' }, { key: 'details', header: 'Details' },
];

export function formatResourceStatusTag(status: string) {
  if (status === 'active') return <Tag type="green">Active</Tag>;
  if (status === 'disabled' || status === 'stale') return <Tag type="magenta">{formatStatusLabel(status)}</Tag>;
  if (status === 'decommissioned' || status === 'archived') return <Tag type="gray">{formatStatusLabel(status)}</Tag>;
  return <Tag type="cool-gray">{formatStatusLabel(status)}</Tag>;
}

export function formatPrincipalStatus(status: PrincipalSummaryStatus) {
  if (status === 'active') return <Tag type="green">Active</Tag>;
  if (status === 'archived') return <Tag type="gray">Archived</Tag>;
  if (status === 'revoked') return <Tag type="red">Revoked</Tag>;
  return <Tag type="cool-gray">Unknown</Tag>;
}
