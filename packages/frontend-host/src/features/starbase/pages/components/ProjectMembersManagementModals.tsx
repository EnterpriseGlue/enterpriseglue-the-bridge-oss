import React from 'react'
import { Button, Checkbox, InlineNotification, Select, SelectItem } from '@carbon/react'
import { ComposedModal, ModalHeader, ModalBody, ModalFooter } from '@carbon/react'
import ConfirmModal from '../../../../shared/components/ConfirmModal'
import InvitationFlowModal from '../../../../shared/components/InvitationFlowModal'
import InvitationRevealPanel from '../../../../shared/components/InvitationRevealPanel'
import UserLookupEmailField from '../../../../shared/components/UserLookupEmailField'
import { getInvitationDeliveryOptions } from '../../../../shared/utils/invitationFlow'
import { composeProjectRoles, getProjectAccessSelection, getProjectRoleDescription, projectBaseAccessOptions, type ProjectBaseAccessRole, type ProjectMember, type ProjectRole, type UserSearchItem } from '../../components/project-detail'

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
  isMemberEmailValid: boolean
  memberLookupEmail: string
  memberLookup: MemberLookupResult | null
  memberLookupLoading: boolean
  memberCapabilities: MemberCapabilities | null
  memberCapabilitiesLoading: boolean
  memberDeliveryMethod: 'email' | 'manual'
  setMemberDeliveryMethod: (value: 'email' | 'manual') => void
  memberInviteReveal: MemberInviteReveal | null
  resetAddMemberForm: () => void
  submitAddMember: () => void
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
  isMemberEmailValid,
  memberLookupEmail,
  memberLookup,
  memberLookupLoading,
  memberCapabilities,
  memberCapabilitiesLoading,
  memberDeliveryMethod,
  setMemberDeliveryMethod,
  memberInviteReveal,
  resetAddMemberForm,
  submitAddMember,
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
  const addActionDisabled =
    !isMemberEmailValid ||
    (isMemberEmailValid && !lookupSettled) ||
    (lookupSettled && memberLookupLoading) ||
    memberCapabilitiesLoading ||
    memberMode === 'existing-member' ||
    (memberMode === 'invite' && noDeliveryOptions)
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

  const updateMemberBaseRole = (baseRole: ProjectBaseAccessRole) => {
    setMemberRoles(composeProjectRoles(baseRole, canAssignDelegate && memberAccess.hasDelegateAccess))
  }

  const updateMemberDelegateAccess = (checked: boolean) => {
    setMemberRoles(composeProjectRoles(memberAccess.baseRole, canAssignDelegate && checked))
  }

  const updateEditBaseRole = (baseRole: ProjectBaseAccessRole) => {
    setEditRolesSelection(composeProjectRoles(baseRole, canAssignDelegate && editAccess.hasDelegateAccess))
  }

  const updateEditDelegateAccess = (checked: boolean) => {
    setEditRolesSelection(composeProjectRoles(editAccess.baseRole, canAssignDelegate && checked))
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
                          onChange={(_, { checked }) => updateMemberDelegateAccess(Boolean(checked))}
                        />
                        <div style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary, #525252)' }}>
                          {getProjectRoleDescription('delegate')}
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>

                {showDeliveryMethod ? (
                  <div>
                    <div style={{ fontSize: 'var(--cds-label-01-font-size, 0.75rem)', marginBottom: 'var(--spacing-3)' }}>Delivery</div>
                    <Select
                      id="member-delivery-method"
                      labelText="Delivery Method"
                      value={memberDeliveryMethod}
                      onChange={(e: any) => setMemberDeliveryMethod(e.target.value as 'email' | 'manual')}
                      disabled={memberCapabilitiesLoading}
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

      {editRolesOpen && editRolesMember && (
        <ComposedModal data-eg-project-members-roles-modal open size="sm" onClose={onCloseEditRoles}>
          <ModalHeader label="Project members" title="Edit roles" closeModal={onCloseEditRoles} />
          <ModalBody style={{ overflow: 'visible', paddingBottom: 'var(--spacing-7)' }}>
            <div data-eg-project-members-roles>
              <div style={{ fontSize: 'var(--cds-label-01-font-size, 0.75rem)', marginBottom: 'var(--spacing-3)' }}>Access</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
                <Select
                  id="edit-member-base-access"
                  labelText="Base access"
                  value={editAccess.baseRole}
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
                      onChange={(_, { checked }) => updateEditDelegateAccess(Boolean(checked))}
                    />
                    <div style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary, #525252)' }}>
                      {getProjectRoleDescription('delegate')}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button kind="secondary" onClick={onCloseEditRoles}>
              Cancel
            </Button>
            <Button kind="primary" onClick={() => submitUpdateRoles(editRolesMember, editRolesSelection)}>
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
        />
      )}
    </>
  )
}
