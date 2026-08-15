import React from 'react';
import {
  Button,
  DataTable,
  DataTableSkeleton,
  Dropdown,
  Modal,
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
import { GuardedOverflowMenu, GuardedOverflowMenuItem } from '../../../../shared/auth/guards';
import { DataTableDataRow, DataTableHeaderCell, dataTableHeaderKey } from './dataTablePrimitives';
import { ROLE_SCOPE_FILTERS, type RoleScopeFilter } from './roleScopePresentation';
import { AdminTableEmptyState, AdminTablePagination, useAdminTablePagination } from '../../../../shared/components/AdminDataTable';

const rolesHeaders = [
  { key: 'name', header: 'Role' },
  { key: 'scope', header: 'Role scope' },
  { key: 'kind', header: 'Role type' },
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
  const [archiveTarget, setArchiveTarget] = React.useState<RoleSummary | null>(null);
  const filteredRoles = React.useMemo(
    () => filterRoles(roles, searchQuery, scopeFilter),
    [filterRoles, roles, searchQuery, scopeFilter],
  );
  const pagination = useAdminTablePagination(filteredRoles, { resetKey: `${searchQuery}:${scopeFilter}` });
  const selectedScopeFilter = ROLE_SCOPE_FILTERS.find((item) => item.id === scopeFilter) || ROLE_SCOPE_FILTERS[0];

  if (loading) return <DataTableSkeleton headers={rolesHeaders} rowCount={6} />;

  return (
    <TableContainer className="eg-admin-data-table">
      <DataTable
        rows={pagination.pageItems.map((role) => ({
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
                  titleText=""
                  aria-label="Filter roles by scope"
                  label="Scope"
                  className="eg-role-scope-filter"
                  size="lg"
                  items={ROLE_SCOPE_FILTERS}
                  selectedItem={selectedScopeFilter}
                  itemToString={(item) => item?.label || ''}
                  onChange={({ selectedItem }) => setScopeFilter(selectedItem?.id || 'all')}
                />
                <Button kind="primary" renderIcon={Add} onClick={onCreate} disabled={!canManage} title={canManage ? undefined : 'You can view roles, but you do not have permission to create or change them.'}>
                  Create role
                </Button>
              </TableToolbarContent>
            </TableToolbar>
            {filteredRoles.length === 0 ? (
              <AdminTableEmptyState title="No roles found" description="No roles match the current search and scope filter." />
            ) : <Table {...getTableProps()} size="md">
              <TableHead>
                <TableRow>
                  {headers.map((header) => <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />)}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={headers.length}>No roles match the current filters.</TableCell></TableRow>
                ) : rows.map((row) => {
                  const role = pagination.pageItems.find((item) => item.id === row.id);
                  return (
                    <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                      {row.cells.map((cell) => {
                        if (cell.info.header === 'scope') return <TableCell key={cell.id}>{scopeTag(String(cell.value))}</TableCell>;
                        if (cell.info.header === 'kind') return <TableCell key={cell.id}><Tag type="gray">{String(cell.value)}</Tag></TableCell>;
                        if (cell.info.header === 'assignable') return <TableCell key={cell.id}>{cell.value ? 'Yes' : 'No'}</TableCell>;
                        if (cell.info.header === 'status') return <TableCell key={cell.id}><Tag type={cell.value ? 'gray' : 'green'}>{cell.value ? 'Archived' : 'Active'}</Tag></TableCell>;
                        if (cell.info.header === 'actions') {
                          return <TableCell key={cell.id}>
                            {role && <GuardedOverflowMenu size="sm" flipped iconDescription={`Actions for ${role.name}`}>
                              {role.kind === 'system' && <GuardedOverflowMenuItem itemText="Duplicate" disabled={!canManage} unavailableReason={canManage ? undefined : 'Missing permission platform:authz:roles:manage'} onClick={() => onDuplicate(role)} />}
                              {role.kind === 'custom' && <GuardedOverflowMenuItem itemText="Edit" disabled={!canManage} unavailableReason={canManage ? undefined : 'Missing permission platform:authz:roles:manage'} onClick={() => onEdit(role)} />}
                              {role.kind === 'custom' && <GuardedOverflowMenuItem itemText="Archive" isDelete disabled={role.isArchived || !canManage} unavailableReason={role.isArchived ? 'Role is already archived' : canManage ? undefined : 'Missing permission platform:authz:roles:manage'} onClick={() => setArchiveTarget(role)} />}
                            </GuardedOverflowMenu>}
                          </TableCell>;
                        }
                        return <TableCell key={cell.id}>{cell.value}</TableCell>;
                      })}
                    </DataTableDataRow>
                  );
                })}
              </TableBody>
            </Table>}
          </>
        )}
      </DataTable>
      <AdminTablePagination totalItems={filteredRoles.length} page={pagination.page} pageSize={pagination.pageSize} onChange={pagination.setPagination} />
      <Modal
        open={Boolean(archiveTarget)}
        danger
        modalHeading="Archive custom role"
        primaryButtonText="Archive"
        secondaryButtonText="Cancel"
        onRequestClose={() => setArchiveTarget(null)}
        onRequestSubmit={() => {
          if (!archiveTarget) return;
          onArchive(archiveTarget);
          setArchiveTarget(null);
        }}
      >
        Archive <strong>{archiveTarget?.name}</strong>? Existing assignments remain visible for audit, but this role cannot be assigned again.
      </Modal>
    </TableContainer>
  );
}
