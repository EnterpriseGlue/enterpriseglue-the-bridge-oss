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
  ComposedModal,
  ModalHeader,
  ModalBody,
} from '@carbon/react'
import { GuardedOverflowMenu, GuardedOverflowMenuItem } from '../../../../shared/auth/guards'
import { StarbaseTableShell } from '../../components/StarbaseTableShell'
import type { ProjectMember, ProjectPendingInvite, ProjectRole } from '../../components/project-detail'

type ProjectAssignmentPrincipalType = 'user' | 'group' | 'api_client' | 'service_account'
type ProjectAccessAuthorityMode = 'manual' | 'transition_to_sso' | 'sso_managed'

interface ProjectScopedRoleAssignmentRow {
  id: string
  userId?: string | null
  principalType?: ProjectAssignmentPrincipalType | null
  principalId?: string | null
  roleId: string
  roleName?: string | null
  source: 'legacy' | 'manual' | 'sso' | 'api' | 'system' | 'automation' | 'bootstrap'
  sourceMappingId?: string | null
  sourceRef?: string | null
}

const ASSIGNMENT_PRINCIPAL_TYPE_LABELS: Record<ProjectAssignmentPrincipalType, string> = {
  user: 'User',
  group: 'Group',
  api_client: 'API client',
  service_account: 'Service account',
}

const PROJECT_OWNER_ROLE = new Set<ProjectRole>(['owner'])

function hasProjectOwnerRole(roles: ProjectRole[]): boolean {
  return roles.some((role) => PROJECT_OWNER_ROLE.has(role))
}

function scopedAssignmentPrincipalType(assignment: ProjectScopedRoleAssignmentRow): ProjectAssignmentPrincipalType {
  return assignment.principalType || 'user'
}

function scopedAssignmentPrincipalId(assignment: ProjectScopedRoleAssignmentRow): string {
  return assignment.principalId || assignment.userId || ''
}

function formatScopedAssignmentPrincipal(assignment: ProjectScopedRoleAssignmentRow): string {
  const type = scopedAssignmentPrincipalType(assignment)
  const id = scopedAssignmentPrincipalId(assignment)
  return `${ASSIGNMENT_PRINCIPAL_TYPE_LABELS[type]}: ${id || 'unknown'}`
}

function formatProjectScopedRoleName(
  assignment: ProjectScopedRoleAssignmentRow,
  roleNamesById?: Map<string, string>
): string {
  if (roleNamesById?.has(assignment.roleId)) return roleNamesById.get(assignment.roleId) || assignment.roleId
  if (assignment.roleName) return assignment.roleName
  if (assignment.roleId === 'system.project.owner') return 'Project Owner'
  if (assignment.roleId === 'system.project.delegate') return 'Project Delegate'
  if (assignment.roleId === 'system.project.developer') return 'Project Developer'
  if (assignment.roleId === 'system.project.editor') return 'Project Editor'
  if (assignment.roleId === 'system.project.viewer') return 'Project Viewer'
  return assignment.roleId
}

function formatProjectScopedAssignmentSourceLineage(assignment: ProjectScopedRoleAssignmentRow): string {
  const sourceLabel = assignment.source === 'sso'
    ? 'SSO-managed assignment'
    : assignment.source === 'manual'
      ? 'Manual assignment'
      : assignment.source === 'system'
        ? 'System-managed assignment'
        : assignment.source === 'api'
          ? 'API-managed assignment'
          : assignment.source === 'legacy'
            ? 'Legacy-derived assignment'
            : `${assignment.source} assignment`
  const parts = [sourceLabel]
  if (assignment.sourceRef) parts.push(`Source ref ${assignment.sourceRef}`)
  if (assignment.sourceMappingId && assignment.sourceMappingId !== assignment.sourceRef) {
    parts.push(`${assignment.source === 'sso' ? 'SSO mapping' : 'Mapping'} ${assignment.sourceMappingId}`)
  }
  return parts.join('; ')
}

function tagTypeForAssignmentSource(source: ProjectScopedRoleAssignmentRow['source']): 'blue' | 'green' | 'purple' | 'gray' {
  switch (source) {
    case 'manual':
      return 'green'
    case 'sso':
      return 'purple'
    case 'api':
    case 'automation':
      return 'blue'
    case 'system':
    case 'bootstrap':
    case 'legacy':
    default:
      return 'gray'
  }
}

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
  canAddMembers?: boolean
  canInviteMembers?: boolean
  canUpdateMemberRoles?: boolean
  canRemoveMembers?: boolean
  canManageMemberDeployGrant?: boolean
  canTransferOwnership?: boolean
  canAssignScopedAccess?: boolean
  projectAccessAuthority?: ProjectAccessAuthorityMode
  scopedAssignmentsVisible?: boolean
  scopedAssignmentsLoading?: boolean
  scopedAssignmentsError?: boolean
  scopedRoleAssignments?: ProjectScopedRoleAssignmentRow[]
  scopedRoleNamesById?: Map<string, string>
  customRoleTagsByUser?: Map<string, Array<{ id: string; label: string; lineage?: string }>>
  onAddUser: () => void
  onAssignAccess?: () => void
  onReissuePendingInvite: (invite: ProjectPendingInvite) => void
  onEditRoles: (member: ProjectMember) => void
  onToggleDeploy: (member: ProjectMember, next: boolean) => void
  onRemove: (member: ProjectMember) => void
  onTransferOwnership?: (member: ProjectMember) => void
  onRemoveScopedAssignment?: (assignment: ProjectScopedRoleAssignmentRow) => void
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
  canAddMembers = canManageMembers,
  canInviteMembers = canManageMembers,
  canUpdateMemberRoles = canManageMembers,
  canRemoveMembers = canManageMembers,
  canManageMemberDeployGrant = canManageMembers,
  canTransferOwnership = false,
  canAssignScopedAccess = false,
  projectAccessAuthority = 'manual',
  scopedAssignmentsVisible = false,
  scopedAssignmentsLoading = false,
  scopedAssignmentsError = false,
  scopedRoleAssignments = [],
  scopedRoleNamesById,
  customRoleTagsByUser,
  onAddUser,
  onAssignAccess,
  onReissuePendingInvite,
  onEditRoles,
  onToggleDeploy,
  onRemove,
  onTransferOwnership,
  onRemoveScopedAssignment,
  tagTypeForRole,
}: ProjectMembersModalProps) => {
  const pendingRows = visiblePendingInvites.map((invite) => ({
    id: `invite:${invite.invitationId}`,
    name: `${invite.firstName || ''}${invite.firstName && invite.lastName ? ' ' : ''}${invite.lastName || ''}`.trim() || invite.email.split('@')[0],
    email: invite.email,
  }))
  const tableRows = [...pendingRows, ...visibleRows]
  const manualProjectAccessEnabled = projectAccessAuthority !== 'sso_managed'
  const canOpenAddMember = manualProjectAccessEnabled && (canAddMembers || canInviteMembers)
  const canUseScopedAssignmentControls = manualProjectAccessEnabled && canAssignScopedAccess
  const sourceManagedProjectAccessReason = projectAccessAuthority === 'sso_managed'
    ? 'Project access is managed by SSO. Manual project member changes are disabled.'
    : projectAccessAuthority === 'transition_to_sso'
      ? 'Project access is transitioning to SSO. Manual and source-managed access are shown together.'
      : null

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
              {sourceManagedProjectAccessReason ? (
                <InlineNotification
                  lowContrast
                  kind={projectAccessAuthority === 'sso_managed' ? 'info' : 'warning'}
                  title={projectAccessAuthority === 'sso_managed' ? 'Project access is SSO-managed' : 'Project access transition'}
                  subtitle={sourceManagedProjectAccessReason}
                  hideCloseButton
                  style={{ marginBottom: 'var(--spacing-3)' }}
                />
              ) : null}
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
                            {canOpenAddMember && (
                              <Button kind="primary" size="sm" onClick={onAddUser}>
                                {canInviteMembers ? 'Invite user' : 'Add user'}
                              </Button>
                            )}
                            {canUseScopedAssignmentControls && onAssignAccess && (
                              <Button kind="secondary" size="sm" onClick={onAssignAccess}>
                                Assign access
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
                              const isOwner = hasProjectOwnerRole(roles)
                              // `deployAllowed` is `boolean` only when the server's
                              // canonical project file-edit decision makes this member
                              // eligible for a deploy grant. `null` is an ineligible
                              // member, so no legacy role label participates in this UI.
                              const isDeployGrantEligible = typeof member?.deployAllowed === 'boolean'
                              const name = r.cells.find((c) => c.info.header === 'name')?.value
                              const email = pendingInvite?.email || member?.user?.email || ''
                              const customRoleTags = member ? customRoleTagsByUser?.get(member.userId) || [] : []
                              const customRoleLineages = customRoleTags
                                .map((role) => role.lineage)
                                .filter((lineage): lineage is string => Boolean(lineage && lineage !== '-'))
                              const canReissuePendingInvite = Boolean(
                                canInviteMembers &&
                                pendingInvite &&
                                pendingInvite.deliveryMethod === 'manual' &&
                                pendingInvite.status !== 'onboarding'
                              )
                              const canShowMemberActions = Boolean(
                                member &&
                                !pendingInvite &&
                                !isOwner &&
                                manualProjectAccessEnabled &&
                                (canUpdateMemberRoles || (isDeployGrantEligible && canManageMemberDeployGrant) || canTransferOwnership || canRemoveMembers)
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
                                          {isDeployGrantEligible && member?.deployAllowed ? (
                                            <Tag key="deploy" type="green" size="sm">
                                              deploy
                                            </Tag>
                                          ) : null}
                                          {customRoleTags.map((role) => (
                                            <Tag key={role.id} type="cyan" size="sm">
                                              {role.label}
                                            </Tag>
                                          ))}
                                        </>
                                      )}
                                    </div>
                                    {customRoleLineages.length > 0 ? (
                                      <div style={{ marginTop: 6, color: 'var(--cds-text-secondary, #6f6f6f)', fontSize: 12, overflowWrap: 'anywhere' }}>
                                        Lineage: {customRoleLineages.join(' | ')}
                                      </div>
                                    ) : null}
                                  </TableCell>
                                  <TableCell style={{ textAlign: 'right' }}>
                                    {canReissuePendingInvite ? (
                                      <GuardedOverflowMenu size="sm" flipped wrapperClasses="eg-no-tooltip" iconDescription="Invitation options">
                                        <GuardedOverflowMenuItem
                                          itemText={pendingInvite?.status === 'expired' ? 'Recreate invite link and OTP' : 'Regenerate invite link and OTP'}
                                          onClick={() => pendingInvite && onReissuePendingInvite(pendingInvite)}
                                        />
                                      </GuardedOverflowMenu>
                                    ) : canShowMemberActions ? (
                                      <GuardedOverflowMenu size="sm" flipped iconDescription="Options">
                                        {canUpdateMemberRoles ? (
                                          <GuardedOverflowMenuItem itemText="Edit roles" onClick={() => onEditRoles(member as ProjectMember)} />
                                        ) : null}
                                        {isDeployGrantEligible && canManageMemberDeployGrant ? (
                                          <GuardedOverflowMenuItem
                                            itemText={member?.deployAllowed ? 'Revoke deploy permission' : 'Grant deploy permission'}
                                            onClick={() => onToggleDeploy(member as ProjectMember, !member?.deployAllowed)}
                                          />
                                        ) : null}
                                        {canTransferOwnership && onTransferOwnership ? (
                                          <GuardedOverflowMenuItem
                                            itemText="Transfer ownership"
                                            hasDivider={canUpdateMemberRoles || (isDeployGrantEligible && canManageMemberDeployGrant)}
                                            onClick={() => onTransferOwnership(member as ProjectMember)}
                                          />
                                        ) : null}
                                        {canRemoveMembers ? (
                                          <GuardedOverflowMenuItem itemText="Remove" isDelete hasDivider={canUpdateMemberRoles || (isDeployGrantEligible && canManageMemberDeployGrant) || canTransferOwnership} onClick={() => onRemove(member as ProjectMember)} />
                                        ) : null}
                                      </GuardedOverflowMenu>
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

                {scopedAssignmentsVisible ? (
                  <div style={{ marginTop: 'var(--spacing-5)', padding: 'var(--spacing-4)', background: 'var(--cds-layer-02)', borderRadius: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)', marginBottom: 'var(--spacing-3)' }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>Scoped RBAC assignments</div>
                        <div style={{ fontSize: 12, color: 'var(--cds-text-secondary)' }}>
                          Principal-scoped access from the authorization model. Legacy project members remain listed above during migration.
                        </div>
                      </div>
                      <Tag type="gray" size="sm">{scopedRoleAssignments.length} scoped</Tag>
                    </div>
                    {scopedAssignmentsLoading ? (
                      <DataTableSkeleton showHeader={false} showToolbar={false} rowCount={3} columnCount={3} headers={[
                        { key: 'principal', header: 'Principal' },
                        { key: 'role', header: 'Role' },
                        { key: 'source', header: 'Source' },
                      ] as any} />
                    ) : scopedAssignmentsError ? (
                      <InlineNotification lowContrast kind="error" title="Failed to load scoped assignments" hideCloseButton />
                    ) : scopedRoleAssignments.length === 0 ? (
                      <div style={{ color: 'var(--cds-text-secondary)', fontSize: 13 }}>No scoped RBAC assignments yet.</div>
                    ) : (
                      <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
                        {scopedRoleAssignments.map((assignment) => (
                          <div
                            key={assignment.id}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr) auto',
                              alignItems: 'center',
                              gap: 'var(--spacing-3)',
                              padding: 'var(--spacing-3)',
                              background: 'var(--cds-layer-01)',
                              borderRadius: 4,
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 500 }}>
                                {formatScopedAssignmentPrincipal(assignment)}
                              </div>
                              <div style={{ color: 'var(--cds-text-secondary)', fontSize: 12 }}>
                                {ASSIGNMENT_PRINCIPAL_TYPE_LABELS[scopedAssignmentPrincipalType(assignment)]}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <Tag type={assignment.roleId.startsWith('system.') ? 'blue' : 'cyan'} size="sm">
                                {formatProjectScopedRoleName(assignment, scopedRoleNamesById)}
                              </Tag>
                              <Tag type={tagTypeForAssignmentSource(assignment.source)} size="sm">
                                {assignment.source}
                              </Tag>
                            </div>
                            {assignment.source === 'manual' && manualProjectAccessEnabled && onRemoveScopedAssignment ? (
                              <Button
                                kind="ghost"
                                size="sm"
                                onClick={() => onRemoveScopedAssignment(assignment)}
                              >
                                Remove
                              </Button>
                            ) : (
                              <Tag type="gray" size="sm">
                                {assignment.source === 'sso' && projectAccessAuthority === 'sso_managed' ? 'managed by SSO mapping' : 'managed'}
                              </Tag>
                            )}
                            <div style={{ gridColumn: '1 / -1', color: 'var(--cds-text-secondary)', fontSize: 12, overflowWrap: 'anywhere' }}>
                              Lineage: {formatProjectScopedAssignmentSourceLineage(assignment)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </ModalBody>
    </ComposedModal>
  )
}
