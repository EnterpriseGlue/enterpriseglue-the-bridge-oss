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
  Tag,
} from '@carbon/react';
import { Add } from '@carbon/icons-react';
import type { PermissionCatalogEntry } from '../../hooks/useAuthzApi';
import { DataTableDataRow, DataTableHeaderCell, dataTableHeaderKey } from './dataTablePrimitives';

const permissionsHeaders = [
  { key: 'label', header: 'Permission' },
  { key: 'key', header: 'Key' },
  { key: 'scope', header: 'Scope' },
  { key: 'kind', header: 'Type' },
  { key: 'category', header: 'Category' },
  { key: 'implications', header: 'Dependencies' },
  { key: 'risk', header: 'Warning' },
];

type PermissionQuickFilter = 'all' | 'view' | 'editor' | 'operator' | 'deployment';

const PERMISSION_QUICK_FILTERS: Array<{ id: PermissionQuickFilter; label: string }> = [
  { id: 'all', label: 'All permissions' },
  { id: 'view', label: 'View only' },
  { id: 'editor', label: 'Editor' },
  { id: 'operator', label: 'Operator' },
  { id: 'deployment', label: 'Deployment' },
];

const permissionTextCellStyle = { overflowWrap: 'anywhere' as const };

function scopeTag(scope: string) {
  if (scope === 'platform') return <Tag type="purple">Platform</Tag>;
  if (scope === 'project') return <Tag type="blue">Project</Tag>;
  if (scope === 'external_engine_system') return <Tag type="cyan">External system</Tag>;
  return <Tag type="teal">Engine</Tag>;
}

export function PermissionsTable({
  permissions,
  loading,
  onCreate,
  canManage,
  filterPermissions,
  getPermissionImplications,
  getPermissionRisk,
}: {
  permissions: PermissionCatalogEntry[];
  loading: boolean;
  onCreate: () => void;
  canManage: boolean;
  filterPermissions: (permissions: PermissionCatalogEntry[], quickFilter: PermissionQuickFilter) => PermissionCatalogEntry[];
  getPermissionImplications: (permission: PermissionCatalogEntry) => string[];
  getPermissionRisk: (permission: PermissionCatalogEntry) => { label: string; description: string } | null | undefined;
}) {
  const [quickFilter, setQuickFilter] = React.useState<PermissionQuickFilter>('all');
  const filteredPermissions = React.useMemo(() => filterPermissions(permissions, quickFilter), [filterPermissions, permissions, quickFilter]);
  const selectedQuickFilter = PERMISSION_QUICK_FILTERS.find((item) => item.id === quickFilter) || PERMISSION_QUICK_FILTERS[0];

  if (loading) return <DataTableSkeleton headers={permissionsHeaders} rowCount={8} />;

  return (
    <TableContainer>
      <DataTable rows={filteredPermissions.map((permission) => ({
        id: permission.key,
        label: permission.label,
        key: permission.key,
        scope: permission.scope,
        category: permission.category,
        kind: permission.kind || 'system',
        implications: getPermissionImplications(permission).join(', '),
        risk: getPermissionRisk(permission)?.label || '',
      }))} headers={permissionsHeaders}>
        {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
          <>
            <TableToolbar>
              <TableToolbarContent>
                <Dropdown id="permissions-quick-filter" titleText="Quick filter" label="Quick filter" items={PERMISSION_QUICK_FILTERS} selectedItem={selectedQuickFilter} itemToString={(item) => item?.label || ''} onChange={({ selectedItem }) => setQuickFilter(selectedItem?.id || 'all')} />
                <Button kind="primary" renderIcon={Add} onClick={onCreate} disabled={!canManage} title={canManage ? undefined : 'Missing permission platform:authz:roles:manage'}>Add Permission</Button>
              </TableToolbarContent>
            </TableToolbar>
            <Table {...getTableProps()} size="md">
              <TableHead><TableRow>{headers.map((header) => <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />)}</TableRow></TableHead>
              <TableBody>
                {rows.length === 0 ? <TableRow><TableCell colSpan={headers.length}>No permissions match the current filter.</TableCell></TableRow> : rows.map((row) => {
                  const permission = filteredPermissions.find((item) => item.key === row.id);
                  const risk = permission ? getPermissionRisk(permission) : null;
                  const implications = permission ? getPermissionImplications(permission) : [];
                  return <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                    {row.cells.map((cell) => {
                      if (cell.info.header === 'scope') return <TableCell key={cell.id}>{scopeTag(String(cell.value))}</TableCell>;
                      if (cell.info.header === 'kind') return <TableCell key={cell.id}><Tag type={cell.value === 'custom' ? 'green' : 'gray'}>{String(cell.value)}</Tag></TableCell>;
                      if (cell.info.header === 'risk') return <TableCell key={cell.id}>{risk ? <Tag type="red" title={risk.description}>{risk.label}</Tag> : '-'}</TableCell>;
                      if (cell.info.header === 'implications') return <TableCell key={cell.id} style={permissionTextCellStyle}>{implications.length ? implications.map((item) => <Tag key={item} type="cool-gray">{item}</Tag>) : '-'}</TableCell>;
                      return <TableCell key={cell.id} style={permissionTextCellStyle}>{cell.value}</TableCell>;
                    })}
                  </DataTableDataRow>;
                })}
              </TableBody>
            </Table>
          </>
        )}
      </DataTable>
    </TableContainer>
  );
}
