import React from 'react'
import {
  Button,
  DataTable,
  DataTableSkeleton,
  InlineNotification,
  Tag,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
  OverflowMenu,
  OverflowMenuItem,
  ComposedModal,
  ModalHeader,
  ModalBody,
} from '@carbon/react'
import { StarbaseTableShell } from '../../components/StarbaseTableShell'
import type { ProjectMember, ProjectPendingInvite, ProjectRole } from '../../components/project-detail'

function formatInviteDate(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return ''
  return new Date(timestamp).toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function inviteStatusLabel(status: ProjectPendingInvite['status']): string {
  switch (status) {
    case 'expired':
      return 'expired'
    case 'onboarding':
      return 'onboarding'
    case 'pending':
    default:
      return 'pending'
  }
}

function inviteStatusTagType(status: ProjectPendingInvite['status']): 'red' | 'purple' | 'blue' {
  switch (status) {
    case 'expired':
      return 'red'
    case 'onboarding':
      return 'purple'
    case 'pending':
    default:
      return 'blue'
  }
}

function inviteStatusDescription(invite: ProjectPendingInvite): string {
  if (invite.status === 'expired') {
    return `Expired on ${formatInviteDate(invite.expiresAt)}`
  }

  if (invite.status === 'onboarding') {
    return `Invite accepted. Account setup is still in progress.`
  }

  return `Waiting for acceptance until ${formatInviteDate(invite.expiresAt)}`
}

interface ProjectMembersModalProps {
  open: boolean
  onClose: () => void
  membersLoading: boolean
  membersError: boolean
  members: ProjectMember[]
  pendingInvites: ProjectPendingInvite[]
  memberHeaders: Array<{ key: string; header: string }>
  visibleRows: Array<{ id: string; name?: string; email?: string }>
  visiblePendingInvites: ProjectPendingInvite[]
  collaboratorsSearch: string
  setCollaboratorsSearch: (value: string) => void
  collaboratorsSearchExpanded: boolean
  setCollaboratorsSearchExpanded: (value: boolean) => void
  canManageMembers: boolean
  onAddUser: () => void
  onReissuePendingInvite: (invite: ProjectPendingInvite) => void
  onEditRoles: (member: ProjectMember) => void
  onToggleDeploy: (member: ProjectMember, next: boolean) => void
  onRemove: (member: ProjectMember) => void
  tagTypeForRole: (role: ProjectRole) => any
}

export const ProjectMembersModal = ({
  open,
  onClose,
  membersLoading,
  membersError,
  members,
  pendingInvites,
  memberHeaders,
  visibleRows,
  visiblePendingInvites,
  collaboratorsSearch,
  setCollaboratorsSearch,
  collaboratorsSearchExpanded,
  setCollaboratorsSearchExpanded,
  canManageMembers,
  onAddUser,
  onReissuePendingInvite,
  onEditRoles,
  onToggleDeploy,
  onRemove,
  tagTypeForRole,
}: ProjectMembersModalProps) => {
  const pendingRows = visiblePendingInvites.map((invite) => ({
    id: `invite:${invite.invitationId}`,
    name: `${invite.firstName || ''}${invite.firstName && invite.lastName ? ' ' : ''}${invite.lastName || ''}`.trim() || invite.email.split('@')[0],
    email: invite.email,
  }))
  const tableRows = [...pendingRows, ...visibleRows]

  return (
    <ComposedModal open={open} size="lg" onClose={onClose}>
      <ModalHeader label="" title="Project members" closeModal={onClose} />
      <ModalBody>
        <div data-eg-collaborators-panel>
          {membersLoading && (
            <div style={{ paddingTop: 'var(--spacing-3)' }}>
              <DataTableSkeleton showHeader={false} showToolbar={false} rowCount={6} columnCount={memberHeaders.length} headers={memberHeaders as any} />
            </div>
          )}
          {membersError && (
            <div style={{ paddingTop: 'var(--spacing-3)' }}>
              <InlineNotification lowContrast kind="error" title="Failed to load members" />
            </div>
          )}

          {!membersLoading && !membersError && (
            <div style={{ height: '60vh', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <DataTable rows={tableRows} headers={memberHeaders}>
                  {({ rows, headers, getHeaderProps, getRowProps, getTableProps, getToolbarProps }) => {
                    const toolbarProps: any = getToolbarProps()
                    return (
                      <StarbaseTableShell>
                        <TableToolbar
                          {...toolbarProps}
                          className={`${toolbarProps.className || ''} cds--table-toolbar--sm`.trim()}
                        >
                          <TableToolbarContent>
                            <TableToolbarSearch
                              size="sm"
                              expanded={collaboratorsSearchExpanded}
                              onExpand={() => setCollaboratorsSearchExpanded(true)}
                              onBlur={() => {
                                if (!collaboratorsSearch) setCollaboratorsSearchExpanded(false)
                              }}
                              value={collaboratorsSearch}
                              onChange={(e: any) => setCollaboratorsSearch(e.target.value)}
                              placeholder="Search members and invitations"
                            />
                            {canManageMembers && (
                              <Button kind="primary" size="sm" onClick={onAddUser}>
                                Add user
                              </Button>
                            )}
                          </TableToolbarContent>
                        </TableToolbar>

                        <Table {...getTableProps()} size="sm">
                          <TableHead>
                            <TableRow>
                              {headers.map((h) => {
                                const { key, ...headerProps } = getHeaderProps({ header: h })
                                return (
                                  <TableHeader
                                    key={key}
                                    {...headerProps}
                                    style={h.key === 'actions' ? { width: 44 } : undefined}
                                  >
                                    {h.header}
                                  </TableHeader>
                                )
                              })}
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {rows.map((r) => {
                              const rowProps: any = getRowProps({ row: r })
                              const pendingInvite = r.id.startsWith('invite:')
                                ? visiblePendingInvites.find((invite) => `invite:${invite.invitationId}` === r.id)
                                : null
                              const member = pendingInvite ? null : members.find((m: ProjectMember) => m.userId === r.id)
                              const roles = pendingInvite
                                ? ((Array.isArray(pendingInvite.roles) && pendingInvite.roles.length > 0 ? pendingInvite.roles : [pendingInvite.role]) as ProjectRole[])
                                : member
                                  ? ((Array.isArray(member.roles) && member.roles.length > 0 ? member.roles : [member.role]) as ProjectRole[])
                                  : ([] as ProjectRole[])
                              const isOwner = roles.includes('owner')
                              const isEditor = String(member?.role) === 'editor'
                              const name = r.cells.find((c) => c.info.header === 'name')?.value
                              const email = pendingInvite?.email || member?.user?.email || ''
                              const canReissuePendingInvite = Boolean(
                                canManageMembers &&
                                pendingInvite &&
                                pendingInvite.deliveryMethod === 'manual' &&
                                pendingInvite.status !== 'onboarding'
                              )

                              return (
                                <TableRow key={rowProps.key} {...rowProps}>
                                  <TableCell style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                                      {email ? (
                                        <div style={{ color: 'var(--cds-text-secondary, #6f6f6f)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                          {email}
                                        </div>
                                      ) : null}
                                      {pendingInvite ? (
                                        <div style={{ color: 'var(--cds-text-secondary, #6f6f6f)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                          {inviteStatusDescription(pendingInvite)}
                                        </div>
                                      ) : null}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                      {pendingInvite ? (
                                        <Tag type={inviteStatusTagType(pendingInvite.status)} size="sm">
                                          {inviteStatusLabel(pendingInvite.status)}
                                        </Tag>
                                      ) : (
                                        <>
                                          {roles.map((role) => (
                                            <Tag key={`${r.id}-${role}`} type={tagTypeForRole(role)} size="sm">
                                              {role}
                                            </Tag>
                                          ))}
                                          {isEditor && (member as any)?.deployAllowed ? (
                                            <Tag key="deploy" type="green" size="sm">
                                              deploy
                                            </Tag>
                                          ) : null}
                                        </>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell style={{ textAlign: 'right' }}>
                                    {canReissuePendingInvite ? (
                                      <OverflowMenu size="sm" flipped wrapperClasses="eg-no-tooltip" iconDescription="">
                                        <OverflowMenuItem
                                          itemText={pendingInvite?.status === 'expired' ? 'Recreate invite link and OTP' : 'Regenerate invite link and OTP'}
                                          onClick={() => pendingInvite && onReissuePendingInvite(pendingInvite)}
                                        />
                                      </OverflowMenu>
                                    ) : canManageMembers && member && !pendingInvite && !isOwner ? (
                                      <OverflowMenu size="sm" flipped iconDescription="Options">
                                        <OverflowMenuItem itemText="Edit roles" onClick={() => onEditRoles(member)} />
                                        {isEditor && (
                                          <OverflowMenuItem
                                            itemText={(member as any)?.deployAllowed ? 'Revoke deploy permission' : 'Grant deploy permission'}
                                            onClick={() => onToggleDeploy(member, !(member as any)?.deployAllowed)}
                                          />
                                        )}
                                        <OverflowMenuItem itemText="Remove" isDelete hasDivider onClick={() => onRemove(member)} />
                                      </OverflowMenu>
                                    ) : null}
                                  </TableCell>
                                </TableRow>
                              )
                            })}
                            {rows.length === 0 && (
                              <TableRow>
                                <TableCell colSpan={memberHeaders.length}>
                                  <div style={{ color: 'var(--cds-text-secondary, #6f6f6f)', padding: 'var(--spacing-3) 0' }}>
                                    {collaboratorsSearch ? 'No members or invitations match this search.' : 'No project members or pending invitations yet.'}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </StarbaseTableShell>
                    )
                  }}
                </DataTable>
              </div>
            </div>
          )}
        </div>
      </ModalBody>
    </ComposedModal>
  )
}
