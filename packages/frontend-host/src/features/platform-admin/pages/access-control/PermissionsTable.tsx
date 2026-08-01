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
import type { PermissionCatalogEntry } from '../../hooks/useAuthzApi';
import { DataTableDataRow, DataTableHeaderCell, dataTableHeaderKey } from './dataTablePrimitives';

const permissionsHeaders = [
  { key: 'label', header: 'Permission' },
  { key: 'scope', header: 'Permission scope' },
  { key: 'kind', header: 'Type' },
  { key: 'category', header: 'Category' },
  { key: 'implications', header: 'Also includes' },
  { key: 'risk', header: 'Warning' },
];

type PermissionQuickFilter = 'all' | 'view' | 'editor' | 'operator' | 'deployment';

const PERMISSION_QUICK_FILTERS: Array<{ id: PermissionQuickFilter; label: string }> = [
  { id: 'all', label: 'All permissions' },
  { id: 'view', label: 'Read and inspect' },
  { id: 'editor', label: 'Create and edit' },
  { id: 'operator', label: 'Operate runtime' },
  { id: 'deployment', label: 'Deploy and import' },
];

const permissionTextCellStyle = { overflowWrap: 'break-word' as const };

const implicationLabels: Record<string, string> = {
  'project:files:view': 'View project files',
  'project:members:view': 'View project members',
  'engine:members:view': 'View engine members',
  'engine:instance:view': 'View process instances',
  'engine:variables:metadata:view': 'View variable names and metadata',
  'engine:variables:value:view': 'View process variable values',
  'engine:deploy:view': 'View deployments',
};

function impliedPermissionLabel(key: string, permissions: PermissionCatalogEntry[]): string {
  const catalogLabel = permissions.find((permission) => permission.key === key)?.label;
  if (catalogLabel) return catalogLabel;
  if (implicationLabels[key]) return implicationLabels[key];
  return key
    .split(':')
    .slice(1)
    .join(' ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

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
  const [search, setSearch] = React.useState('');
  const filteredPermissions = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return filterPermissions(permissions, quickFilter).filter((permission) => (
      !query ||
      [permission.label, permission.key, permission.scope, permission.category, permission.description]
        .some((value) => String(value || '').toLowerCase().includes(query))
    ));
  }, [filterPermissions, permissions, quickFilter, search]);
  const selectedQuickFilter = PERMISSION_QUICK_FILTERS.find((item) => item.id === quickFilter) || PERMISSION_QUICK_FILTERS[0];

  if (loading) return <DataTableSkeleton headers={permissionsHeaders} rowCount={8} />;

  return (
    <TableContainer className="eg-permissions-table">
      <DataTable rows={filteredPermissions.map((permission) => ({
        id: permission.key,
        label: permission.label,
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
                <TableToolbarSearch
                  persistent
                  placeholder="Search permissions"
                  value={search}
                  onChange={(event: any) => setSearch(String(event.target.value || ''))}
                />
                <Dropdown
                  id="permissions-quick-filter"
                  titleText=""
                  aria-label="Permission capability"
                  label="Permission capability"
                  className="eg-table-toolbar-filter"
                  size="lg"
                  items={PERMISSION_QUICK_FILTERS}
                  selectedItem={selectedQuickFilter}
                  itemToString={(item) => item?.label || ''}
                  onChange={({ selectedItem }) => setQuickFilter(selectedItem?.id || 'all')}
                />
                <Button kind="primary" renderIcon={Add} onClick={onCreate} disabled={!canManage} title={canManage ? undefined : 'You can view permissions, but you do not have permission to create them.'}>Add permission</Button>
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
                      if (cell.info.header === 'label' && permission) return (
                        <TableCell key={cell.id}>
                          <div style={{ display: 'grid', gap: 'var(--spacing-1)', minWidth: 0 }}>
                            <span>{permission.label}</span>
                            <span title={permission.key} style={{ color: 'var(--cds-text-secondary)', fontSize: '0.75rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {permission.key}
                            </span>
                          </div>
                        </TableCell>
                      );
                      if (cell.info.header === 'implications') return (
                        <TableCell key={cell.id} style={permissionTextCellStyle}>
                          {implications.length ? (
                            <div className="eg-permission-implications">
                              {implications.map((item) => {
                                const label = impliedPermissionLabel(item, permissions);
                                return <Tag key={item} type="cool-gray" title={`${label} (${item})`}>{label}</Tag>;
                              })}
                            </div>
                          ) : '-'}
                        </TableCell>
                      );
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
