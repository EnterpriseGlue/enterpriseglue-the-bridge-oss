import { Add, TrashCan } from '@carbon/icons-react';
import {
  Button,
  DataTable,
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
import type { RoleSummary, SsoAssignmentMapping } from '../../hooks/useAuthzApi';
import { DataTableDataRow, DataTableHeaderCell, dataTableHeaderKey } from './dataTablePrimitives';

export const ssoAssignmentHeaders = [
  { key: 'claim', header: 'Claim' },
  { key: 'target', header: 'Target' },
  { key: 'role', header: 'Role' },
  { key: 'mode', header: 'Sync' },
  { key: 'status', header: 'Status' },
  { key: 'warning', header: 'Warning' },
  { key: 'actions', header: '' },
];

export function SsoAssignmentMappingsTable({
  mappings,
  roles,
  canManage,
  manageUnavailableReason,
  testPending,
  claimLabel,
  targetLabel,
  roleLabel,
  warningFor,
  onTest,
  onCreate,
  onEdit,
  onMigrate,
  onDelete,
}: {
  mappings: SsoAssignmentMapping[];
  roles: RoleSummary[];
  canManage: boolean;
  manageUnavailableReason?: string;
  testPending: boolean;
  claimLabel: (mapping: SsoAssignmentMapping) => string;
  targetLabel: (mapping: SsoAssignmentMapping) => string;
  roleLabel: (roleId: string, roles: RoleSummary[]) => string;
  warningFor: (mapping: SsoAssignmentMapping) => string | null;
  onTest: () => void;
  onCreate: () => void;
  onEdit: (mapping: SsoAssignmentMapping) => void;
  onMigrate: (mapping: SsoAssignmentMapping) => void;
  onDelete: (mappingId: string) => void;
}) {
  return (
    <TableContainer>
      <DataTable
        rows={mappings.map((mapping) => ({
          id: mapping.id,
          claim: claimLabel(mapping),
          target: targetLabel(mapping),
          role: roleLabel(mapping.targetRoleId, roles),
          mode: mapping.syncMode,
          status: mapping.isActive,
          warning: warningFor(mapping) || '',
          actions: '',
        }))}
        headers={ssoAssignmentHeaders}
      >
        {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
          <>
            <TableToolbar>
              <TableToolbarContent>
                <Button kind="ghost" size="sm" onClick={onTest} disabled={testPending || !canManage} title={manageUnavailableReason}>
                  Test Claims
                </Button>
                <Button kind="primary" renderIcon={Add} onClick={onCreate} disabled={!canManage} title={manageUnavailableReason}>
                  Add Mapping
                </Button>
              </TableToolbarContent>
            </TableToolbar>
            <Table {...getTableProps()} size="md">
              <TableHead>
                <TableRow>
                  {headers.map((header) => (
                    <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => {
                  const mapping = mappings.find((item) => item.id === row.id);
                  return (
                    <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                      {row.cells.map((cell) => {
                        if (cell.info.header === 'status') {
                          return <TableCell key={cell.id}><Tag type={cell.value ? 'green' : 'gray'}>{cell.value ? 'Active' : 'Inactive'}</Tag></TableCell>;
                        }
                        if (cell.info.header === 'warning') {
                          return <TableCell key={cell.id}>{cell.value ? <Tag type="gray">{cell.value}</Tag> : '-'}</TableCell>;
                        }
                        if (cell.info.header === 'actions') {
                          const canMigrateMapping = mapping?.targetSelectorType === 'engine_id' && Boolean(mapping.targetEngineId);
                          return (
                            <TableCell key={cell.id}>
                              <Button kind="ghost" size="sm" disabled={!canManage} title={manageUnavailableReason} onClick={() => mapping && onEdit(mapping)}>Edit</Button>
                              <Button
                                kind="ghost"
                                size="sm"
                                disabled={!canManage || !canMigrateMapping}
                                title={!canManage ? manageUnavailableReason : canMigrateMapping ? undefined : 'Only exact-engine mappings can be migrated. Recreate dynamic selectors with an Engine Set and group assignment.'}
                                onClick={() => mapping && onMigrate(mapping)}
                              >
                                Create group-first replacement
                              </Button>
                              <Button kind="ghost" size="sm" disabled={!canManage} title={manageUnavailableReason} renderIcon={TrashCan} hasIconOnly iconDescription="Delete mapping" onClick={() => mapping && onDelete(mapping.id)} />
                            </TableCell>
                          );
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
