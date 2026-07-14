import React from 'react';
import {
  Button,
  DataTable,
  DataTableSkeleton,
  Dropdown,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
  Tag,
} from '@carbon/react';
import { Add } from '@carbon/icons-react';
import type { RoleSummary } from '../../hooks/useAuthzApi';
import { DataTableDataRow, DataTableHeaderCell, dataTableHeaderKey } from './dataTablePrimitives';
import { ROLE_SCOPE_FILTERS, type RoleScopeFilter } from './roleScopePresentation';

const rolesHeaders = [
  { key: 'name', header: 'Role' },
  { key: 'scope', header: 'Scope' },
  { key: 'kind', header: 'Kind' },
  { key: 'permissions', header: 'Permissions' },
  { key: 'assignable', header: 'Assignable' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: '' },
];

function scopeTag(scope: string) {
  if (scope === 'platform') return <Tag type="purple">Platform</Tag>;
  if (scope === 'project') return <Tag type="blue">Project</Tag>;
  if (scope === 'external_engine_system') return <Tag type="cyan">External system</Tag>;
  return <Tag type="teal">Engine</Tag>;
}

export function RolesTable({
  roles,
  loading,
  onCreate,
  onEdit,
  onDuplicate,
  onArchive,
  canManage,
  filterRoles,
}: {
  roles: RoleSummary[];
  loading: boolean;
  onCreate: () => void;
  onEdit: (role: RoleSummary) => void;
  onDuplicate: (role: RoleSummary) => void;
  onArchive: (role: RoleSummary) => void;
  canManage: boolean;
  filterRoles: (roles: RoleSummary[], searchQuery: string, scopeFilter: RoleScopeFilter) => RoleSummary[];
}) {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [scopeFilter, setScopeFilter] = React.useState<RoleScopeFilter>('all');
  const filteredRoles = React.useMemo(
    () => filterRoles(roles, searchQuery, scopeFilter),
    [filterRoles, roles, searchQuery, scopeFilter],
  );
  const selectedScopeFilter = ROLE_SCOPE_FILTERS.find((item) => item.id === scopeFilter) || ROLE_SCOPE_FILTERS[0];

  if (loading) return <DataTableSkeleton headers={rolesHeaders} rowCount={6} />;

  return (
    <TableContainer>
      <DataTable
        rows={filteredRoles.map((role) => ({
          id: role.id,
          name: role.name,
          scope: role.scope,
          kind: role.kind,
          permissions: role.permissionCount,
          assignable: role.isAssignable,
          status: role.isArchived,
          actions: '',
        }))}
        headers={rolesHeaders}
      >
        {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
          <>
            <TableToolbar>
              <TableToolbarContent>
                <TableToolbarSearch persistent onChange={(event: any) => setSearchQuery(event.target.value)} value={searchQuery} placeholder="Search roles" />
                <Dropdown
                  id="roles-scope-filter"
                  titleText="Scope"
                  label="Scope"
                  items={ROLE_SCOPE_FILTERS}
                  selectedItem={selectedScopeFilter}
                  itemToString={(item) => item?.label || ''}
                  onChange={({ selectedItem }) => setScopeFilter(selectedItem?.id || 'all')}
                />
                <Button kind="primary" renderIcon={Add} onClick={onCreate} disabled={!canManage} title={canManage ? undefined : 'Missing permission platform:authz:roles:manage'}>
                  Create Role
                </Button>
              </TableToolbarContent>
            </TableToolbar>
            <Table {...getTableProps()} size="md">
              <TableHead>
                <TableRow>
                  {headers.map((header) => <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />)}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={headers.length}>No roles match the current filters.</TableCell></TableRow>
                ) : rows.map((row) => {
                  const role = filteredRoles.find((item) => item.id === row.id);
                  return (
                    <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                      {row.cells.map((cell) => {
                        if (cell.info.header === 'scope') return <TableCell key={cell.id}>{scopeTag(String(cell.value))}</TableCell>;
                        if (cell.info.header === 'kind') return <TableCell key={cell.id}><Tag type="gray">{String(cell.value)}</Tag></TableCell>;
                        if (cell.info.header === 'assignable') return <TableCell key={cell.id}>{cell.value ? 'Yes' : 'No'}</TableCell>;
                        if (cell.info.header === 'status') return <TableCell key={cell.id}><Tag type={cell.value ? 'gray' : 'green'}>{cell.value ? 'Archived' : 'Active'}</Tag></TableCell>;
                        if (cell.info.header === 'actions') {
                          return <TableCell key={cell.id}>
                            {role?.kind === 'system' && <Button kind="ghost" size="sm" disabled={!canManage} title={canManage ? undefined : 'Missing permission platform:authz:roles:manage'} onClick={() => onDuplicate(role)}>Duplicate</Button>}
                            {role?.kind === 'custom' && <>
                              <Button kind="ghost" size="sm" disabled={!canManage} title={canManage ? undefined : 'Missing permission platform:authz:roles:manage'} onClick={() => onEdit(role)}>Edit</Button>
                              <Button kind="ghost" size="sm" disabled={role.isArchived || !canManage} title={canManage ? undefined : 'Missing permission platform:authz:roles:manage'} onClick={() => onArchive(role)}>Archive</Button>
                            </>}
                          </TableCell>;
                        }
                        return <TableCell key={cell.id}>{cell.value}</TableCell>;
                      })}
                    </DataTableDataRow>
                  );
                })}
              </TableBody>
            </Table>
          </>
        )}
      </DataTable>
    </TableContainer>
  );
}
