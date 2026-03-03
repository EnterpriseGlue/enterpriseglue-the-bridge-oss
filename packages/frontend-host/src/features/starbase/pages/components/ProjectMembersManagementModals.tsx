import React from 'react'
import { Button, ComboBox, MultiSelect } from '@carbon/react'
import { ComposedModal, ModalHeader, ModalBody, ModalFooter, TextInput } from '@carbon/react'
import ConfirmModal from '../../../../shared/components/ConfirmModal'
import InviteMemberModal from '../../../../components/InviteMemberModal'
import type { ProjectMember, ProjectRole, UserSearchItem } from '../../components/project-detail'

interface RoleItem {
  id: ProjectRole
  label: string
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
  roleItems: RoleItem[]
  selectedMemberRoleItems: RoleItem[]
  setMemberRoles: (roles: ProjectRole[]) => void
  isMemberEmailValid: boolean
  submitAddMember: () => void
  inviteMemberOpen: boolean
  onInviteClose: () => void
  onInviteSuccess: () => void
  projectId?: string
  projectName: string
  editRolesOpen: boolean
  editRolesMember: ProjectMember | null
  selectedEditRoleItems: RoleItem[]
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
  roleItems,
  selectedMemberRoleItems,
  setMemberRoles,
  isMemberEmailValid,
  submitAddMember,
  inviteMemberOpen,
  onInviteClose,
  onInviteSuccess,
  projectId,
  projectName,
  editRolesOpen,
  editRolesMember,
  selectedEditRoleItems,
  setEditRolesSelection,
  submitUpdateRoles,
  onCloseEditRoles,
  removeMemberOpen,
  removeMemberData,
  onCloseRemoveMember,
  submitRemoveMember,
}: ProjectMembersManagementModalsProps) {
  const trimmedMemberEmail = String(memberEmail || '').trim()
  const ComboBoxAny: any = ComboBox

  return (
    <>
      {addMemberOpen && (
        <ComposedModal data-eg-project-members-add-modal open size="sm" onClose={onCloseAddMember}>
          <ModalHeader label="Project members" title="Add user" closeModal={onCloseAddMember} />
          <ModalBody style={{ overflow: 'visible', paddingBottom: 'var(--spacing-7)' }}>
            <div data-eg-project-members-roles style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
              <ComboBoxAny
                id="member-user-search"
                titleText="User"
                placeholder="Search existing users..."
                items={memberUserSearchItems as any}
                itemToString={(item: UserSearchItem | null) => {
                  if (!item) return ''
                  const name = `${item.firstName || ''}${item.firstName && item.lastName ? ' ' : ''}${item.lastName || ''}`.trim()
                  return `${name ? `${name} ` : ''}(${item.email})`.trim()
                }}
                selectedItem={selectedMemberUser as any}
                onInputChange={(val: string) => setMemberUserSearch(String(val || ''))}
                onChange={({ selectedItem }: any) => {
                  const next = (selectedItem as UserSearchItem) || null
                  setSelectedMemberUser(next)
                  if (next?.email) setMemberEmail(next.email)
                }}
                shouldFilterItem={({ item, inputValue }: any) => {
                  if (!inputValue) return true
                  const search = String(inputValue).toLowerCase()
                  const name = `${item.firstName || ''} ${item.lastName || ''}`.toLowerCase()
                  return item.email.toLowerCase().includes(search) || name.includes(search)
                }}
              />
              <TextInput
                id="member-email"
                labelText="Email"
                placeholder="user@company.com"
                type="email"
                value={memberEmail}
                invalid={memberEmailTouched && !!trimmedMemberEmail && !isMemberEmailValid}
                invalidText="Enter a valid email address"
                onChange={(e: any) => {
                  const next = String(e.target.value || '')
                  setMemberEmail(next)
                  if (selectedMemberUser && next.trim() !== selectedMemberUser.email) {
                    setSelectedMemberUser(null)
                  }
                }}
                onBlur={() => setMemberEmailTouched(true)}
              />
              <MultiSelect
                key={`member-roles-${roleItems.map((it) => it.id).join('-')}`}
                id="member-roles"
                label="Roles"
                items={roleItems as any}
                itemToString={(it: any) => String(it?.label || '')}
                selectedItems={selectedMemberRoleItems as any}
                onChange={({ selectedItems }: any) => {
                  const roles = ((selectedItems || []) as any[]).map((it) => it.id as ProjectRole)
                  setMemberRoles(roles.length ? roles : ['viewer'])
                }}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button kind="secondary" onClick={onCloseAddMember}>
              Cancel
            </Button>
            <Button kind="primary" disabled={!isMemberEmailValid} onClick={submitAddMember}>
              Add
            </Button>
          </ModalFooter>
        </ComposedModal>
      )}

      <InviteMemberModal
        open={inviteMemberOpen}
        onClose={onInviteClose}
        onSuccess={onInviteSuccess}
        resourceType="project"
        resourceId={projectId}
        resourceName={projectName}
        availableRoles={[
          { id: 'developer', label: 'Developer' },
          { id: 'editor', label: 'Editor' },
          { id: 'viewer', label: 'Viewer' },
        ]}
        defaultRole="viewer"
      />

      {editRolesOpen && editRolesMember && (
        <ComposedModal data-eg-project-members-roles-modal open size="sm" onClose={onCloseEditRoles}>
          <ModalHeader label="Project members" title="Edit roles" closeModal={onCloseEditRoles} />
          <ModalBody style={{ overflow: 'visible', paddingBottom: 'var(--spacing-7)' }}>
            <div data-eg-project-members-roles>
              <MultiSelect
                key={`edit-member-roles-${roleItems.map((it) => it.id).join('-')}`}
                id="edit-member-roles"
                label="Roles"
                items={roleItems as any}
                itemToString={(it: any) => String(it?.label || '')}
                selectedItems={selectedEditRoleItems as any}
                onChange={({ selectedItems }: any) => {
                  const roles = ((selectedItems || []) as any[]).map((it) => it.id as ProjectRole)
                  setEditRolesSelection(roles.length ? roles : ['viewer'])
                }}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button kind="secondary" onClick={onCloseEditRoles}>
              Cancel
            </Button>
            <Button kind="primary" onClick={() => submitUpdateRoles(editRolesMember, selectedEditRoleItems.map((it) => it.id))}>
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
