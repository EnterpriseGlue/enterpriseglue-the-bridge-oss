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
import type { ApiClient, AuthzGroup, ExternalEngineSystem, RoleAssignment, ServiceAccount } from '../../hooks/useAuthzApi';
import { AssignmentSourceTag } from './AssignmentSourceTag';

const headers = [
  { key: 'principal', header: 'Principal' }, { key: 'role', header: 'Role' },
  { key: 'resource', header: 'Resource' }, { key: 'source', header: 'Source' }, { key: 'actions', header: '' },
];

function formatPrincipal(assignment: RoleAssignment, apiClients: ApiClient[], groups: AuthzGroup[], serviceAccounts: ServiceAccount[]) {
  const principalType = assignment.principalType || 'user';
  const principalId = assignment.principalId || assignment.userId;
  if (principalType === 'api_client') return `API client: ${apiClients.find((item) => item.id === principalId)?.name || principalId}`;
  if (principalType === 'group') return `Group: ${groups.find((item) => item.id === principalId)?.name || principalId}`;
  if (principalType === 'service_account') return `Service account: ${serviceAccounts.find((item) => item.id === principalId)?.name || principalId}`;
  return principalId;
}

function formatResource(assignment: RoleAssignment, externalSystems: ExternalEngineSystem[]) {
  if (assignment.resourceType === 'platform') return 'Platform';
  if (assignment.resourceType === 'external_engine_system') return `External system: ${externalSystems.find((item) => item.id === assignment.resourceId)?.name || assignment.resourceId || ''}`;
  return `${assignment.resourceType || ''}:${assignment.resourceId || ''}`;
}

export function RoleAssignmentsTable({ assignments, apiClients, groups, serviceAccounts, externalSystems, loading, canDelete, onRemove }: {
  assignments: RoleAssignment[]; apiClients: ApiClient[]; groups: AuthzGroup[]; serviceAccounts: ServiceAccount[]; externalSystems: ExternalEngineSystem[];
  loading: boolean; canDelete: boolean; onRemove: (assignmentId: string) => void;
}) {
  if (loading) return <DataTableSkeleton headers={headers} rowCount={5} />;
  const rows = assignments.map((assignment) => ({
    id: assignment.id,
    principal: formatPrincipal(assignment, apiClients, groups, serviceAccounts),
    role: assignment.roleName || assignment.roleId,
    resource: formatResource(assignment, externalSystems),
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
          if (cell.info.header === 'actions') return <TableCell key={cell.id}>{(assignment?.source === 'manual' || (assignment?.source === 'config' && assignment.ownershipMode === 'config_warn')) && <Button kind="ghost" size="sm" renderIcon={TrashCan} hasIconOnly iconDescription="Remove assignment" disabled={!canDelete} title={canDelete ? undefined : 'Missing permission platform:authz:roles:manage'} onClick={() => onRemove(assignment.id)} />}</TableCell>;
          return <TableCell key={cell.id}>{cell.value}</TableCell>;
        })}</TableRow>;
      })}
    </TableBody></Table>
  )}</DataTable></TableContainer>;
}
