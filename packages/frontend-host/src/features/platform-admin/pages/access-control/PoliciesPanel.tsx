import {
  Button,
  DataTable,
  DataTableSkeleton,
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
import { Add, TrashCan } from '@carbon/icons-react';
import type { AuthzPolicy, PolicyCondition } from '../../hooks/useAuthzApi';
import { DataTableDataRow, DataTableHeaderCell, dataTableHeaderKey } from './dataTablePrimitives';

const authzPolicyHeaders = [
  { key: 'name', header: 'Policy' },
  { key: 'effect', header: 'Effect' },
  { key: 'resourceType', header: 'Resource' },
  { key: 'action', header: 'Action' },
  { key: 'priority', header: 'Priority' },
  { key: 'conditions', header: 'Conditions' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: '' },
];

export function PoliciesPanel({
  policies,
  loading,
  pending,
  canManage,
  manageUnavailableReason,
  onCreate,
  onEdit,
  onToggle,
  onDelete,
  formatConditions,
}: {
  policies: AuthzPolicy[];
  loading: boolean;
  pending: boolean;
  canManage: boolean;
  manageUnavailableReason?: string;
  onCreate: () => void;
  onEdit: (policy: AuthzPolicy) => void;
  onToggle: (policy: AuthzPolicy) => void;
  onDelete: (id: string) => void;
  formatConditions: (conditions: PolicyCondition) => string;
}) {
  if (loading) return <DataTableSkeleton headers={authzPolicyHeaders} rowCount={5} />;

  return (
    <TableContainer>
      <DataTable rows={policies.map((policy) => ({
        id: policy.id,
        name: policy.name,
        effect: policy.effect,
        resourceType: policy.resourceType || 'All resources',
        action: policy.action || 'All actions',
        priority: policy.priority,
        conditions: formatConditions(policy.conditions),
        status: policy.isActive,
        actions: '',
      }))} headers={authzPolicyHeaders}>
        {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
          <>
            <TableToolbar><TableToolbarContent>
              <Button kind="primary" renderIcon={Add} onClick={onCreate} disabled={!canManage} title={manageUnavailableReason}>Add Policy</Button>
            </TableToolbarContent></TableToolbar>
            <Table {...getTableProps()} size="md">
              <TableHead><TableRow>{headers.map((header) => <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />)}</TableRow></TableHead>
              <TableBody>
                {rows.length === 0 ? <TableRow><TableCell colSpan={headers.length}>No authorization policies are configured.</TableCell></TableRow> : rows.map((row) => {
                  const policy = policies.find((item) => item.id === row.id);
                  return <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                    {row.cells.map((cell) => {
                      if (cell.info.header === 'effect') return <TableCell key={cell.id}><Tag type={cell.value === 'deny' ? 'red' : 'green'}>{cell.value === 'deny' ? 'Deny' : 'Allow'}</Tag></TableCell>;
                      if (cell.info.header === 'status') return <TableCell key={cell.id}><Tag type={cell.value ? 'green' : 'gray'}>{cell.value ? 'Active' : 'Inactive'}</Tag></TableCell>;
                      if (cell.info.header === 'action') return <TableCell key={cell.id}><code>{cell.value}</code></TableCell>;
                      if (cell.info.header === 'actions') return <TableCell key={cell.id}>{policy && <>
                        <Button kind="ghost" size="sm" disabled={pending || !canManage} title={manageUnavailableReason} onClick={() => onEdit(policy)}>Edit</Button>
                        <Button kind="ghost" size="sm" disabled={pending || !canManage} title={manageUnavailableReason} onClick={() => onToggle(policy)}>{policy.isActive ? 'Disable' : 'Enable'}</Button>
                        <Button kind="ghost" size="sm" disabled={pending || !canManage} title={manageUnavailableReason} renderIcon={TrashCan} onClick={() => onDelete(policy.id)}>Delete</Button>
                      </>}</TableCell>;
                      return <TableCell key={cell.id}>{cell.value}</TableCell>;
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
