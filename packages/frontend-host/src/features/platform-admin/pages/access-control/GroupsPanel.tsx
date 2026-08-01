import React from 'react';
import {
  Button,
  DataTable,
  DataTableSkeleton,
  InlineNotification,
  Modal,
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
import type { AuthzGroup, AuthzGroupMembership } from '../../hooks/useAuthzApi';
import { AssignmentSourceTag } from './AssignmentSourceTag';
import { DataTableDataRow, DataTableHeaderCell, dataTableHeaderKey } from './dataTablePrimitives';
import { GuardedOverflowMenu, GuardedOverflowMenuItem } from '../../../../shared/auth/guards';
import { UserPrincipalPicker } from '../../components/UserPrincipalPicker';

const authzGroupHeaders = [
  { key: 'name', header: 'Group' },
  { key: 'key', header: 'Key' },
  { key: 'source', header: 'Source' },
  { key: 'members', header: 'Members' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: '' },
];

const authzGroupMembershipHeaders = [
  { key: 'userId', header: 'User' },
  { key: 'source', header: 'Membership sources' },
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
  return source === 'config' ? 'Managed by configuration' : String(source || '-');
}

function membershipSourcePresentation(membership: AuthzGroupMembership): {
  label: string;
  technicalReference: string | null;
} {
  const source = String(membership.source);
  if (source === 'system' && membership.sourceRef === 'bootstrap:initial-admin') {
    return {
      label: 'Initial platform administrator',
      technicalReference: membership.sourceRef,
    };
  }
  if (source === 'manual' && membership.sourceRef === 'admin:break-glass-review') {
    return {
      label: 'Administrator recovery review',
      technicalReference: membership.sourceRef,
    };
  }
  if (source === 'manual' && !membership.sourceRef) {
    return {
      label: 'Manual administrator change',
      technicalReference: null,
    };
  }
  return {
    label: membership.sourceRef || 'No source reference',
    technicalReference: null,
  };
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
  const [archiveTarget, setArchiveTarget] = React.useState<AuthzGroup | null>(null);
  const [removeMembershipTarget, setRemoveMembershipTarget] = React.useState<AuthzGroupMembership | null>(null);
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) || groups.find((group) => !group.isArchived) || groups[0] || null;
  const selectedMemberships = selectedGroup ? memberships.filter((membership) => membership.groupId === selectedGroup.id) : [];
  const selectedMembershipGroups = Array.from(
    selectedMemberships.reduce<Map<string, AuthzGroupMembership[]>>((byUser, membership) => {
      const entries = byUser.get(membership.userId) || [];
      entries.push(membership);
      byUser.set(membership.userId, entries);
      return byUser;
    }, new Map()),
  ).map(([userId, entries]) => ({ userId, entries }));
  const canManageSelectedGroup = Boolean(selectedGroup && isEditableGroup(selectedGroup) && !selectedGroup.isArchived && canManage);
  const selectedGroupUnavailableReason = !canManage
    ? 'You can view this group, but you do not have permission to change its membership.'
    : selectedGroup && !isEditableGroup(selectedGroup)
      ? selectedGroup?.source === 'config' && selectedGroup.ownershipMode === 'config_locked'
        ? 'This group is locked by its configuration bundle.'
        : 'Source-owned groups are managed by their source.'
      : selectedGroup?.isArchived
        ? 'Archived groups cannot be changed.'
        : undefined;

  React.useEffect(() => {
    setMemberUserId('');
  }, [selectedGroup?.id]);

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
            members: new Set(
              memberships
                .filter((membership) => membership.groupId === group.id)
                .map((membership) => membership.userId),
            ).size,
            status: group.isArchived ? 'Archived' : 'Active',
            actions: '',
          }))}
          headers={authzGroupHeaders}
        >
          {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
            <>
              <TableToolbar>
                <TableToolbarContent>
                  <Button kind="primary" renderIcon={Add} onClick={onCreate} disabled={!canManage} title={canManage ? undefined : 'You can view groups, but you do not have permission to create or change them.'}>
                    Create group
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
                      ? 'You can view this group, but you do not have permission to change it.'
                      : !editable
                        ? group?.source === 'config' && group.ownershipMode === 'config_locked'
                          ? 'This group is locked by its configuration bundle.'
                          : 'Source-owned groups are managed by their source.'
                        : group?.isArchived
                          ? 'Archived groups cannot be changed.'
                          : undefined;
                    return (
                      <DataTableDataRow
                        key={row.id}
                        row={row}
                        getRowProps={getRowProps}
                        aria-selected={group?.id === selectedGroup?.id}
                        style={group?.id === selectedGroup?.id ? { boxShadow: 'inset 3px 0 0 var(--cds-link-primary)', background: 'var(--cds-layer-selected-01)' } : undefined}
                      >
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'source') {
                            return <TableCell key={cell.id}><div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}><Tag type={group?.source === 'config' && group.ownershipMode === 'config_warn' ? 'warm-gray' : authzSourceTagType(cell.value)}>{group?.source === 'config' && group.ownershipMode === 'config_warn' ? 'Configuration-linked' : formatAuthzSource(cell.value)}</Tag>{group?.driftStatus === 'drifted' && <Tag type="red">Different from configuration</Tag>}</div></TableCell>;
                          }
                          if (cell.info.header === 'status') {
                            return <TableCell key={cell.id}><Tag type={cell.value === 'Active' ? 'green' : 'gray'}>{cell.value}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {group && (
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--spacing-2)' }}>
                                    {rowUnavailableReason && <Tag type="gray" title={rowUnavailableReason}>Read-only</Tag>}
                                    <GuardedOverflowMenu size="sm" flipped iconDescription={`Actions for ${group.name}`}>
                                      <GuardedOverflowMenuItem itemText="View members" onClick={() => onSelectGroup(group.id)} />
                                      <GuardedOverflowMenuItem itemText="Edit" disabled={pending || Boolean(rowUnavailableReason)} unavailableReason={rowUnavailableReason} onClick={() => onEdit(group)} />
                                      {!group.isArchived && (
                                        <GuardedOverflowMenuItem itemText="Archive" isDelete disabled={pending || Boolean(rowUnavailableReason)} unavailableReason={rowUnavailableReason} onClick={() => setArchiveTarget(group)} />
                                      )}
                                    </GuardedOverflowMenu>
                                  </div>
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
          <InlineNotification
            kind={canManageSelectedGroup ? 'info' : 'warning'}
            lowContrast
            hideCloseButton
            title={canManageSelectedGroup ? 'You can add manual members' : 'Membership is managed elsewhere'}
            subtitle={canManageSelectedGroup
              ? 'Manual members can be added or removed here. SSO and configuration-managed memberships remain owned by their source.'
              : 'Membership in this system group is updated automatically. You can review each membership source here, but you cannot add or remove members.'}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) auto', gap: 'var(--spacing-4)', alignItems: 'end' }}>
            <UserPrincipalPicker
              id="group-member-user"
              labelText="User"
              value={memberUserId}
              disabled={!canManageSelectedGroup || pending}
              onChange={setMemberUserId}
            />
            <Button
              disabled={!memberUserId.trim() || !canManageSelectedGroup || pending}
              title={selectedGroupUnavailableReason}
              onClick={() => {
                onAddMembership(memberUserId.trim());
                setMemberUserId('');
              }}
            >
              Add member
            </Button>
          </div>
          {membershipsLoading ? (
            <DataTableSkeleton headers={authzGroupMembershipHeaders} rowCount={3} />
          ) : (
            <TableContainer>
              <DataTable
                rows={selectedMembershipGroups.map(({ userId, entries }) => ({
                  id: userId,
                  userId,
                  source: entries.map((membership) => membership.source).join(', '),
                  expires: entries.some((membership) => membership.expiresAt == null)
                    ? 'Never'
                    : new Date(Math.max(...entries.map((membership) => membership.expiresAt || 0))).toLocaleString(),
                  created: new Date(Math.min(...entries.map((membership) => membership.createdAt))).toLocaleString(),
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
                        const membershipGroup = selectedMembershipGroups.find((item) => item.userId === row.id);
                        const manualMembership = membershipGroup?.entries.find((membership) => membership.source === 'manual') || null;
                        const canRemove = canManageSelectedGroup && Boolean(manualMembership);
                        return (
                          <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                            {row.cells.map((cell) => {
                              if (cell.info.header === 'source') {
                                return (
                                  <TableCell key={cell.id}>
                                    <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
                                      {membershipGroup?.entries.map((membership) => {
                                        const sourcePresentation = membershipSourcePresentation(membership);
                                        return (
                                          <div key={membership.id} style={{ display: 'grid', gap: 'var(--spacing-1)' }}>
                                            <AssignmentSourceTag source={membership.source} />
                                            <span style={{ color: 'var(--cds-text-secondary)', fontSize: '0.75rem', overflowWrap: 'anywhere' }}>
                                              {sourcePresentation.label}
                                            </span>
                                            {sourcePresentation.technicalReference && (
                                              <span style={{ color: 'var(--cds-text-helper)', fontSize: '0.75rem', overflowWrap: 'anywhere' }}>
                                                {sourcePresentation.technicalReference}
                                              </span>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </TableCell>
                                );
                              }
                              if (cell.info.header === 'userId') {
                                const membership = membershipGroup?.entries[0];
                                const primary = membership?.userDisplayName || membership?.userEmail || membership?.userId || String(cell.value);
                                return (
                                  <TableCell key={cell.id}>
                                    <div style={{ display: 'grid', gap: 'var(--spacing-1)' }}>
                                      <span>{primary}</span>
                                      {membership?.userEmail && membership.userEmail !== primary && (
                                        <span style={{ color: 'var(--cds-text-secondary)', fontSize: '0.75rem' }}>{membership.userEmail}</span>
                                      )}
                                      <span style={{ color: 'var(--cds-text-helper)', fontSize: '0.75rem', overflowWrap: 'anywhere' }}>
                                        {membership?.userId || cell.value}
                                      </span>
                                    </div>
                                  </TableCell>
                                );
                              }
                              if (cell.info.header === 'actions') {
                                return (
                                  <TableCell key={cell.id}>
                                    {membershipGroup && (
                                      <Button
                                        kind="ghost"
                                        size="sm"
                                        renderIcon={TrashCan}
                                        hasIconOnly
                                        iconDescription="Remove group member"
                                        disabled={pending || !canRemove}
                                        title={canRemove
                                          ? undefined
                                          : manualMembership
                                            ? selectedGroupUnavailableReason
                                            : 'Source-managed memberships are updated by their source'}
                                        onClick={() => {
                                          if (manualMembership) setRemoveMembershipTarget(manualMembership);
                                        }}
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
      <Modal
        open={Boolean(archiveTarget)}
        danger
        modalHeading="Archive authorization group"
        primaryButtonText="Archive"
        secondaryButtonText="Cancel"
        primaryButtonDisabled={pending}
        onRequestClose={() => setArchiveTarget(null)}
        onRequestSubmit={() => {
          if (!archiveTarget) return;
          onArchive(archiveTarget.id);
          setArchiveTarget(null);
        }}
      >
        Archive <strong>{archiveTarget?.name}</strong>? Existing source lineage remains available for audit, but the group cannot receive new manual memberships or assignments.
      </Modal>
      <Modal
        open={Boolean(removeMembershipTarget)}
        danger
        modalHeading="Remove manual group member"
        primaryButtonText="Remove member"
        secondaryButtonText="Cancel"
        primaryButtonDisabled={pending}
        onRequestClose={() => setRemoveMembershipTarget(null)}
        onRequestSubmit={() => {
          if (!removeMembershipTarget) return;
          onRemoveMembership(removeMembershipTarget.id);
          setRemoveMembershipTarget(null);
        }}
      >
        Remove <strong>{removeMembershipTarget?.userDisplayName || removeMembershipTarget?.userEmail || removeMembershipTarget?.userId}</strong> from <strong>{selectedGroup?.name}</strong>? Their access from this manual membership will end immediately. Memberships managed by sign-in providers or configuration will not change.
        {removeMembershipTarget?.userEmail && removeMembershipTarget.userEmail !== removeMembershipTarget.userDisplayName ? (
          <span style={{ display: 'block', marginTop: 'var(--spacing-3)', color: 'var(--cds-text-secondary)', overflowWrap: 'anywhere' }}>
            Email: {removeMembershipTarget.userEmail}
          </span>
        ) : null}
        {removeMembershipTarget?.userId && (removeMembershipTarget.userDisplayName || removeMembershipTarget.userEmail) ? (
          <span style={{ display: 'block', marginTop: 'var(--spacing-2)', color: 'var(--cds-text-secondary)', overflowWrap: 'anywhere' }}>
            User ID: {removeMembershipTarget.userId}
          </span>
        ) : null}
      </Modal>
    </div>
  );
}
