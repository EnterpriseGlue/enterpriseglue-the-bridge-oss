import React from 'react';
import {
  Button,
  DataTable,
  DataTableSkeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { TrashCan } from '@carbon/icons-react';
import type {
  ApiClient,
  AuthzGroup,
  EngineSetSummary,
  ExternalEngineSystem,
  RoleAssignment,
  RoleSummary,
  ServiceAccount,
} from '../../hooks/useAuthzApi';
import { AssignmentSourceTag } from './AssignmentSourceTag';
import { useActionDecision } from '../../../../shared/auth/guards';
import type { RuntimeResourceEngineOption } from './runtimeResourceOptions';

const headers = [
  { key: 'principal', header: 'Assignee' }, { key: 'role', header: 'Role' },
  { key: 'resource', header: 'Access target' }, { key: 'source', header: 'Source' }, { key: 'actions', header: '' },
];

function formatPrincipal(assignment: RoleAssignment, apiClients: ApiClient[], groups: AuthzGroup[], serviceAccounts: ServiceAccount[]) {
  if (assignment.principalDisplayName) return assignment.principalDisplayName;
  const principalType = assignment.principalType || 'user';
  const principalId = assignment.principalId || assignment.userId;
  if (principalType === 'api_client') return apiClients.find((item) => item.id === principalId)?.name || principalId;
  if (principalType === 'group') return groups.find((item) => item.id === principalId)?.name || principalId;
  if (principalType === 'service_account') return serviceAccounts.find((item) => item.id === principalId)?.name || principalId;
  return principalId;
}

function formatResource(
  assignment: RoleAssignment,
  externalSystems: ExternalEngineSystem[],
  engineSets: EngineSetSummary[],
  runtimeEngines: RuntimeResourceEngineOption[],
) {
  if (assignment.resourceDisplayName) return assignment.resourceDisplayName;
  if (assignment.resourceType === 'platform') return 'Platform';
  if (assignment.resourceType === 'tenant') return assignment.resourceId ? `Tenant ${assignment.resourceId}` : 'Current tenant';
  if (assignment.resourceType === 'engine') return runtimeEngines.find((item) => item.id === assignment.resourceId)?.name || 'Engine';
  if (assignment.resourceType === 'engine_set') return engineSets.find((item) => item.id === assignment.resourceId)?.name || 'Engine set';
  if (assignment.resourceType === 'engine_runtime_resource') return 'Runtime resource';
  if (assignment.resourceType === 'engine_runtime_resource_set') return 'Runtime resource set';
  if (assignment.resourceType === 'external_engine_system') return externalSystems.find((item) => item.id === assignment.resourceId)?.name || 'External engine system';
  if (assignment.resourceType === 'project') return 'Project';
  return 'Access target';
}

function formatResourceSecondary(
  assignment: RoleAssignment,
  engineSets: EngineSetSummary[],
) {
  if (assignment.resourceSecondary) return assignment.resourceSecondary;
  if (!assignment.resourceId) return null;
  const engineSet = assignment.resourceType === 'engine_set'
    ? engineSets.find((item) => item.id === assignment.resourceId)
    : null;
  return engineSet
    ? `Engine set · ${engineSet.key} · ${assignment.resourceId}`
    : `${String(assignment.resourceType || 'resource').replace(/_/g, ' ')} · ${assignment.resourceId}`;
}

function AssignmentIdentity({
  primary,
  secondary,
  prefix,
}: {
  primary: string;
  secondary?: string | null;
  prefix?: string;
}) {
  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-1)', minWidth: 0 }}>
      <span>{prefix ? `${prefix}: ${primary}` : primary}</span>
      {secondary && secondary !== primary && (
        <span style={{ color: 'var(--cds-text-secondary)', fontSize: '0.75rem', overflowWrap: 'anywhere' }}>
          {secondary}
        </span>
      )}
    </div>
  );
}

export function RoleAssignmentsTable({
  assignments,
  apiClients,
  groups,
  serviceAccounts,
  externalSystems,
  roles = [],
  engineSets = [],
  runtimeEngines = [],
  loading,
  canDelete,
  onRemove,
}: {
  assignments: RoleAssignment[]; apiClients: ApiClient[]; groups: AuthzGroup[]; serviceAccounts: ServiceAccount[]; externalSystems: ExternalEngineSystem[];
  roles?: RoleSummary[]; engineSets?: EngineSetSummary[]; runtimeEngines?: RuntimeResourceEngineOption[];
  loading: boolean; canDelete: boolean; onRemove: (assignmentId: string) => void;
}) {
  const engineAccessDeleteDecision = useActionDecision('platform.authz.assignments.delete.engine-access', { type: 'platform' });
  const projectAccessDeleteDecision = useActionDecision('platform.authz.assignments.delete.project-access', { type: 'platform' });
  if (loading) return <DataTableSkeleton headers={headers} rowCount={5} />;
  const rows = assignments.map((assignment) => ({
    id: assignment.id,
    principal: formatPrincipal(assignment, apiClients, groups, serviceAccounts),
    role: assignment.roleName || roles.find((role) => role.id === assignment.roleId)?.name || assignment.roleId,
    resource: formatResource(assignment, externalSystems, engineSets, runtimeEngines),
    source: assignment.source,
    actions: '',
  }));
  return <TableContainer><DataTable rows={rows} headers={headers}>{({ rows: tableRows, headers: tableHeaders, getHeaderProps, getRowProps, getTableProps }) => (
    <Table {...getTableProps()} size="md"><TableHead><TableRow>{tableHeaders.map((header) => <TableHeader {...getHeaderProps({ header })} key={header.key}>{header.header}</TableHeader>)}</TableRow></TableHead><TableBody>
      {tableRows.map((row) => {
        const assignment = assignments.find((item) => item.id === row.id);
        return <TableRow {...getRowProps({ row })} key={row.id}>{row.cells.map((cell) => {
          if (cell.info.header === 'source') {
            const configWarning = assignment?.source === 'config' && assignment.ownershipMode === 'config_warn';
            return <TableCell key={cell.id}><AssignmentSourceTag source={cell.value} configWarning={configWarning} /></TableCell>;
          }
          if (cell.info.header === 'principal' && assignment) {
            const principalType = assignment.principalType || 'user';
            const principalLabel = principalType === 'api_client'
              ? 'API client'
              : principalType === 'service_account'
                ? 'Service account'
                : principalType === 'group'
                  ? 'Group'
                  : 'User';
            return (
              <TableCell key={cell.id}>
                <AssignmentIdentity
                  prefix={principalLabel}
                  primary={formatPrincipal(assignment, apiClients, groups, serviceAccounts)}
                  secondary={assignment.principalSecondary || assignment.principalId || assignment.userId}
                />
              </TableCell>
            );
          }
          if (cell.info.header === 'resource' && assignment) {
            return (
              <TableCell key={cell.id}>
                <AssignmentIdentity
                  primary={formatResource(assignment, externalSystems, engineSets, runtimeEngines)}
                  secondary={formatResourceSecondary(assignment, engineSets)}
                />
              </TableCell>
            );
          }
          if (cell.info.header === 'role' && assignment) {
            const resolvedRole = roles.find((role) => role.id === assignment.roleId);
            return (
              <TableCell key={cell.id}>
                <AssignmentIdentity
                  primary={assignment.roleName || resolvedRole?.name || assignment.roleId}
                  secondary={assignment.roleKey || resolvedRole?.key || assignment.roleId}
                />
              </TableCell>
            );
          }
          if (cell.info.header === 'actions') {
            const engineScoped = ['engine', 'engine_set', 'engine_runtime_resource', 'engine_runtime_resource_set'].includes(String(assignment?.scopeType || assignment?.resourceType || ''));
            const scopedDecision = engineScoped
              ? engineAccessDeleteDecision
              : (assignment?.scopeType || assignment?.resourceType) === 'project'
                ? projectAccessDeleteDecision
                : null;
            const canRemove = canDelete && (scopedDecision?.allowed ?? true);
            return <TableCell key={cell.id}>{(assignment?.source === 'manual' || (assignment?.source === 'config' && assignment.ownershipMode === 'config_warn')) && <Button kind="ghost" size="sm" renderIcon={TrashCan} hasIconOnly iconDescription="Remove assignment" disabled={!canRemove} title={!scopedDecision?.allowed ? scopedDecision?.reason : canDelete ? undefined : 'You can view this assignment, but you do not have permission to remove it.'} onClick={() => onRemove(assignment.id)} />}</TableCell>;
          }
          return <TableCell key={cell.id}>{cell.value}</TableCell>;
        })}</TableRow>;
      })}
    </TableBody></Table>
  )}</DataTable></TableContainer>;
}
