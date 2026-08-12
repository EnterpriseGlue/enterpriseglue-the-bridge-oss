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
  TableRow,
  TableToolbar,
  TableToolbarContent,
  Tag,
  Modal,
} from '@carbon/react';
import { Add } from '@carbon/icons-react';
import type { AuthzPolicy, PolicyCondition } from '../../hooks/useAuthzApi';
import { DataTableDataRow, DataTableHeaderCell, dataTableHeaderKey } from './dataTablePrimitives';
import { GuardedOverflowMenu, GuardedOverflowMenuItem } from '../../../../shared/auth/guards';
import { configurationOwnershipDescription, configurationOwnershipLabel } from '../../identityAccessCopy';

const authzPolicyHeaders = [
  { key: 'name', header: 'Policy' },
  { key: 'effect', header: 'Effect' },
  { key: 'resourceType', header: 'Resource type' },
  { key: 'action', header: 'Permission' },
  { key: 'priority', header: 'Priority' },
  { key: 'conditions', header: 'Conditions' },
  { key: 'status', header: 'Status' },
  { key: 'source', header: 'Management source' },
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
  const [deleteTarget, setDeleteTarget] = React.useState<AuthzPolicy | null>(null);
  if (loading) return <DataTableSkeleton headers={authzPolicyHeaders} rowCount={5} />;

  return (
    <>
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
        source: policy.ownershipMode || 'manual',
        actions: '',
      }))} headers={authzPolicyHeaders}>
        {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
          <>
            <TableToolbar><TableToolbarContent>
              <Button kind="primary" renderIcon={Add} onClick={onCreate} disabled={!canManage} title={manageUnavailableReason}>Add policy</Button>
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
                      if (cell.info.header === 'source') return <TableCell key={cell.id}><Tag type={policy?.ownershipMode === 'config_warn' ? 'warm-gray' : policy?.ownershipMode === 'config_locked' ? 'purple' : 'gray'} title={configurationOwnershipDescription(policy?.ownershipMode, policy?.sourceRef)}>{configurationOwnershipLabel(policy?.ownershipMode)}</Tag>{policy?.driftStatus === 'drifted' && <Tag type="red">Drifted</Tag>}</TableCell>;
                      if (cell.info.header === 'action') return <TableCell key={cell.id}><code>{cell.value}</code></TableCell>;
                      if (cell.info.header === 'actions') return <TableCell key={cell.id}>{policy && (
                        <GuardedOverflowMenu size="sm" flipped iconDescription={`Actions for ${policy.name}`}>
                          <GuardedOverflowMenuItem itemText="Edit" disabled={pending || !canManage || policy.ownershipMode === 'config_locked'} unavailableReason={policy.ownershipMode === 'config_locked' ? configurationOwnershipDescription(policy.ownershipMode, policy.sourceRef) : manageUnavailableReason} onClick={() => onEdit(policy)} />
                          <GuardedOverflowMenuItem itemText={policy.isActive ? 'Disable' : 'Enable'} disabled={pending || !canManage || policy.ownershipMode === 'config_locked'} unavailableReason={policy.ownershipMode === 'config_locked' ? configurationOwnershipDescription(policy.ownershipMode, policy.sourceRef) : manageUnavailableReason} onClick={() => onToggle(policy)} />
                          <GuardedOverflowMenuItem itemText="Delete" isDelete hasDivider disabled={pending || !canManage || policy.ownershipMode === 'config_locked'} unavailableReason={policy.ownershipMode === 'config_locked' ? configurationOwnershipDescription(policy.ownershipMode, policy.sourceRef) : manageUnavailableReason} onClick={() => setDeleteTarget(policy)} />
                        </GuardedOverflowMenu>
                      )}</TableCell>;
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
    <Modal
      open={Boolean(deleteTarget)}
      danger
      modalHeading="Delete authorization policy"
      primaryButtonText="Delete"
      secondaryButtonText="Cancel"
      primaryButtonDisabled={pending || !canManage}
      onRequestClose={() => setDeleteTarget(null)}
      onRequestSubmit={() => {
        if (!deleteTarget) return;
        onDelete(deleteTarget.id);
        setDeleteTarget(null);
      }}
    >
      <p>Delete <strong>{deleteTarget?.name}</strong>? Existing role assignments remain, but this policy will no longer affect authorization decisions.</p>
    </Modal>
    </>
  );
}
