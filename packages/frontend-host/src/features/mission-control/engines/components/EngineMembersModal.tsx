/**
 * Engine Members Modal
 * Manages engine members, delegates, and access requests
 */

import React from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  DataTable,
  DataTableSkeleton,
  Tag,
  InlineNotification,
  Checkbox,
  Select,
  SelectItem,
  TextInput,
  ComposedModal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
} from '@carbon/react'
import { Close, Checkmark } from '@carbon/icons-react'
import { GuardedOverflowMenu, GuardedOverflowMenuItem } from '../../../../shared/auth/guards'
import { useModal } from '../../../../shared/hooks/useModal'
import { useToast } from '../../../../shared/notifications/ToastProvider'
import { getUiErrorMessage, parseApiError } from '../../../../shared/api/apiErrorUtils'
import { apiClient } from '../../../../shared/api/client'
import InvitationFlowModal from '../../../../shared/components/InvitationFlowModal'
import InvitationRevealPanel from '../../../../shared/components/InvitationRevealPanel'
import UserLookupEmailField from '../../../../shared/components/UserLookupEmailField'
import { getInvitationDeliveryOptions, getPreferredInvitationDeliveryMethod, type InvitationDeliveryMethod, type InvitationRevealData } from '../../../../shared/utils/invitationFlow'
import { StarbaseTableShell } from '../../../starbase/components/StarbaseTableShell'
import {
  addEngineMember,
  approveEngineAccessRequest,
  assignEngineDelegate,
  denyEngineAccessRequest,
  getEngineAccessRequests,
  getEngineMemberCapabilities,
  getEngineMembers,
  lookupEngineMember,
  reissueManualEngineInvitation,
  removeEngineMember,
  updateEngineMemberRole,
} from '../api/engines'
import type {
  EngineMember as SharedEngineMember,
  EngineRole as SharedEngineRole,
  PendingEngineInvite as SharedPendingEngineInvite,
} from '@enterpriseglue/shared/schemas/platform-admin/engine-management.js'
import type {
  RoleAssignment as SharedRoleAssignment,
  RoleSummary as SharedRoleSummary,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js'

// Types
type EngineRole = Exclude<SharedEngineRole, 'custom'>

type EngineMember = SharedEngineMember

type UserSearchItem = { id: string; email: string; firstName?: string | null; lastName?: string | null }
type PendingEngineInvite = SharedPendingEngineInvite
type PendingEngineInviteStatus = PendingEngineInvite['status']
type MemberModalFlow = 'invite' | 'delegate'
type AssignableEngineRole = Exclude<EngineRole, 'owner'>
type AuthzPrincipalType = 'user' | 'group' | 'api_client' | 'service_account'
type ScopedAssignableRole = SharedRoleSummary
type ScopedRoleAssignment = SharedRoleAssignment
type ScopedRoleAssignmentDisplay = Pick<SharedRoleAssignment, 'id' | 'roleId' | 'source'> & Partial<Pick<SharedRoleAssignment,
  'userId' | 'principalType' | 'principalId' | 'sourceMappingId' | 'sourceRef'
>>

const ASSIGNMENT_PRINCIPAL_TYPE_LABELS: Record<AuthzPrincipalType, string> = {
  user: 'User',
  group: 'Group',
  api_client: 'API client',
  service_account: 'Service account',
}

interface EngineMembersModalProps {
  open: boolean
  engine: { id: string; name: string } | null
  canManage: boolean
  engineAccessAuthority?: 'manual' | 'transition_to_sso' | 'sso_managed'
  canViewMembers?: boolean
  canLookupMembers?: boolean
  canInviteMembers?: boolean
  canAddMembers?: boolean
  canUpdateMemberRoles?: boolean
  canRemoveMembers?: boolean
  canManageDelegate?: boolean
  canViewProjectAccess?: boolean
  canApproveProjectAccess?: boolean
  canDenyProjectAccess?: boolean
  onClose: () => void
}

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1)
}

function tagTypeForRole(role: string): 'red' | 'magenta' | 'teal' | 'blue' | 'gray' {
  switch (role) {
    case 'owner': return 'red'
    case 'delegate': return 'magenta'
    case 'operator': return 'teal'
    case 'deployer': return 'blue'
    default: return 'gray'
  }
}

const ENGINE_GOVERNANCE_MEMBER_ROLES = new Set(['owner', 'delegate'])

function isGovernanceEngineMember(member: EngineMember | null | undefined): boolean {
  return ENGINE_GOVERNANCE_MEMBER_ROLES.has(String(member?.role || ''))
}

function isDelegateEngineMember(member: EngineMember | null | undefined): boolean {
  return String(member?.role || '') === 'delegate'
}

function isOperatorEngineMember(member: EngineMember | null | undefined): boolean {
  return String(member?.role || '') === 'operator'
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

function inviteStatusLabel(status: PendingEngineInviteStatus): string {
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

function inviteStatusTagType(status: PendingEngineInviteStatus): 'red' | 'purple' | 'blue' {
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

function inviteStatusDescription(invite: PendingEngineInvite): string {
  if (invite.status === 'expired') {
    return `Expired on ${formatInviteDate(invite.expiresAt)}`
  }

  if (invite.status === 'onboarding') {
    return 'Invite accepted. Account setup is still in progress.'
  }

  return `Waiting for acceptance until ${formatInviteDate(invite.expiresAt)}`
}

function getEngineRoleDescription(role: AssignableEngineRole): string {
  switch (role) {
    case 'delegate':
      return 'Can manage members and engine settings for the owner.'
    case 'deployer':
      return 'Can deploy and operate this engine.'
    case 'operator':
    default:
      return 'Can operate this engine without deployment access.'
  }
}

function scopedAssignmentPrincipalType(assignment: ScopedRoleAssignmentDisplay): AuthzPrincipalType {
  return assignment.principalType || 'user'
}

function scopedAssignmentPrincipalId(assignment: ScopedRoleAssignmentDisplay): string {
  return assignment.principalId || assignment.userId || ''
}

function formatScopedAssignmentPrincipal(assignment: ScopedRoleAssignmentDisplay): string {
  const type = scopedAssignmentPrincipalType(assignment)
  const id = scopedAssignmentPrincipalId(assignment)
  return `${ASSIGNMENT_PRINCIPAL_TYPE_LABELS[type]}: ${id || 'unknown'}`
}

function formatScopedRoleName(roleId: string, roleName?: string | null): string {
  if (roleName) return roleName
  if (roleId === 'system.engine.owner') return 'Engine Owner'
  if (roleId === 'system.engine.delegate') return 'Engine Delegate'
  if (roleId === 'system.engine.operator') return 'Engine Operator'
  if (roleId === 'system.engine.deployer') return 'Engine Deployer'
  return roleId
}

export function formatScopedAssignmentSourceLineage(assignment: ScopedRoleAssignmentDisplay | null | undefined): string {
  if (!assignment) return '-'
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

function isGovernanceScopedAssignment(assignment: ScopedRoleAssignmentDisplay): boolean {
  return assignment.roleId === 'system.engine.owner' || assignment.roleId === 'system.engine.delegate'
}

function tagTypeForAssignmentSource(source: ScopedRoleAssignmentDisplay['source']): 'blue' | 'green' | 'purple' | 'gray' {
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

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export default function EngineMembersModal({
  open,
  engine,
  canManage,
  engineAccessAuthority = 'manual',
  canViewMembers = canManage,
  canLookupMembers = canManage,
  canInviteMembers = canManage,
  canAddMembers = canManage,
  canUpdateMemberRoles = canManage,
  canRemoveMembers = canManage,
  canManageDelegate = false,
  canViewProjectAccess = canManage,
  canApproveProjectAccess = canManage,
  canDenyProjectAccess = canManage,
  onClose,
}: EngineMembersModalProps) {
  const { pathname } = useLocation()
  const qc = useQueryClient()
  const { notify } = useToast()
  const addMemberModal = useModal()
  const assignmentModal = useModal()
  const childModalOpen = addMemberModal.isOpen || assignmentModal.isOpen
  const ssoManagedAccess = engineAccessAuthority === 'sso_managed'

  const tenantSlugMatch = pathname.match(/^\/t\/([^/]+)(?:\/|$)/)
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : 'default'

  const [memberEmail, setMemberEmail] = React.useState('')
  const [memberFlow, setMemberFlow] = React.useState<MemberModalFlow>('invite')
  const [memberRole, setMemberRole] = React.useState<AssignableEngineRole>('operator')
  const [memberDeliveryMethod, setMemberDeliveryMethod] = React.useState<InvitationDeliveryMethod>('email')
  const [memberReveal, setMemberReveal] = React.useState<InvitationRevealData | null>(null)
  const [memberError, setMemberError] = React.useState('')
  const [memberSubmitting, setMemberSubmitting] = React.useState(false)
  const [memberUserSearch, setMemberUserSearch] = React.useState('')
  const [selectedMemberUser, setSelectedMemberUser] = React.useState<UserSearchItem | null>(null)
  const [memberEmailTouched, setMemberEmailTouched] = React.useState(false)
  const [collaboratorsSearch, setCollaboratorsSearch] = React.useState('')
  const [collaboratorsSearchExpanded, setCollaboratorsSearchExpanded] = React.useState(false)
  const [debouncedMemberEmail, setDebouncedMemberEmail] = React.useState('')
  const [customRoleEditorMember, setCustomRoleEditorMember] = React.useState<EngineMember | null>(null)
  const [customRoleSelection, setCustomRoleSelection] = React.useState<string[]>([])
  const [assignmentPrincipalType, setAssignmentPrincipalType] = React.useState<AuthzPrincipalType>('user')
  const [assignmentPrincipalIdInput, setAssignmentPrincipalIdInput] = React.useState('')
  const [assignmentUserEmail, setAssignmentUserEmail] = React.useState('')
  const [assignmentUserSearch, setAssignmentUserSearch] = React.useState('')
  const [selectedAssignmentUser, setSelectedAssignmentUser] = React.useState<UserSearchItem | null>(null)
  const [assignmentRoleId, setAssignmentRoleId] = React.useState('')
  const [assignmentError, setAssignmentError] = React.useState('')

  const trimmedMemberEmail = memberEmail.trim()
  const normalizedMemberEmail = trimmedMemberEmail.toLowerCase()
  const isMemberEmailValid = isValidEmail(trimmedMemberEmail)
  const canAssignDelegate = canManageDelegate
  const canOpenInviteUser = canLookupMembers && canInviteMembers
  const canOpenDelegateAssignment = canLookupMembers && canAssignDelegate
  const canManageScopedAccess = canAddMembers || canUpdateMemberRoles
  const assignmentPrincipalId = assignmentPrincipalType === 'user'
    ? selectedAssignmentUser?.id || ''
    : assignmentPrincipalIdInput.trim()

  const membersQ = useQuery({
    queryKey: ['engine-members', engine?.id],
    queryFn: () => getEngineMembers(engine!.id),
    enabled: !!engine?.id && open && canViewMembers,
  })

  const accessRequestsQ = useQuery({
    queryKey: ['engine-access-requests', engine?.id],
    queryFn: () => getEngineAccessRequests(engine!.id),
    enabled: !!engine?.id && canViewProjectAccess && open,
  })

  const customRolesQ = useQuery({
    queryKey: ['engine-members', engine?.id, 'assignable-roles'],
    queryFn: () => apiClient.get<ScopedAssignableRole[]>('/api/authz/roles', {
      scope: 'engine',
      assignable: 'true',
      resourceType: 'engine',
      resourceId: engine!.id,
    }, { credentials: 'include' }),
    enabled: !!engine?.id && open && canManageScopedAccess,
  })

  const roleAssignmentsQ = useQuery({
    queryKey: ['engine-members', engine?.id, 'role-assignments'],
    queryFn: () => apiClient.get<ScopedRoleAssignment[]>('/api/authz/role-assignments', {
      resourceType: 'engine',
      resourceId: engine!.id,
    }, { credentials: 'include' }),
    enabled: !!engine?.id && open && canManageScopedAccess,
  })

  const usersQ = useQuery({
    queryKey: ['admin', 'users', 'search', memberUserSearch.trim()],
    queryFn: () => {
      const q = memberUserSearch.trim()
      if (q.length < 2) return Promise.resolve([] as UserSearchItem[])
      return apiClient.get<UserSearchItem[]>(`/api/admin/users/search?q=${encodeURIComponent(q)}`, undefined, { credentials: 'include' })
    },
    enabled: addMemberModal.isOpen && canLookupMembers && memberUserSearch.trim().length >= 2,
    staleTime: 30 * 1000,
  })

  const assignmentUsersQ = useQuery({
    queryKey: ['admin', 'users', 'search', 'role-assignment', assignmentUserSearch.trim()],
    queryFn: () => {
      const q = assignmentUserSearch.trim()
      if (q.length < 2) return Promise.resolve([] as UserSearchItem[])
      return apiClient.get<UserSearchItem[]>(`/api/admin/users/search?q=${encodeURIComponent(q)}`, undefined, { credentials: 'include' })
    },
    enabled: assignmentModal.isOpen && assignmentPrincipalType === 'user' && canLookupMembers && assignmentUserSearch.trim().length >= 2,
    staleTime: 30 * 1000,
  })

  const memberCapabilitiesQ = useQuery({
    queryKey: ['engine-members', engine?.id, 'capabilities'],
    queryFn: () => getEngineMemberCapabilities(engine!.id),
    enabled: addMemberModal.isOpen && memberFlow === 'invite' && !!engine?.id && canInviteMembers,
  })

  const memberLookupQ = useQuery({
    queryKey: ['engine-members', engine?.id, 'lookup', debouncedMemberEmail.toLowerCase(), memberRole],
    queryFn: () => lookupEngineMember(engine!.id, { email: debouncedMemberEmail.toLowerCase(), role: memberRole }),
    enabled: addMemberModal.isOpen && !!engine?.id && canLookupMembers && isValidEmail(debouncedMemberEmail),
    staleTime: 30 * 1000,
  })

  const resetAddMemberForm = React.useCallback((flow: MemberModalFlow = 'invite') => {
    setMemberEmail('')
    setMemberFlow(flow)
    setMemberRole(flow === 'delegate' ? 'delegate' : 'operator')
    setMemberReveal(null)
    setMemberError('')
    setMemberSubmitting(false)
    setMemberUserSearch('')
    setSelectedMemberUser(null)
    setMemberEmailTouched(false)
    setDebouncedMemberEmail('')
    setMemberDeliveryMethod(getPreferredInvitationDeliveryMethod(memberCapabilitiesQ.data || { ssoRequired: false, emailConfigured: true }))
  }, [memberCapabilitiesQ.data])

  const closeAddMemberModal = React.useCallback(() => {
    resetAddMemberForm('invite')
    addMemberModal.closeModal()
  }, [addMemberModal, resetAddMemberForm])

  const openInviteUserModal = React.useCallback(() => {
    resetAddMemberForm('invite')
    addMemberModal.openModal()
  }, [addMemberModal, resetAddMemberForm])

  const openDelegateModal = React.useCallback(() => {
    resetAddMemberForm('delegate')
    addMemberModal.openModal()
  }, [addMemberModal, resetAddMemberForm])

  const resetAssignmentForm = React.useCallback(() => {
    setAssignmentPrincipalType('user')
    setAssignmentPrincipalIdInput('')
    setAssignmentUserEmail('')
    setAssignmentUserSearch('')
    setSelectedAssignmentUser(null)
    setAssignmentRoleId('')
    setAssignmentError('')
  }, [])

  const closeAssignmentModal = React.useCallback(() => {
    resetAssignmentForm()
    assignmentModal.closeModal()
  }, [assignmentModal, resetAssignmentForm])

  const openAssignmentModal = React.useCallback(() => {
    resetAssignmentForm()
    assignmentModal.openModal()
  }, [assignmentModal, resetAssignmentForm])

  const deleteMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      if (!canRemoveMembers) throw new Error('Missing permission to remove engine members')
      await removeEngineMember(engine!.id, memberId)
    },
    onSuccess: async (_result, memberId) => {
      await syncCustomRoleAssignments(memberId, [])
      await qc.invalidateQueries({ queryKey: ['engine-members', engine?.id] })
      notify({ kind: 'success', title: 'Member removed' })
    },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to remove member', subtitle: getUiErrorMessage(e, 'Failed to remove member') }),
  })

  const assignDelegateM = useMutation({
    mutationFn: (email: string | null) => {
      if (!canManageDelegate) throw new Error('Missing permission to manage engine delegates')
      return assignEngineDelegate(engine!.id, email)
    },
    onSuccess: async (_result, email) => {
      await qc.invalidateQueries({ queryKey: ['engine-members', engine?.id] })
      closeAddMemberModal()
      notify({ kind: 'success', title: email ? 'Delegate assigned' : 'Delegate removed' })
    },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to update delegate', subtitle: getUiErrorMessage(e, 'Failed to update delegate') }),
  })

  const updateMemberRoleM = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'operator' | 'deployer' }) => {
      if (!canUpdateMemberRoles) throw new Error('Missing permission to update engine member roles')
      return updateEngineMemberRole(engine!.id, userId, role)
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['engine-members', engine?.id] })
      notify({ kind: 'success', title: 'Role updated' })
    },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to update role', subtitle: getUiErrorMessage(e, 'Failed to update role') }),
  })

  const reissuePendingInviteM = useMutation({
    mutationFn: (invite: PendingEngineInvite) => {
      if (!canInviteMembers) throw new Error('Missing permission to invite engine members')
      return reissueManualEngineInvitation(engine!.id, invite.invitationId)
    },
    onSuccess: async (result, invite) => {
      await qc.invalidateQueries({ queryKey: ['engine-members', engine?.id] })
      setMemberError('')
      if (!result.inviteUrl || !result.oneTimePassword) {
        notify({ kind: 'error', title: 'Failed to reissue invitation', subtitle: 'The new invite link or one-time password was missing.' })
        return
      }
      setMemberReveal({
        email: invite.email,
        inviteUrl: result.inviteUrl,
        oneTimePassword: result.oneTimePassword,
      })
      addMemberModal.openModal()
    },
    onError: (error: any, invite) => {
      const parsed = parseApiError(error, invite.status === 'expired' ? 'Failed to recreate invitation' : 'Failed to regenerate invitation')
      notify({ kind: 'error', title: 'Failed to reissue invitation', subtitle: parsed.message })
    },
  })

  const approveRequestM = useMutation({
    mutationFn: (requestId: string) => {
      if (!canApproveProjectAccess) throw new Error('Missing permission to approve engine project access')
      return approveEngineAccessRequest(engine!.id, requestId)
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['engine-access-requests', engine?.id] })
      await qc.invalidateQueries({ queryKey: ['engine-members', engine?.id] })
      notify({ kind: 'success', title: 'Access request approved' })
    },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to approve request', subtitle: getUiErrorMessage(e, 'Failed to approve request') }),
  })

  const denyRequestM = useMutation({
    mutationFn: (requestId: string) => {
      if (!canDenyProjectAccess) throw new Error('Missing permission to deny engine project access')
      return denyEngineAccessRequest(engine!.id, requestId)
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['engine-access-requests', engine?.id] })
      notify({ kind: 'success', title: 'Access request denied' })
    },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to deny request', subtitle: getUiErrorMessage(e, 'Failed to deny request') }),
  })

  const assignCustomRoleM = useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) => apiClient.post<{ id: string }>('/api/authz/role-assignments', {
      principalType: 'user',
      principalId: userId,
      roleId,
      resourceType: 'engine',
      resourceId: engine!.id,
    }, { credentials: 'include' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['engine-members', engine?.id, 'role-assignments'] })
      await qc.invalidateQueries({ queryKey: ['engines'] })
    },
  })

  const assignScopedRoleM = useMutation({
    mutationFn: ({ principalType, principalId, roleId }: { principalType: AuthzPrincipalType; principalId: string; roleId: string }) => apiClient.post<{ id: string }>('/api/authz/role-assignments', {
      principalType,
      principalId,
      roleId,
      resourceType: 'engine',
      resourceId: engine!.id,
    }, { credentials: 'include' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['engine-members', engine?.id, 'role-assignments'] })
      await qc.invalidateQueries({ queryKey: ['engines'] })
      notify({ kind: 'success', title: 'Access assigned' })
      closeAssignmentModal()
    },
    onError: (error: any) => {
      setAssignmentError(getUiErrorMessage(error, 'Failed to assign access'))
    },
  })

  const removeScopedRoleAssignmentM = useMutation({
    mutationFn: ({ assignmentId }: { assignmentId: string; quiet?: boolean }) => apiClient.delete(`/api/authz/role-assignments/${encodeURIComponent(assignmentId)}`, { credentials: 'include' }),
    onSuccess: async (_result, variables) => {
      await qc.invalidateQueries({ queryKey: ['engine-members', engine?.id, 'role-assignments'] })
      await qc.invalidateQueries({ queryKey: ['engines'] })
      if (!variables.quiet) {
        notify({ kind: 'success', title: 'Access removed' })
      }
    },
    onError: (error: any) => notify({ kind: 'error', title: 'Failed to remove access', subtitle: getUiErrorMessage(error, 'Failed to remove access') }),
  })

  const resolvedInviteCapabilities = memberCapabilitiesQ.data || { ssoRequired: false, emailConfigured: true }
  const localLoginDisabled = Boolean(resolvedInviteCapabilities.ssoRequired)
  const emailConfigured = Boolean(resolvedInviteCapabilities.emailConfigured)
  const inviteDeliveryOptions = getInvitationDeliveryOptions(resolvedInviteCapabilities)
  const noInviteDeliveryOptions = inviteDeliveryOptions.length === 0
  const members = Array.isArray(membersQ.data?.members) ? membersQ.data!.members : []
  const pendingInvites = Array.isArray(membersQ.data?.pendingInvites) ? membersQ.data!.pendingInvites : []
  const memberLookupMode = memberLookupQ.data?.mode || (memberRole === 'delegate' ? 'direct-add-only' : 'invite')
  const existingLookupUser = memberLookupQ.data?.user || null
  const memberHeaders = React.useMemo(() => [
    { key: 'name', header: 'Name' },
    { key: 'roles', header: 'Access' },
    { key: 'actions', header: '' },
  ], [])

  React.useEffect(() => {
    if (!addMemberModal.isOpen) {
      setDebouncedMemberEmail('')
      return
    }

    const handle = window.setTimeout(() => {
      setDebouncedMemberEmail(trimmedMemberEmail)
    }, 250)

    return () => window.clearTimeout(handle)
  }, [addMemberModal.isOpen, trimmedMemberEmail])

  React.useEffect(() => {
    if (!addMemberModal.isOpen) return
    setMemberDeliveryMethod(getPreferredInvitationDeliveryMethod(resolvedInviteCapabilities))
  }, [addMemberModal.isOpen, resolvedInviteCapabilities])

  const resolveMemberName = React.useCallback((member: EngineMember) => {
    const fullName = `${member.user?.firstName || ''}${member.user?.firstName && member.user?.lastName ? ' ' : ''}${member.user?.lastName || ''}`.trim()
    return fullName || member.user?.email || member.userId
  }, [])

  const resolvePendingInviteName = React.useCallback((invite: PendingEngineInvite) => {
    const fullName = `${invite.firstName || ''}${invite.firstName && invite.lastName ? ' ' : ''}${invite.lastName || ''}`.trim()
    return fullName || invite.email
  }, [])

  const memberRows = React.useMemo(() => {
    return members.map((member) => ({
      id: member.userId,
      name: resolveMemberName(member),
      email: member.user?.email || '',
      role: member.role,
    }))
  }, [members, resolveMemberName])

  const visibleMembersTableRows = React.useMemo(() => {
    const q = collaboratorsSearch.trim().toLowerCase()
    if (!q) return memberRows
    return memberRows.filter((row) => {
      const hay = [String(row.name || ''), String(row.email || ''), String(row.role || ''), String(row.id || '')].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [memberRows, collaboratorsSearch])

  const visiblePendingInvites = React.useMemo(() => {
    const q = collaboratorsSearch.trim().toLowerCase()
    if (!q) return pendingInvites
    return pendingInvites.filter((invite) => {
      const hay = [
        resolvePendingInviteName(invite),
        invite.email,
        invite.role,
        invite.status,
        invite.deliveryMethod,
      ].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [pendingInvites, collaboratorsSearch, resolvePendingInviteName])

  const pendingRows = visiblePendingInvites.map((invite) => ({
    id: `invite:${invite.invitationId}`,
    name: resolvePendingInviteName(invite),
    email: invite.email,
  }))
  const tableRows = [...pendingRows, ...visibleMembersTableRows]
  const assignableRoles = React.useMemo(() => (
    (Array.isArray(customRolesQ.data) ? customRolesQ.data : [])
      .filter((role) => role.scope === 'engine' && role.isAssignable && !role.isArchived)
  ), [customRolesQ.data])
  const customRoles = React.useMemo(() => assignableRoles.filter((role) => role.kind === 'custom'), [assignableRoles])
  const assignableRoleNameById = React.useMemo(() => new Map(assignableRoles.map((role) => [role.id, role.name])), [assignableRoles])
  const customRoleNameById = React.useMemo(() => new Map(customRoles.map((role) => [role.id, role.name])), [customRoles])
  const customAssignmentsByUser = React.useMemo(() => {
    const byUser = new Map<string, ScopedRoleAssignment[]>()
    for (const assignment of Array.isArray(roleAssignmentsQ.data) ? roleAssignmentsQ.data : []) {
      if (assignment.resourceType !== 'engine' || assignment.resourceId !== engine?.id) continue
      if (scopedAssignmentPrincipalType(assignment) !== 'user') continue
      if (!customRoleNameById.has(assignment.roleId)) continue
      const userId = scopedAssignmentPrincipalId(assignment)
      if (!userId) continue
      const entries = byUser.get(userId) || []
      entries.push(assignment)
      byUser.set(userId, entries)
    }
    return byUser
  }, [customRoleNameById, engine?.id, roleAssignmentsQ.data])
  const scopedAssignments = React.useMemo(() => (
    (Array.isArray(roleAssignmentsQ.data) ? roleAssignmentsQ.data : [])
      .filter((assignment) => assignment.resourceType === 'engine' && assignment.resourceId === engine?.id)
  ), [engine?.id, roleAssignmentsQ.data])
  const governanceScopedAssignments = React.useMemo(() => scopedAssignments.filter(isGovernanceScopedAssignment), [scopedAssignments])
  const ordinaryScopedAssignments = React.useMemo(() => scopedAssignments.filter((assignment) => !isGovernanceScopedAssignment(assignment)), [scopedAssignments])

  async function syncCustomRoleAssignments(userId: string, nextRoleIds: string[]) {
    const next = new Set(nextRoleIds)
    const current = customAssignmentsByUser.get(userId) || []
    const currentRoleIds = new Set(current.map((assignment) => assignment.roleId))
    await Promise.all([
      ...nextRoleIds
        .filter((roleId) => !currentRoleIds.has(roleId))
        .map((roleId) => assignCustomRoleM.mutateAsync({ userId, roleId })),
      ...current
        .filter((assignment) => !next.has(assignment.roleId) && assignment.source === 'manual')
        .map((assignment) => removeScopedRoleAssignmentM.mutateAsync({ assignmentId: assignment.id, quiet: true })),
    ])
  }

  const toggleCustomRoleSelection = React.useCallback((roleId: string, checked: boolean) => {
    setCustomRoleSelection((current) => checked
      ? Array.from(new Set([...current, roleId]))
      : current.filter((id) => id !== roleId)
    )
  }, [])

  const openCustomRoleEditor = React.useCallback((member: EngineMember) => {
    setCustomRoleEditorMember(member)
    setCustomRoleSelection((customAssignmentsByUser.get(member.userId) || []).map((assignment) => assignment.roleId))
  }, [customAssignmentsByUser])

  const closeCustomRoleEditor = React.useCallback(() => {
    setCustomRoleEditorMember(null)
    setCustomRoleSelection([])
  }, [])

  const submitCustomRoleEditor = React.useCallback(async () => {
    if (!customRoleEditorMember) return
    try {
      await syncCustomRoleAssignments(customRoleEditorMember.userId, customRoleSelection)
      notify({ kind: 'success', title: 'Custom roles updated' })
      closeCustomRoleEditor()
    } catch (error: any) {
      notify({ kind: 'error', title: 'Failed to update custom roles', subtitle: getUiErrorMessage(error, 'Failed to update custom roles') })
    }
  }, [closeCustomRoleEditor, customRoleEditorMember, customRoleSelection, notify, syncCustomRoleAssignments])

  const submitScopedAssignment = React.useCallback(() => {
    if (!assignmentRoleId) {
      setAssignmentError('Select a role to assign')
      return
    }

    if (assignmentPrincipalType === 'user' && !selectedAssignmentUser) {
      setAssignmentError('Select an existing user from the lookup results')
      return
    }

    if (!assignmentPrincipalId) {
      setAssignmentError(`Enter a ${ASSIGNMENT_PRINCIPAL_TYPE_LABELS[assignmentPrincipalType].toLowerCase()} identifier`)
      return
    }

    setAssignmentError('')
    assignScopedRoleM.mutate({
      principalType: assignmentPrincipalType,
      principalId: assignmentPrincipalId,
      roleId: assignmentRoleId,
    })
  }, [assignScopedRoleM, assignmentPrincipalId, assignmentPrincipalType, assignmentRoleId, selectedAssignmentUser])

  const submitAddMember = async () => {
    if (!isMemberEmailValid) {
      setMemberError('Please enter a valid email address')
      return
    }

    if (memberLookupMode === 'existing-member') {
      setMemberError('This user already has access to this engine')
      return
    }

    if (memberFlow === 'delegate' || memberRole === 'delegate') {
      if (!canAssignDelegate) {
        setMemberError('Your role cannot assign an engine delegate')
        return
      }
      if (memberLookupMode !== 'direct-add') {
        setMemberError('Delegates must already exist as platform users before they can be assigned to an engine')
        return
      }
      assignDelegateM.mutate(normalizedMemberEmail)
      return
    }

    if (memberLookupMode === 'direct-add') {
      setMemberError('This user already exists. Use Assign access to grant scoped engine access.')
      return
    }

    if (memberLookupMode === 'invite') {
      if (!canInviteMembers) {
        setMemberError('Your role can search users, but cannot invite new users to this engine')
        return
      }
      if (noInviteDeliveryOptions) {
        setMemberError('No invitation delivery method is available. Configure email delivery or disable SSO enforcement.')
        return
      }
      if (memberDeliveryMethod === 'manual' && localLoginDisabled) {
        setMemberError('Local sign-in is disabled while SSO is enabled. One-time password invites are unavailable.')
        return
      }
      if (memberDeliveryMethod === 'email' && !emailConfigured) {
        setMemberError('Email delivery is not configured. Configure a provider in Admin UI → Platform Settings → Email.')
        return
      }
    }

    if (memberRole !== 'operator' && memberRole !== 'deployer') {
      setMemberError('Choose an operator or deployer role for a member invitation')
      return
    }

    try {
      setMemberSubmitting(true)
      setMemberError('')
      setMemberReveal(null)

      const result = await addEngineMember(engine!.id, {
        email: normalizedMemberEmail,
        role: memberRole,
        ...(memberLookupMode === 'invite' ? { deliveryMethod: memberDeliveryMethod } : {}),
      })

      await qc.invalidateQueries({ queryKey: ['engine-members', engine?.id] })

      if (result.invited) {
        if (!result.emailSent && result.inviteUrl && result.oneTimePassword) {
          setMemberReveal({
            email: normalizedMemberEmail,
            inviteUrl: result.inviteUrl,
            oneTimePassword: result.oneTimePassword,
          })
          return
        }

        notify({
          kind: 'success',
          title: 'Member invited',
          subtitle: result.emailSent ? `Invitation emailed to ${normalizedMemberEmail}` : result.emailError || 'Invitation created successfully.',
        })
      } else {
        notify({ kind: 'success', title: 'Invitation request completed' })
      }

      closeAddMemberModal()
    } catch (error) {
      const parsed = parseApiError(error, 'Failed to add member')
      setMemberError(parsed.message)
    } finally {
      setMemberSubmitting(false)
    }
  }

  if (!open || !engine) return null

  return (
    <>
      <ComposedModal open={open && !childModalOpen} size="lg" onClose={onClose}>
        <ModalHeader label={engine.name} title="Engine members" closeModal={onClose} />
        <ModalBody>
          <div data-eg-collaborators-panel>
            {canViewProjectAccess && accessRequestsQ.data && accessRequestsQ.data.length > 0 && (
              <div style={{ marginBottom: 'var(--spacing-5)', padding: 'var(--spacing-4)', background: 'var(--cds-layer-02)', borderRadius: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 'var(--spacing-3)', display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
                  <span>Pending access requests</span>
                  <Tag type="purple" size="sm">{accessRequestsQ.data.length}</Tag>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
                  {accessRequestsQ.data.map((req) => (
                    <div
                      key={req.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: 'var(--spacing-3)',
                        background: 'var(--cds-layer-01)',
                        borderRadius: 4,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{req.projectId}</div>
                        <div style={{ fontSize: 12, color: 'var(--cds-text-secondary)' }}>Requested by {req.requestedById}</div>
                      </div>
                      {(canDenyProjectAccess || canApproveProjectAccess) ? (
                        <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
                          {canDenyProjectAccess ? (
                            <Button kind="ghost" size="sm" hasIconOnly renderIcon={Close} iconDescription="Deny" onClick={() => denyRequestM.mutate(req.id)} disabled={denyRequestM.isPending} />
                          ) : null}
                          {canApproveProjectAccess ? (
                            <Button kind="primary" size="sm" hasIconOnly renderIcon={Checkmark} iconDescription="Approve" onClick={() => approveRequestM.mutate(req.id)} disabled={approveRequestM.isPending} />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!canViewMembers ? (
              <InlineNotification
                lowContrast
                kind="info"
                title="Member list unavailable"
                subtitle="Your role can review project access requests, but cannot view engine members."
                hideCloseButton
              />
            ) : membersQ.isLoading ? (
              <div style={{ paddingTop: 'var(--spacing-3)' }}>
                <DataTableSkeleton showHeader={false} showToolbar={false} rowCount={6} columnCount={memberHeaders.length} headers={memberHeaders as any} />
              </div>
            ) : membersQ.isError ? (
              <div style={{ paddingTop: 'var(--spacing-3)' }}>
                <InlineNotification lowContrast kind="error" title="Failed to load members" />
              </div>
            ) : (
              <div style={{ height: '60vh', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                  <DataTable rows={tableRows} headers={memberHeaders}>
                    {({ rows, headers, getHeaderProps, getRowProps, getTableProps, getToolbarProps }) => {
                      const toolbarProps: any = getToolbarProps()
                      return (
                        <StarbaseTableShell>
                          <TableToolbar {...toolbarProps} className={`${toolbarProps.className || ''} cds--table-toolbar--sm`.trim()}>
                            <TableToolbarContent>
                              <TableToolbarSearch
                                size="sm"
                                expanded={collaboratorsSearchExpanded}
                                onExpand={() => setCollaboratorsSearchExpanded(true)}
                                onBlur={() => {
                                  if (!collaboratorsSearch) setCollaboratorsSearchExpanded(false)
                                }}
                                value={collaboratorsSearch}
                                onChange={(e: any) => setCollaboratorsSearch(String(e.target.value || ''))}
                                placeholder="Search members and invitations"
                              />
                              {canOpenInviteUser && (
                                <Button kind="primary" size="sm" onClick={openInviteUserModal}>
                                  Invite user
                                </Button>
                              )}
                              {canOpenDelegateAssignment && (
                                <Button kind="secondary" size="sm" onClick={openDelegateModal}>
                                  Assign delegate
                                </Button>
                              )}
                              {canManageScopedAccess && (
                                <Button kind="secondary" size="sm" onClick={openAssignmentModal}>
                                  Assign access
                                </Button>
                              )}
                            </TableToolbarContent>
                          </TableToolbar>

                          <Table {...getTableProps()} size="sm">
                            <TableHead>
                              <TableRow>
                                {headers.map((header) => {
                                  const { key, ...headerProps } = getHeaderProps({ header })
                                  return (
                                    <TableHeader key={key} {...headerProps} style={header.key === 'actions' ? { width: 44 } : undefined}>
                                      {header.header}
                                    </TableHeader>
                                  )
                                })}
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {rows.map((row) => {
                                const rowProps: any = getRowProps({ row })
                                const pendingInvite = row.id.startsWith('invite:')
                                  ? visiblePendingInvites.find((invite) => `invite:${invite.invitationId}` === row.id)
                                  : null
                                const member = pendingInvite ? null : members.find((item) => item.userId === row.id)
                                const isGovernanceMember = isGovernanceEngineMember(member)
                                const canReissuePendingInvite = Boolean(
                                  canInviteMembers && pendingInvite && pendingInvite.deliveryMethod === 'manual' && pendingInvite.status !== 'onboarding'
                                )
                                const canEditCustomRoles = customRoles.length > 0 && canUpdateMemberRoles
                                const canChangeMemberRole = Boolean(member && !isGovernanceMember && canUpdateMemberRoles)
                                const canRemoveMember = Boolean(member && !isGovernanceMember && canRemoveMembers)
                                const canShowMemberActions = Boolean(
                                  member &&
                                  !isGovernanceMember &&
                                  (canEditCustomRoles || canChangeMemberRole || canRemoveMember)
                                )

                                return (
                                  <TableRow key={rowProps.key} {...rowProps}>
                                    <TableCell style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                          {row.cells.find((cell) => cell.info.header === 'name')?.value}
                                        </div>
                                        {(pendingInvite?.email || member?.user?.email) ? (
                                          <div style={{ color: 'var(--cds-text-secondary, #6f6f6f)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {pendingInvite?.email || member?.user?.email}
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
                                          <>
                                            <Tag type={inviteStatusTagType(pendingInvite.status)} size="sm">{inviteStatusLabel(pendingInvite.status)}</Tag>
                                            <Tag type={tagTypeForRole(pendingInvite.role)} size="sm">{roleLabel(pendingInvite.role)}</Tag>
                                          </>
                                        ) : member ? (
                                          <>
                                            <Tag type={tagTypeForRole(member.role)} size="sm">{roleLabel(member.role)}</Tag>
                                            {(customAssignmentsByUser.get(member.userId) || []).map((assignment) => (
                                              <Tag key={assignment.id} type="cyan" size="sm">
                                                {customRoleNameById.get(assignment.roleId) || assignment.roleName || 'Custom role'}
                                              </Tag>
                                            ))}
                                          </>
                                        ) : null}
                                      </div>
                                    </TableCell>
                                    <TableCell style={{ textAlign: 'right' }}>
                                      {canReissuePendingInvite ? (
                                        <GuardedOverflowMenu size="sm" flipped wrapperClasses="eg-no-tooltip" iconDescription="Invitation options">
                                          <GuardedOverflowMenuItem
                                            itemText={pendingInvite?.status === 'expired' ? 'Recreate invite link and OTP' : 'Regenerate invite link and OTP'}
                                            onClick={() => pendingInvite && reissuePendingInviteM.mutate(pendingInvite)}
                                          />
                                        </GuardedOverflowMenu>
                                      ) : canAssignDelegate && isDelegateEngineMember(member) && member ? (
                                        <GuardedOverflowMenu size="sm" flipped iconDescription="Options">
                                          <GuardedOverflowMenuItem itemText="Remove delegate" isDelete hasDivider onClick={() => assignDelegateM.mutate(null)} />
                                        </GuardedOverflowMenu>
                                      ) : canShowMemberActions ? (
                                        <GuardedOverflowMenu size="sm" flipped iconDescription="Options">
                                          {canEditCustomRoles ? (
                                            <GuardedOverflowMenuItem itemText="Edit custom roles" onClick={() => openCustomRoleEditor(member as EngineMember)} />
                                          ) : null}
                                          {canChangeMemberRole ? (
                                            isOperatorEngineMember(member) ? (
                                              <GuardedOverflowMenuItem itemText="Change role to Deployer" onClick={() => updateMemberRoleM.mutate({ userId: (member as EngineMember).userId, role: 'deployer' })} />
                                            ) : (
                                              <GuardedOverflowMenuItem itemText="Change role to Operator" onClick={() => updateMemberRoleM.mutate({ userId: (member as EngineMember).userId, role: 'operator' })} />
                                            )
                                          ) : null}
                                          {canRemoveMember ? (
                                            <GuardedOverflowMenuItem itemText="Remove" isDelete hasDivider={canEditCustomRoles || canChangeMemberRole} onClick={() => deleteMemberMutation.mutate((member as EngineMember).userId)} />
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
                                      {collaboratorsSearch ? 'No members or invitations match this search.' : 'No engine members or pending invitations yet.'}
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

                  {canManageScopedAccess ? (
                    <div style={{ marginTop: 'var(--spacing-5)', padding: 'var(--spacing-4)', background: 'var(--cds-layer-02)', borderRadius: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)', marginBottom: 'var(--spacing-3)' }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600 }}>Scoped RBAC assignments</div>
                          <div style={{ fontSize: 12, color: 'var(--cds-text-secondary)' }}>
                            Principal-scoped access from the authorization model. Legacy members remain listed above during migration.
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
                          <Tag type="magenta" size="sm">{governanceScopedAssignments.length} governance</Tag>
                          <Tag type="gray" size="sm">{ordinaryScopedAssignments.length} scoped</Tag>
                        </div>
                      </div>
                      {roleAssignmentsQ.isLoading ? (
                        <DataTableSkeleton showHeader={false} showToolbar={false} rowCount={3} columnCount={3} headers={[
                          { key: 'principal', header: 'Principal' },
                          { key: 'role', header: 'Role' },
                          { key: 'source', header: 'Source' },
                        ] as any} />
                      ) : roleAssignmentsQ.isError ? (
                        <InlineNotification lowContrast kind="error" title="Failed to load scoped assignments" hideCloseButton />
                      ) : scopedAssignments.length === 0 ? (
                        <div style={{ color: 'var(--cds-text-secondary)', fontSize: 13 }}>No scoped RBAC assignments yet.</div>
                      ) : (
                        <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
                          {governanceScopedAssignments.length > 0 ? (
                            <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>Governance grants</div>
                              {governanceScopedAssignments.map((assignment) => (
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
                                    <Tag type="magenta" size="sm">
                                      {formatScopedRoleName(assignment.roleId, assignment.roleName)}
                                    </Tag>
                                    <Tag type={tagTypeForAssignmentSource(assignment.source)} size="sm">
                                      {assignment.source}
                                    </Tag>
                                  </div>
                                  <Tag type="gray" size="sm">managed</Tag>
                                  <div style={{ gridColumn: '1 / -1', color: 'var(--cds-text-secondary)', fontSize: 12, overflowWrap: 'anywhere' }}>
                                    Lineage: {formatScopedAssignmentSourceLineage(assignment)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}

                          {ordinaryScopedAssignments.length > 0 ? (
                            <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>Scoped assignments</div>
                              {ordinaryScopedAssignments.map((assignment) => (
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
                                      {assignableRoleNameById.get(assignment.roleId) || formatScopedRoleName(assignment.roleId, assignment.roleName)}
                                    </Tag>
                                    <Tag type={tagTypeForAssignmentSource(assignment.source)} size="sm">
                                      {assignment.source}
                                    </Tag>
                                  </div>
                                  {assignment.source === 'manual' ? (
                                    <Button
                                      kind="ghost"
                                      size="sm"
                                      onClick={() => removeScopedRoleAssignmentM.mutate({ assignmentId: assignment.id })}
                                      disabled={removeScopedRoleAssignmentM.isPending}
                                    >
                                      Remove
                                    </Button>
                                  ) : assignment.source === 'sso' && ssoManagedAccess ? (
                                    <Tag type="purple" size="sm">Managed by SSO mapping</Tag>
                                  ) : (
                                    <Tag type="gray" size="sm">managed</Tag>
                                  )}
                                  <div style={{ gridColumn: '1 / -1', color: 'var(--cds-text-secondary)', fontSize: 12, overflowWrap: 'anywhere' }}>
                                    Lineage: {formatScopedAssignmentSourceLineage(assignment)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
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

      <InvitationFlowModal
        open={addMemberModal.isOpen}
        onClose={closeAddMemberModal}
        onSubmit={submitAddMember}
        label={memberFlow === 'delegate' ? 'Engine delegate' : 'Engine invitation'}
        title={memberFlow === 'delegate' ? 'Assign delegate' : 'Invite user'}
        submitText={memberFlow === 'delegate' ? 'Save delegate' : 'Create invitation'}
        busy={memberSubmitting || assignDelegateM.isPending || reissuePendingInviteM.isPending}
        busyText={memberFlow === 'delegate' ? 'Saving...' : 'Creating...'}
        submitDisabled={
          !isMemberEmailValid ||
          memberLookupQ.isFetching ||
          (memberFlow === 'invite' && memberCapabilitiesQ.isLoading) ||
          memberLookupMode === 'existing-member' ||
          (memberFlow === 'invite' && memberLookupMode !== 'invite') ||
          (memberFlow === 'invite' && !canInviteMembers) ||
          (memberFlow === 'delegate' && memberLookupMode !== 'direct-add') ||
          (memberFlow === 'invite' && noInviteDeliveryOptions)
        }
        revealMode={Boolean(memberReveal)}
        onRevealSecondary={resetAddMemberForm}
        onRevealPrimary={closeAddMemberModal}
      >
        {memberReveal ? (
          <InvitationRevealPanel data={memberReveal} subtitle={`Copy and share the invite link and one-time password for ${memberReveal.email}.`} />
        ) : (
          <>
            {memberError && (
              <InlineNotification kind="error" title="Error" subtitle={memberError} lowContrast hideCloseButton />
            )}
            {memberFlow === 'delegate' && (
              <InlineNotification
                kind="info"
                title="Existing user required"
                subtitle="Delegates must already exist as platform users before they can be assigned to an engine."
                lowContrast
                hideCloseButton
              />
            )}
            {memberFlow === 'invite' && memberLookupMode === 'invite' && !canInviteMembers && (
              <InlineNotification
                kind="warning"
                title="Cannot create invitation"
                subtitle="Your role can search users, but cannot invite new users to this engine."
                lowContrast
                hideCloseButton
              />
            )}
            {memberFlow === 'invite' && localLoginDisabled && (
              <InlineNotification
                kind="info"
                title="Local sign-in disabled"
                subtitle="One-time password invitations are unavailable while SSO is enforced. Email delivery remains available."
                lowContrast
                hideCloseButton
              />
            )}
            {memberFlow === 'invite' && !emailConfigured && !localLoginDisabled && (
              <InlineNotification
                kind="info"
                title="Email delivery unavailable"
                subtitle="Email is not configured in Admin UI → Platform Settings → Email, so invitations must be delivered manually."
                lowContrast
                hideCloseButton
              />
            )}
            {memberFlow === 'invite' && noInviteDeliveryOptions && (
              <InlineNotification
                kind="warning"
                title="No delivery method available"
                subtitle="Email is not configured and manual one-time password onboarding is unavailable while SSO is enforced."
                lowContrast
                hideCloseButton
              />
            )}
            {memberLookupMode === 'existing-member' && (
              <InlineNotification
                kind="warning"
                title="User already has access"
                subtitle="Select a different user or update their current engine access from the table."
                lowContrast
                hideCloseButton
              />
            )}
            {existingLookupUser && memberLookupMode === 'direct-add' && (
              <InlineNotification
                kind="info"
                title={memberFlow === 'delegate' ? 'Existing user found' : 'Use Assign access'}
                subtitle={memberFlow === 'delegate' ? `${existingLookupUser.email} will be assigned as delegate.` : `${existingLookupUser.email} already exists. Assign scoped access from the main dialog instead.`}
                lowContrast
                hideCloseButton
              />
            )}

            <div>
              <div style={{ fontSize: 'var(--cds-label-01-font-size, 0.75rem)', marginBottom: 'var(--spacing-3)' }}>Who</div>
              <UserLookupEmailField
                id="engine-member-user-search"
                labelText="Email"
                placeholder={memberFlow === 'delegate' ? 'Search existing users by email' : 'Enter an email to invite'}
                value={memberEmail}
                searchValue={memberUserSearch}
                suggestionItems={Array.isArray(usersQ.data) ? usersQ.data : []}
                selectedItem={selectedMemberUser}
                invalid={memberEmailTouched && !!trimmedMemberEmail && !isMemberEmailValid}
                invalidText="Enter a valid email address"
                disabled={memberSubmitting || assignDelegateM.isPending}
                onChange={(next) => {
                  setMemberEmail(next)
                  setMemberUserSearch(next)
                  if (selectedMemberUser && next.trim().toLowerCase() !== selectedMemberUser.email.toLowerCase()) {
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

            {memberFlow === 'invite' ? (
              <div>
                <div style={{ fontSize: 'var(--cds-label-01-font-size, 0.75rem)', marginBottom: 'var(--spacing-3)' }}>Access</div>
                <Select
                  id="engine-member-role"
                  labelText="Role"
                  value={memberRole}
                  onChange={(e: any) => setMemberRole(e.target.value as AssignableEngineRole)}
                  disabled={memberSubmitting || assignDelegateM.isPending}
                >
                  <SelectItem value="operator" text="Operator" />
                  <SelectItem value="deployer" text="Deployer" />
                </Select>
                <div style={{ marginTop: 'var(--spacing-3)', fontSize: '0.75rem', color: 'var(--cds-text-secondary, #525252)' }}>
                  {getEngineRoleDescription(memberRole)}
                </div>
              </div>
            ) : null}

            {customRoles.length > 0 && memberFlow === 'invite' && memberLookupMode === 'invite' && (
              <InlineNotification
                kind="info"
                title="Custom roles"
                subtitle="Custom roles can be assigned after the invited user accepts and appears in the members table."
                lowContrast
                hideCloseButton
              />
            )}

            {memberFlow === 'invite' && memberLookupMode === 'invite' && !noInviteDeliveryOptions && (
              <Select
                id="engine-member-delivery-method"
                labelText="Delivery method"
                value={memberDeliveryMethod}
                onChange={(e: any) => setMemberDeliveryMethod(e.target.value as InvitationDeliveryMethod)}
                disabled={memberSubmitting}
              >
                {inviteDeliveryOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value} text={option.text} />
                ))}
              </Select>
            )}
          </>
        )}
      </InvitationFlowModal>

      <ComposedModal open={assignmentModal.isOpen} size="sm" onClose={closeAssignmentModal}>
        <ModalHeader label="Engine access" title="Assign access" closeModal={closeAssignmentModal} />
        <ModalBody>
          <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
            {assignmentError ? (
              <InlineNotification kind="error" title="Error" subtitle={assignmentError} lowContrast hideCloseButton />
            ) : null}

            <Select
              id="engine-scoped-assignment-principal-type"
              labelText="Principal type"
              value={assignmentPrincipalType}
              onChange={(event: any) => {
                setAssignmentPrincipalType(event.target.value as AuthzPrincipalType)
                setAssignmentPrincipalIdInput('')
                setAssignmentUserEmail('')
                setAssignmentUserSearch('')
                setSelectedAssignmentUser(null)
                setAssignmentError('')
              }}
              disabled={assignScopedRoleM.isPending}
            >
              <SelectItem value="user" text="User" />
              <SelectItem value="group" text="Group" />
              <SelectItem value="api_client" text="API client" />
              <SelectItem value="service_account" text="Service account" />
            </Select>

            {assignmentPrincipalType === 'user' ? (
              <>
                <UserLookupEmailField
                  id="engine-scoped-assignment-user-search"
                  labelText="User"
                  placeholder="Search existing users by email"
                  value={assignmentUserEmail}
                  searchValue={assignmentUserSearch}
                  suggestionItems={Array.isArray(assignmentUsersQ.data) ? assignmentUsersQ.data : []}
                  selectedItem={selectedAssignmentUser}
                  disabled={assignScopedRoleM.isPending}
                  onChange={(next) => {
                    setAssignmentUserEmail(next)
                    setAssignmentUserSearch(next)
                    if (selectedAssignmentUser && next.trim().toLowerCase() !== selectedAssignmentUser.email.toLowerCase()) {
                      setSelectedAssignmentUser(null)
                    }
                  }}
                  onSelect={(item) => {
                    setSelectedAssignmentUser(item)
                    setAssignmentUserEmail(item.email)
                    setAssignmentUserSearch(item.email)
                    setAssignmentError('')
                  }}
                />
                <div style={{ marginTop: 'var(--spacing-2)', fontSize: '0.75rem', color: 'var(--cds-text-secondary, #525252)' }}>
                  Scoped user assignments require an existing platform user.
                </div>
              </>
            ) : (
              <TextInput
                id="engine-scoped-assignment-principal-id"
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
                disabled={assignScopedRoleM.isPending}
                onChange={(event: any) => {
                  setAssignmentPrincipalIdInput(String(event.target.value || ''))
                  setAssignmentError('')
                }}
              />
            )}

            <Select
              id="engine-scoped-assignment-role"
              labelText="Role"
              value={assignmentRoleId}
              onChange={(event: any) => {
                setAssignmentRoleId(String(event.target.value || ''))
                setAssignmentError('')
              }}
              disabled={assignScopedRoleM.isPending || customRolesQ.isLoading}
            >
              <SelectItem value="" text={customRolesQ.isLoading ? 'Loading roles...' : 'Select role'} />
              {assignableRoles.map((role) => (
                <SelectItem key={role.id} value={role.id} text={role.name} />
              ))}
            </Select>
            {customRolesQ.isError ? (
              <InlineNotification kind="error" title="Role catalog unavailable" subtitle="Unable to load assignable roles for this engine." lowContrast hideCloseButton />
            ) : null}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button kind="secondary" onClick={closeAssignmentModal}>
            Cancel
          </Button>
          <Button
            kind="primary"
            onClick={submitScopedAssignment}
            disabled={assignScopedRoleM.isPending || !assignmentRoleId || !assignmentPrincipalId}
          >
            Assign
          </Button>
        </ModalFooter>
      </ComposedModal>

      {customRoleEditorMember && (
        <ComposedModal open size="sm" onClose={closeCustomRoleEditor}>
          <ModalHeader label="Engine members" title="Edit custom roles" closeModal={closeCustomRoleEditor} />
          <ModalBody>
            <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
              <div style={{ color: 'var(--cds-text-secondary, #525252)', fontSize: '0.875rem' }}>
                {customRoleEditorMember.user?.email || customRoleEditorMember.userId}
              </div>
              {customRoles.length > 0 ? customRoles.map((role) => (
                <Checkbox
                  key={role.id}
                  id={`engine-member-edit-custom-role-${role.id}`}
                  labelText={role.name}
                  checked={customRoleSelection.includes(role.id)}
                  onChange={(_, { checked }) => toggleCustomRoleSelection(role.id, Boolean(checked))}
                />
              )) : (
                <InlineNotification kind="info" title="No custom roles" subtitle="Create assignable engine custom roles in Access Control first." lowContrast hideCloseButton />
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button kind="secondary" onClick={closeCustomRoleEditor}>
              Cancel
            </Button>
            <Button kind="primary" onClick={submitCustomRoleEditor} disabled={assignCustomRoleM.isPending || removeScopedRoleAssignmentM.isPending}>
              Save
            </Button>
          </ModalFooter>
        </ComposedModal>
      )}
    </>
  )
}
