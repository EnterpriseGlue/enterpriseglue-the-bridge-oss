import React from 'react';
import {
  Button,
  DataTable,
  DataTableSkeleton,
  InlineNotification,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableToolbar,
  TableToolbarContent,
  Tag,
  TextInput,
} from '@carbon/react';
import { Add, TrashCan } from '@carbon/icons-react';
import type { AuthzGroup, AuthzGroupMembership } from '../../hooks/useAuthzApi';
import { AssignmentSourceTag } from './AssignmentSourceTag';
import { DataTableDataRow, DataTableHeaderCell, dataTableHeaderKey } from './dataTablePrimitives';

const authzGroupHeaders = [
  { key: 'name', header: 'Group' },
  { key: 'key', header: 'Key' },
  { key: 'source', header: 'Source' },
  { key: 'members', header: 'Members' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: '' },
];

const authzGroupMembershipHeaders = [
  { key: 'userId', header: 'User ID' },
  { key: 'source', header: 'Source' },
  { key: 'expires', header: 'Expires' },
  { key: 'created', header: 'Created' },
  { key: 'actions', header: '' },
];

function isEditableGroup(group: AuthzGroup) {
  return !group.isSystem && (group.source === 'manual' || (group.source === 'config' && group.ownershipMode === 'config_warn'));
}

function authzSourceTagType(source: unknown): 'blue' | 'purple' | 'gray' {
  if (source === 'manual') return 'blue';
  if (source === 'config') return 'purple';
  return 'gray';
}

function formatAuthzSource(source: unknown): string {
  return source === 'config' ? 'Managed by config' : String(source || '-');
}

export function GroupsPanel({
  groups,
  memberships,
  loading,
  membershipsLoading,
  pending,
  selectedGroupId,
  canManage,
  onSelectGroup,
  onCreate,
  onEdit,
  onArchive,
  onAddMembership,
  onRemoveMembership,
}: {
  groups: AuthzGroup[];
  memberships: AuthzGroupMembership[];
  loading: boolean;
  membershipsLoading: boolean;
  pending: boolean;
  selectedGroupId: string;
  canManage: boolean;
  onSelectGroup: (id: string) => void;
  onCreate: () => void;
  onEdit: (group: AuthzGroup) => void;
  onArchive: (id: string) => void;
  onAddMembership: (userId: string) => void;
  onRemoveMembership: (id: string) => void;
}) {
  const [memberUserId, setMemberUserId] = React.useState('');
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) || groups.find((group) => !group.isArchived) || groups[0] || null;
  const selectedMemberships = selectedGroup ? memberships.filter((membership) => membership.groupId === selectedGroup.id) : [];
  const canManageSelectedGroup = Boolean(selectedGroup && isEditableGroup(selectedGroup) && !selectedGroup.isArchived && canManage);
  const selectedGroupUnavailableReason = !canManage
    ? 'Missing permission platform:authz:roles:manage'
    : selectedGroup && !isEditableGroup(selectedGroup)
      ? selectedGroup?.source === 'config' && selectedGroup.ownershipMode === 'config_locked'
        ? 'This group is locked by its configuration bundle'
        : 'Source-owned groups are managed by their source'
      : selectedGroup?.isArchived
        ? 'Archived groups cannot be changed'
        : undefined;

  if (loading) return <DataTableSkeleton headers={authzGroupHeaders} rowCount={4} />;

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
      <TableContainer>
        <DataTable
          rows={groups.map((group) => ({
            id: group.id,
            name: group.name,
            key: group.key,
            source: group.isSystem ? 'system' : group.source,
            members: memberships.filter((membership) => membership.groupId === group.id).length,
            status: group.isArchived ? 'Archived' : 'Active',
            actions: '',
          }))}
          headers={authzGroupHeaders}
        >
          {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
            <>
              <TableToolbar>
                <TableToolbarContent>
                  <Button kind="primary" renderIcon={Add} onClick={onCreate} disabled={!canManage} title={canManage ? undefined : 'Missing permission platform:authz:roles:manage'}>
                    Create Group
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
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={headers.length}>No authorization groups are configured.</TableCell>
                    </TableRow>
                  ) : rows.map((row) => {
                    const group = groups.find((item) => item.id === row.id);
                    const editable = group ? isEditableGroup(group) : false;
                    const rowUnavailableReason = !canManage
                      ? 'Missing permission platform:authz:roles:manage'
                      : !editable
                        ? group?.source === 'config' && group.ownershipMode === 'config_locked'
                          ? 'This group is locked by its configuration bundle'
                          : 'Source-owned groups are managed by their source'
                        : group?.isArchived
                          ? 'Archived groups cannot be changed'
                          : undefined;
                    return (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'source') {
                            return <TableCell key={cell.id}><div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}><Tag type={group?.source === 'config' && group.ownershipMode === 'config_warn' ? 'warm-gray' : authzSourceTagType(cell.value)}>{group?.source === 'config' && group.ownershipMode === 'config_warn' ? 'Config warning' : formatAuthzSource(cell.value)}</Tag>{group?.driftStatus === 'drifted' && <Tag type="red">Drifted</Tag>}</div></TableCell>;
                          }
                          if (cell.info.header === 'status') {
                            return <TableCell key={cell.id}><Tag type={cell.value === 'Active' ? 'green' : 'gray'}>{cell.value}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {group && (
                                  <>
                                    <Button kind="ghost" size="sm" onClick={() => onSelectGroup(group.id)}>Members</Button>
                                    <Button kind="ghost" size="sm" disabled={pending || Boolean(rowUnavailableReason)} title={rowUnavailableReason} onClick={() => onEdit(group)}>Edit</Button>
                                    {!group.isArchived && (
                                      <Button kind="ghost" size="sm" disabled={pending || Boolean(rowUnavailableReason)} title={rowUnavailableReason} renderIcon={TrashCan} onClick={() => onArchive(group.id)}>Archive</Button>
                                    )}
                                    {rowUnavailableReason && <Tag type="gray" title={rowUnavailableReason}>Read-only</Tag>}
                                  </>
                                )}
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

      {selectedGroup ? (
        <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
          <h3 style={{ margin: 0 }}>{selectedGroup.name} members</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) auto', gap: 'var(--spacing-4)', alignItems: 'end' }}>
            <TextInput
              id="group-member-user-id"
              labelText="User ID"
              value={memberUserId}
              disabled={!canManageSelectedGroup || pending}
              onChange={(event) => setMemberUserId(event.target.value)}
            />
            <Button
              disabled={!memberUserId.trim() || !canManageSelectedGroup || pending}
              title={selectedGroupUnavailableReason}
              onClick={() => {
                onAddMembership(memberUserId.trim());
                setMemberUserId('');
              }}
            >
              Add Member
            </Button>
          </div>
          {membershipsLoading ? (
            <DataTableSkeleton headers={authzGroupMembershipHeaders} rowCount={3} />
          ) : (
            <TableContainer>
              <DataTable
                rows={selectedMemberships.map((membership) => ({
                  id: membership.id,
                  userId: membership.userId,
                  source: membership.source,
                  expires: membership.expiresAt ? new Date(membership.expiresAt).toLocaleString() : 'Never',
                  created: new Date(membership.createdAt).toLocaleString(),
                  actions: '',
                }))}
                headers={authzGroupMembershipHeaders}
              >
                {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                  <Table {...getTableProps()} size="md">
                    <TableHead>
                      <TableRow>
                        {headers.map((header) => (
                          <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={headers.length}>No users are assigned to this group.</TableCell>
                        </TableRow>
                      ) : rows.map((row) => {
                        const membership = selectedMemberships.find((item) => item.id === row.id);
                        const canRemove = canManageSelectedGroup && membership?.source === 'manual';
                        return (
                          <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                            {row.cells.map((cell) => {
                              if (cell.info.header === 'source') {
                                return <TableCell key={cell.id}><AssignmentSourceTag source={cell.value} /></TableCell>;
                              }
                              if (cell.info.header === 'actions') {
                                return (
                                  <TableCell key={cell.id}>
                                    {membership && (
                                      <Button
                                        kind="ghost"
                                        size="sm"
                                        renderIcon={TrashCan}
                                        hasIconOnly
                                        iconDescription="Remove group member"
                                        disabled={pending || !canRemove}
                                        title={canRemove ? undefined : membership.source === 'manual' ? selectedGroupUnavailableReason : 'Source-managed memberships are updated by their source'}
                                        onClick={() => onRemoveMembership(membership.id)}
                                      />
                                    )}
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
                )}
              </DataTable>
            </TableContainer>
          )}
        </div>
      ) : (
        <InlineNotification kind="info" title="Create a group before adding members" lowContrast />
      )}
    </div>
  );
}
