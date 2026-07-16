import React from 'react'
import { Button, Checkbox, InlineNotification, Select, SelectItem, TextInput } from '@carbon/react'
import { ComposedModal, ModalHeader, ModalBody, ModalFooter } from '@carbon/react'
import ConfirmModal from '../../../../shared/components/ConfirmModal'
import InvitationFlowModal from '../../../../shared/components/InvitationFlowModal'
import InvitationRevealPanel from '../../../../shared/components/InvitationRevealPanel'
import UserLookupEmailField from '../../../../shared/components/UserLookupEmailField'
import { getInvitationDeliveryOptions } from '../../../../shared/utils/invitationFlow'
import { ProjectPermission } from '../../../../shared/auth/permissions'
import { composeProjectRoles, getProjectAccessSelection, getProjectRoleDescription, projectBaseAccessOptions, type ProjectBaseAccessRole, type ProjectMember, type ProjectRole, type UserSearchItem } from '../../components/project-detail'
import type {
  AuthzPrincipalType as SharedAuthzPrincipalType,
  RoleSummary as SharedRoleSummary,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js'

interface MemberLookupResult {
  mode: 'invite' | 'direct-add' | 'existing-member'
  user?: UserSearchItem | null
}

interface MemberCapabilities {
  ssoRequired: boolean
  emailConfigured: boolean
}

interface MemberInviteReveal {
  email: string
  inviteUrl: string
  oneTimePassword: string
}

type AuthzPrincipalType = SharedAuthzPrincipalType

const ASSIGNMENT_PRINCIPAL_TYPE_LABELS: Record<AuthzPrincipalType, string> = {
  user: 'User',
  group: 'Group',
  api_client: 'API client',
  service_account: 'Service account',
}

export type ProjectScopedCustomRole = SharedRoleSummary

interface ProjectMembersManagementModalsProps {
  addMemberOpen: boolean
  onCloseAddMember: () => void
  memberUserSearchItems: UserSearchItem[]
  selectedMemberUser: UserSearchItem | null
  setSelectedMemberUser: (user: UserSearchItem | null) => void
  memberUserSearch: string
  setMemberUserSearch: (value: string) => void
  memberEmail: string
  setMemberEmail: (value: string) => void
  memberEmailTouched: boolean
  setMemberEmailTouched: (value: boolean) => void
  memberRoles: ProjectRole[]
  setMemberRoles: (roles: ProjectRole[]) => void
  canAssignDelegate: boolean
  canAddMembers?: boolean
  canInviteMembers?: boolean
  canUpdateMemberRoles?: boolean
  canRemoveMembers?: boolean
  canAssignScopedAccess?: boolean
  addMembersUnavailableReason?: string | null
  inviteMembersUnavailableReason?: string | null
  updateMemberRolesUnavailableReason?: string | null
  removeMembersUnavailableReason?: string | null
  assignScopedAccessUnavailableReason?: string | null
  isMemberEmailValid: boolean
  memberLookupEmail: string
  memberLookup: MemberLookupResult | null
  memberLookupLoading: boolean
  memberCapabilities: MemberCapabilities | null
  memberCapabilitiesLoading: boolean
  memberDeliveryMethod: 'email' | 'manual'
  setMemberDeliveryMethod: (value: 'email' | 'manual') => void
  memberInviteReveal: MemberInviteReveal | null
  customRoleOptions?: ProjectScopedCustomRole[]
  editCustomRoleIds?: string[]
  setEditCustomRoleIds?: (roleIds: string[]) => void
  resetAddMemberForm: () => void
  submitAddMember: () => void
  assignmentOpen?: boolean
  onCloseAssignment?: () => void
  assignmentPrincipalType?: AuthzPrincipalType
  setAssignmentPrincipalType?: (value: AuthzPrincipalType) => void
  assignmentPrincipalIdInput?: string
  setAssignmentPrincipalIdInput?: (value: string) => void
  assignmentUserEmail?: string
  setAssignmentUserEmail?: (value: string) => void
  assignmentUserSearch?: string
  setAssignmentUserSearch?: (value: string) => void
  assignmentUserSearchItems?: UserSearchItem[]
  selectedAssignmentUser?: UserSearchItem | null
  setSelectedAssignmentUser?: (user: UserSearchItem | null) => void
  assignmentRoleId?: string
  setAssignmentRoleId?: (roleId: string) => void
  assignmentError?: string
  setAssignmentError?: (value: string) => void
  assignmentSubmitting?: boolean
  submitScopedAssignment?: () => void
  editRolesOpen: boolean
  editRolesMember: ProjectMember | null
  editRolesSelection: ProjectRole[]
  setEditRolesSelection: (roles: ProjectRole[]) => void
  submitUpdateRoles: (member: ProjectMember, roles: ProjectRole[]) => void
  onCloseEditRoles: () => void
  removeMemberOpen: boolean
  removeMemberData: ProjectMember | null
  onCloseRemoveMember: () => void
  submitRemoveMember: (member: ProjectMember) => void
  transferOwnershipOpen?: boolean
  transferOwnershipMember?: ProjectMember | null
  onCloseTransferOwnership?: () => void
  submitTransferOwnership?: (member: ProjectMember) => void
  transferOwnershipUnavailableReason?: string | null
}

export function ProjectMembersManagementModals({
  addMemberOpen,
  onCloseAddMember,
  memberUserSearchItems,
  selectedMemberUser,
  setSelectedMemberUser,
  memberUserSearch,
  setMemberUserSearch,
  memberEmail,
  setMemberEmail,
  memberEmailTouched,
  setMemberEmailTouched,
  memberRoles,
  setMemberRoles,
  canAssignDelegate,
  canAddMembers = true,
  canInviteMembers = true,
  canUpdateMemberRoles = true,
  canRemoveMembers = true,
  canAssignScopedAccess = false,
  addMembersUnavailableReason,
  inviteMembersUnavailableReason,
  updateMemberRolesUnavailableReason,
  removeMembersUnavailableReason,
  assignScopedAccessUnavailableReason,
  isMemberEmailValid,
  memberLookupEmail,
  memberLookup,
  memberLookupLoading,
  memberCapabilities,
  memberCapabilitiesLoading,
  memberDeliveryMethod,
  setMemberDeliveryMethod,
  memberInviteReveal,
  customRoleOptions = [],
  editCustomRoleIds = [],
  setEditCustomRoleIds,
  resetAddMemberForm,
  submitAddMember,
  assignmentOpen = false,
  onCloseAssignment = () => undefined,
  assignmentPrincipalType = 'user',
  setAssignmentPrincipalType,
  assignmentPrincipalIdInput = '',
  setAssignmentPrincipalIdInput,
  assignmentUserEmail = '',
  setAssignmentUserEmail,
  assignmentUserSearch = '',
  setAssignmentUserSearch,
  assignmentUserSearchItems = [],
  selectedAssignmentUser = null,
  setSelectedAssignmentUser,
  assignmentRoleId = '',
  setAssignmentRoleId,
  assignmentError = '',
  setAssignmentError,
  assignmentSubmitting = false,
  submitScopedAssignment,
  editRolesOpen,
  editRolesMember,
  editRolesSelection,
  setEditRolesSelection,
  submitUpdateRoles,
  onCloseEditRoles,
  removeMemberOpen,
  removeMemberData,
  onCloseRemoveMember,
  submitRemoveMember,
  transferOwnershipOpen = false,
  transferOwnershipMember = null,
  onCloseTransferOwnership = () => undefined,
  submitTransferOwnership,
  transferOwnershipUnavailableReason,
}: ProjectMembersManagementModalsProps) {
  const trimmedMemberEmail = String(memberEmail || '').trim()
  const lookupSettled = trimmedMemberEmail.length > 0 && trimmedMemberEmail === String(memberLookupEmail || '').trim()
  const showResolvedState = lookupSettled && isMemberEmailValid
  const memberMode = showResolvedState ? memberLookup?.mode || 'invite' : null
  const memberTargetUser = memberLookup?.user || selectedMemberUser
  const resolvedCapabilities = memberCapabilities || { ssoRequired: false, emailConfigured: true }
  const localLoginDisabled = Boolean(resolvedCapabilities.ssoRequired)
  const emailConfigured = Boolean(resolvedCapabilities.emailConfigured)
  const deliveryOptions = getInvitationDeliveryOptions(resolvedCapabilities)
  const noDeliveryOptions = deliveryOptions.length === 0
  const addActionLabel = memberMode === 'invite' ? 'Create invitation' : 'Add user'
  const addUnavailableReason = addMembersUnavailableReason || (
    canAddMembers ? null : `Missing permission ${ProjectPermission.MEMBERS_ADD}`
  )
  const inviteUnavailableReason = inviteMembersUnavailableReason || (
    canInviteMembers ? null : `Missing permission ${ProjectPermission.MEMBERS_INVITE}`
  )
  const editRolesUnavailableReason = updateMemberRolesUnavailableReason || (
    canUpdateMemberRoles ? null : `Missing permission ${ProjectPermission.MEMBERS_UPDATE_ROLE}`
  )
  const removeUnavailableReason = removeMembersUnavailableReason || (
    canRemoveMembers ? null : `Missing permission ${ProjectPermission.MEMBERS_REMOVE}`
  )
  const ownershipTransferUnavailableReason = transferOwnershipUnavailableReason || null
  const assignAccessUnavailableReason = assignScopedAccessUnavailableReason || (
    canAssignScopedAccess ? null : `Missing permission ${ProjectPermission.MEMBERS_ADD} or ${ProjectPermission.MEMBERS_UPDATE_ROLE}`
  )
  const modeUnavailableReason = memberMode === 'direct-add'
    ? addUnavailableReason
    : memberMode === 'invite'
      ? inviteUnavailableReason
      : null
  const lacksModePermission = Boolean(modeUnavailableReason)
  const addActionDisabled =
    !isMemberEmailValid ||
    (isMemberEmailValid && !lookupSettled) ||
    (lookupSettled && memberLookupLoading) ||
    memberCapabilitiesLoading ||
    memberMode === 'existing-member' ||
    (memberMode === 'invite' && noDeliveryOptions) ||
    lacksModePermission
  const showDeliveryMethod = memberMode === 'invite' && !noDeliveryOptions
  const statusNotice = (() => {
    if (memberLookupLoading && showResolvedState) {
      return {
        kind: 'info' as const,
        title: 'Checking user',
        subtitle: 'Looking up whether this email can be added directly or needs an invitation.',
      }
    }

    if (memberMode === 'direct-add' && memberTargetUser && !memberLookupLoading) {
      if (!canAddMembers) {
        return {
          kind: 'warning' as const,
          title: 'Cannot add user directly',
          subtitle: addUnavailableReason || 'Your role can search users, but cannot add existing users to this project.',
        }
      }

      return {
        kind: 'success' as const,
        title: 'Existing user found',
        subtitle: `This will add ${memberTargetUser.email} directly to the project.`,
      }
    }

    if (memberMode === 'existing-member' && memberTargetUser && !memberLookupLoading) {
      return {
        kind: 'warning' as const,
        title: 'Already a member',
        subtitle: `${memberTargetUser.email} is already a member of this project.`,
      }
    }

    if (memberMode === 'invite' && trimmedMemberEmail && isMemberEmailValid && !memberLookupLoading) {
      if (!canInviteMembers) {
        return {
          kind: 'warning' as const,
          title: 'Cannot create invitation',
          subtitle: inviteUnavailableReason || 'Your role can search users, but cannot invite new users to this project.',
        }
      }

      if (noDeliveryOptions) {
        return {
          kind: 'warning' as const,
          title: 'No delivery method available',
          subtitle: 'Email is not configured and manual one-time password onboarding is unavailable while SSO is enforced.',
        }
      }

      if (!emailConfigured && !localLoginDisabled) {
        return {
          kind: 'info' as const,
          title: 'Invitation required',
          subtitle: 'No existing platform user matches this email. Email is not configured, so the invite link and one-time password will be revealed here instead.',
        }
      }

      if (localLoginDisabled) {
        return {
          kind: 'info' as const,
          title: 'Invitation required',
          subtitle: 'No existing platform user matches this email. Manual one-time password delivery is unavailable while SSO is enforced.',
        }
      }

      return {
        kind: 'info' as const,
        title: 'Invitation required',
        subtitle: 'No existing platform user matches this email, so an invitation will be created instead.',
      }
    }

    return null
  })()
  const memberAccess = getProjectAccessSelection(memberRoles)
  const editAccess = getProjectAccessSelection(editRolesSelection)
  const assignableCustomRoles = customRoleOptions.filter((role) => role.kind === 'custom' && role.scope === 'project' && role.isAssignable && !role.isArchived)
  const assignableScopedRoles = customRoleOptions.filter((role) => role.scope === 'project' && role.isAssignable && !role.isArchived)
  const assignmentPrincipalId = assignmentPrincipalType === 'user'
    ? selectedAssignmentUser?.id || ''
    : assignmentPrincipalIdInput.trim()

  const updateMemberBaseRole = (baseRole: ProjectBaseAccessRole) => {
    if (modeUnavailableReason) return
    setMemberRoles(composeProjectRoles(baseRole, canAssignDelegate && memberAccess.hasDelegateAccess))
  }

  const updateMemberDelegateAccess = (checked: boolean) => {
    if (modeUnavailableReason) return
    setMemberRoles(composeProjectRoles(memberAccess.baseRole, canAssignDelegate && checked))
  }

  const updateEditBaseRole = (baseRole: ProjectBaseAccessRole) => {
    if (editRolesUnavailableReason) return
    setEditRolesSelection(composeProjectRoles(baseRole, canAssignDelegate && editAccess.hasDelegateAccess))
  }

  const updateEditDelegateAccess = (checked: boolean) => {
    if (editRolesUnavailableReason) return
    setEditRolesSelection(composeProjectRoles(editAccess.baseRole, canAssignDelegate && checked))
  }

  const toggleEditCustomRole = (roleId: string, checked: boolean) => {
    if (editRolesUnavailableReason) return
    if (!setEditCustomRoleIds) return
    setEditCustomRoleIds(checked
      ? Array.from(new Set([...editCustomRoleIds, roleId]))
      : editCustomRoleIds.filter((id) => id !== roleId)
    )
  }

  return (
    <>
      {addMemberOpen && (
        <InvitationFlowModal
          open={addMemberOpen}
          onClose={onCloseAddMember}
          label="Project members"
          title="Invite user"
          dataAttribute="data-eg-project-members-add-modal"
          revealMode={Boolean(memberInviteReveal)}
          onSubmit={submitAddMember}
          submitText={addActionLabel}
          submitDisabled={addActionDisabled}
          onRevealSecondary={resetAddMemberForm}
          onRevealPrimary={onCloseAddMember}
        >
          <div data-eg-project-members-roles style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
            {memberInviteReveal ? (
              <InvitationRevealPanel
                data={memberInviteReveal}
                subtitle={`Copy and share the invite link and one-time password for ${memberInviteReveal.email}.`}
              />
            ) : (
              <>
                <div>
                  <div style={{ fontSize: 'var(--cds-label-01-font-size, 0.75rem)', marginBottom: 'var(--spacing-3)' }}>Who</div>
                  <UserLookupEmailField
                    id="member-user-or-email"
                    labelText="Email"
                    placeholder="Search existing users or enter an email"
                    value={memberEmail}
                    searchValue={memberUserSearch}
                    suggestionItems={memberUserSearchItems}
                    selectedItem={selectedMemberUser}
                    invalid={memberEmailTouched && !!trimmedMemberEmail && !isMemberEmailValid}
                    invalidText="Enter a valid email address"
                    onChange={(next) => {
                      setMemberEmail(next)
                      setMemberUserSearch(next)
                      if (selectedMemberUser && next.trim() !== selectedMemberUser.email) {
                        setSelectedMemberUser(null)
                      }
                    }}
                    onBlur={() => setMemberEmailTouched(true)}
                    onSelect={(item) => {
                      setSelectedMemberUser(item)
                      setMemberEmail(item.email)
                      setMemberUserSearch(item.email)
                      setMemberEmailTouched(true)
                    }}
                  />
                </div>

                <div>
                  {statusNotice ? (
                    <InlineNotification
                      lowContrast
                      kind={statusNotice.kind}
                      title={statusNotice.title}
                      subtitle={statusNotice.subtitle}
                      hideCloseButton
                    />
                  ) : null}
                </div>

                <div>
                  <div style={{ fontSize: 'var(--cds-label-01-font-size, 0.75rem)', marginBottom: 'var(--spacing-3)' }}>Access</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
                    <Select
                      id="member-base-access"
                      labelText="Base access"
                      value={memberAccess.baseRole}
                      disabled={Boolean(modeUnavailableReason)}
                      onChange={(e: any) => updateMemberBaseRole(e.target.value as ProjectBaseAccessRole)}
                    >
                      {projectBaseAccessOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id} text={option.label} />
                      ))}
                    </Select>
                    <div style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary, #525252)' }}>
                      {projectBaseAccessOptions.find((option) => option.id === memberAccess.baseRole)?.description}
                    </div>

                    {canAssignDelegate ? (
                      <>
                        <Checkbox
                          id="member-delegate-access"
                          labelText="Also allow managing members and project settings"
                          checked={memberAccess.hasDelegateAccess}
                          disabled={Boolean(modeUnavailableReason)}
                          onChange={(_, { checked }) => updateMemberDelegateAccess(Boolean(checked))}
                        />
                        <div style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary, #525252)' }}>
                          {getProjectRoleDescription('delegate')}
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>

                {assignableCustomRoles.length > 0 && memberMode === 'direct-add' ? (
                  <InlineNotification
                    lowContrast
                    kind="info"
                    title="Scoped access"
                    subtitle="Use Assign access from the members table to grant custom or system RBAC roles to existing users, groups, API clients, or service accounts."
                    hideCloseButton
                  />
                ) : null}

                {assignableCustomRoles.length > 0 && memberMode === 'invite' ? (
                  <InlineNotification
                    lowContrast
                    kind="info"
                    title="Custom roles"
                    subtitle="Custom roles can be assigned after the invited user accepts and appears in the members table."
                    hideCloseButton
                  />
                ) : null}

                {showDeliveryMethod ? (
                  <div>
                    <div style={{ fontSize: 'var(--cds-label-01-font-size, 0.75rem)', marginBottom: 'var(--spacing-3)' }}>Delivery</div>
                    <Select
                      id="member-delivery-method"
                      labelText="Delivery Method"
                      value={memberDeliveryMethod}
                      onChange={(e: any) => setMemberDeliveryMethod(e.target.value as 'email' | 'manual')}
                      disabled={memberCapabilitiesLoading || Boolean(modeUnavailableReason)}
                    >
                      {deliveryOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value} text={option.text} />
                      ))}
                    </Select>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </InvitationFlowModal>
      )}

      {assignmentOpen && (
        <ComposedModal open size="sm" onClose={onCloseAssignment}>
          <ModalHeader label="Project access" title="Assign access" closeModal={onCloseAssignment} />
          <ModalBody>
            <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
              {assignmentError ? (
                <InlineNotification kind="error" title="Error" subtitle={assignmentError} lowContrast hideCloseButton />
              ) : null}
              {assignAccessUnavailableReason ? (
                <InlineNotification kind="warning" title="Access assignment unavailable" subtitle={assignAccessUnavailableReason} lowContrast hideCloseButton />
              ) : null}

              <Select
                id="project-scoped-assignment-principal-type"
                labelText="Principal type"
                value={assignmentPrincipalType}
                onChange={(event: any) => {
                  setAssignmentPrincipalType?.(event.target.value as AuthzPrincipalType)
                  setAssignmentPrincipalIdInput?.('')
                  setAssignmentUserEmail?.('')
                  setAssignmentUserSearch?.('')
                  setSelectedAssignmentUser?.(null)
                  setAssignmentError?.('')
                }}
                disabled={assignmentSubmitting || Boolean(assignAccessUnavailableReason)}
              >
                <SelectItem value="user" text="User" />
                <SelectItem value="group" text="Group" />
                <SelectItem value="api_client" text="API client" />
                <SelectItem value="service_account" text="Service account" />
              </Select>

              {assignmentPrincipalType === 'user' ? (
                <>
                  <UserLookupEmailField
                    id="project-scoped-assignment-user-search"
                    labelText="User"
                    placeholder="Search existing users by email"
                    value={assignmentUserEmail}
                    searchValue={assignmentUserSearch}
                    suggestionItems={assignmentUserSearchItems}
                    selectedItem={selectedAssignmentUser}
                    disabled={assignmentSubmitting || Boolean(assignAccessUnavailableReason)}
                    onChange={(next) => {
                      setAssignmentUserEmail?.(next)
                      setAssignmentUserSearch?.(next)
                      if (selectedAssignmentUser && next.trim().toLowerCase() !== selectedAssignmentUser.email.toLowerCase()) {
                        setSelectedAssignmentUser?.(null)
                      }
                    }}
                    onSelect={(item) => {
                      setSelectedAssignmentUser?.(item)
                      setAssignmentUserEmail?.(item.email)
                      setAssignmentUserSearch?.(item.email)
                      setAssignmentError?.('')
                    }}
                  />
                  <div style={{ marginTop: 'var(--spacing-2)', fontSize: '0.75rem', color: 'var(--cds-text-secondary, #525252)' }}>
                    Scoped user assignments require an existing platform user.
                  </div>
                </>
              ) : (
                <TextInput
                  id="project-scoped-assignment-principal-id"
                  labelText={`${ASSIGNMENT_PRINCIPAL_TYPE_LABELS[assignmentPrincipalType]} ID`}
                  value={assignmentPrincipalIdInput}
                  placeholder={
                    assignmentPrincipalType === 'group'
                      ? 'group id'
                      : assignmentPrincipalType === 'api_client'
                        ? 'api client id'
                        : 'service account id'
                  }
                  helperText="Use the principal identifier from Access Control."
                  disabled={assignmentSubmitting || Boolean(assignAccessUnavailableReason)}
                  onChange={(event: any) => {
                    setAssignmentPrincipalIdInput?.(String(event.target.value || ''))
                    setAssignmentError?.('')
                  }}
                />
              )}

              <Select
                id="project-scoped-assignment-role"
                labelText="Role"
                value={assignmentRoleId}
                onChange={(event: any) => {
                  setAssignmentRoleId?.(String(event.target.value || ''))
                  setAssignmentError?.('')
                }}
                disabled={assignmentSubmitting || Boolean(assignAccessUnavailableReason)}
              >
                <SelectItem value="" text="Select role" />
                {assignableScopedRoles.map((role) => (
                  <SelectItem key={role.id} value={role.id} text={role.name} />
                ))}
              </Select>
              {assignableScopedRoles.length === 0 ? (
                <InlineNotification kind="info" title="No assignable roles" subtitle="Create assignable project roles in Access Control first." lowContrast hideCloseButton />
              ) : null}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button kind="secondary" onClick={onCloseAssignment}>
              Cancel
            </Button>
            <Button
              kind="primary"
              onClick={submitScopedAssignment}
              disabled={
                assignmentSubmitting ||
                Boolean(assignAccessUnavailableReason) ||
                !assignmentRoleId ||
                !assignmentPrincipalId
              }
            >
              Assign
            </Button>
          </ModalFooter>
        </ComposedModal>
      )}

      {editRolesOpen && editRolesMember && (
        <ComposedModal data-eg-project-members-roles-modal open size="sm" onClose={onCloseEditRoles}>
          <ModalHeader label="Project members" title="Edit roles" closeModal={onCloseEditRoles} />
          <ModalBody style={{ overflow: 'visible', paddingBottom: 'var(--spacing-7)' }}>
            <div data-eg-project-members-roles>
              {editRolesUnavailableReason ? (
                <InlineNotification
                  lowContrast
                  kind="warning"
                  title="Role changes unavailable"
                  subtitle={editRolesUnavailableReason}
                  hideCloseButton
                  style={{ marginBottom: 'var(--spacing-4)' }}
                />
              ) : null}
              <div style={{ fontSize: 'var(--cds-label-01-font-size, 0.75rem)', marginBottom: 'var(--spacing-3)' }}>Access</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
                <Select
                  id="edit-member-base-access"
                  labelText="Base access"
                  value={editAccess.baseRole}
                  disabled={Boolean(editRolesUnavailableReason)}
                  onChange={(e: any) => updateEditBaseRole(e.target.value as ProjectBaseAccessRole)}
                >
                  {projectBaseAccessOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id} text={option.label} />
                  ))}
                </Select>
                <div style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary, #525252)' }}>
                  {projectBaseAccessOptions.find((option) => option.id === editAccess.baseRole)?.description}
                </div>

                {canAssignDelegate ? (
                  <>
                    <Checkbox
                      id="edit-member-delegate-access"
                      labelText="Also allow managing members and project settings"
                      checked={editAccess.hasDelegateAccess}
                      disabled={Boolean(editRolesUnavailableReason)}
                      onChange={(_, { checked }) => updateEditDelegateAccess(Boolean(checked))}
                    />
                    <div style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary, #525252)' }}>
                      {getProjectRoleDescription('delegate')}
                    </div>
                  </>
                ) : null}

                {assignableCustomRoles.length > 0 ? (
                  <div>
                    <div style={{ fontSize: 'var(--cds-label-01-font-size, 0.75rem)', margin: 'var(--spacing-4) 0 var(--spacing-3)' }}>Custom roles</div>
                    <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
                      {assignableCustomRoles.map((role) => (
                        <Checkbox
                          key={role.id}
                          id={`edit-project-member-custom-role-${role.id}`}
                          labelText={role.name}
                          checked={editCustomRoleIds.includes(role.id)}
                          disabled={Boolean(editRolesUnavailableReason)}
                          onChange={(_, { checked }) => toggleEditCustomRole(role.id, Boolean(checked))}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button kind="secondary" onClick={onCloseEditRoles}>
              Cancel
            </Button>
            <Button
              kind="primary"
              disabled={Boolean(editRolesUnavailableReason)}
              title={editRolesUnavailableReason ?? undefined}
              onClick={() => {
                if (editRolesUnavailableReason) return
                submitUpdateRoles(editRolesMember, editRolesSelection)
              }}
            >
              Save
            </Button>
          </ModalFooter>
        </ComposedModal>
      )}

      {removeMemberOpen && removeMemberData && (
        <ConfirmModal
          open
          onClose={onCloseRemoveMember}
          onConfirm={() => submitRemoveMember(removeMemberData)}
          title="Remove project member"
          description={`You're about to remove ${removeMemberData.user?.email || removeMemberData.userId} from this project.`}
          confirmText="Remove"
          danger
          showWarning
          confirmDisabled={Boolean(removeUnavailableReason)}
          disabledReason={removeUnavailableReason}
        />
      )}

      {transferOwnershipOpen && transferOwnershipMember && (
        <ConfirmModal
          open
          onClose={onCloseTransferOwnership}
          onConfirm={() => submitTransferOwnership?.(transferOwnershipMember)}
          title="Transfer project ownership"
          description={`You are about to make ${transferOwnershipMember.user?.email || transferOwnershipMember.userId} the project owner. Your owner role will be removed.`}
          confirmText="Transfer ownership"
          danger
          showWarning
          confirmDisabled={Boolean(ownershipTransferUnavailableReason)}
          disabledReason={ownershipTransferUnavailableReason}
        />
      )}
    </>
  )
}
