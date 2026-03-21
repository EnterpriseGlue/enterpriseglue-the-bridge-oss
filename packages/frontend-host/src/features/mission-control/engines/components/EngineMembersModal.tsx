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
  Select,
  SelectItem,
  ComposedModal,
  ModalHeader,
  ModalBody,
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
} from '@carbon/react'
import { Close, Checkmark } from '@carbon/icons-react'
import { useModal } from '../../../../shared/hooks/useModal'
import { useToast } from '../../../../shared/notifications/ToastProvider'
import { getUiErrorMessage, parseApiError } from '../../../../shared/api/apiErrorUtils'
import { apiClient } from '../../../../shared/api/client'
import InvitationFlowModal from '../../../../shared/components/InvitationFlowModal'
import InvitationRevealPanel from '../../../../shared/components/InvitationRevealPanel'
import UserLookupEmailField from '../../../../shared/components/UserLookupEmailField'
import { getInvitationDeliveryOptions, getPreferredInvitationDeliveryMethod, type InvitationCapabilities, type InvitationDeliveryMethod, type InvitationRevealData } from '../../../../shared/utils/invitationFlow'
import { StarbaseTableShell } from '../../../starbase/components/StarbaseTableShell'

// Types
type EngineRole = 'owner' | 'delegate' | 'operator' | 'deployer'

type EngineMember = {
  id: string
  engineId: string
  userId: string
  role: EngineRole
  grantedById?: string | null
  grantedAt: number
  user?: { id: string; email: string; firstName?: string | null; lastName?: string | null } | null
}

type AccessRequest = {
  id: string
  projectId: string
  engineId: string
  requestedById: string
  requestedRole: EngineRole
  status: 'pending' | 'approved' | 'denied'
  createdAt: number
  project?: { id: string; name: string } | null
  requestedBy?: { id: string; email: string; firstName?: string | null; lastName?: string | null } | null
}

type UserSearchItem = { id: string; email: string; firstName?: string | null; lastName?: string | null }
type PendingEngineInviteStatus = 'pending' | 'expired' | 'onboarding'
type PendingEngineInvite = {
  invitationId: string
  userId: string
  email: string
  firstName?: string | null
  lastName?: string | null
  role: 'operator' | 'deployer'
  status: PendingEngineInviteStatus
  deliveryMethod: InvitationDeliveryMethod
  expiresAt: number
  createdAt: number
}
type EngineMembersResponse = {
  members: EngineMember[]
  pendingInvites: PendingEngineInvite[]
}
type AssignableEngineRole = 'delegate' | 'operator' | 'deployer'

interface EngineMembersModalProps {
  open: boolean
  engine: { id: string; name: string; ownerId?: string; myRole?: string } | null
  canManage: boolean
  onClose: () => void
}

function roleLabel(role: EngineRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1)
}

function tagTypeForRole(role: EngineRole): 'red' | 'magenta' | 'teal' | 'blue' | 'gray' {
  switch (role) {
    case 'owner': return 'red'
    case 'delegate': return 'magenta'
    case 'operator': return 'teal'
    case 'deployer': return 'blue'
    default: return 'gray'
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

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export default function EngineMembersModal({ open, engine, canManage, onClose }: EngineMembersModalProps) {
  const { pathname } = useLocation()
  const qc = useQueryClient()
  const { notify } = useToast()
  const addMemberModal = useModal()
  const childModalOpen = addMemberModal.isOpen

  const tenantSlugMatch = pathname.match(/^\/t\/([^/]+)(?:\/|$)/)
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : 'default'

  const [memberEmail, setMemberEmail] = React.useState('')
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

  const trimmedMemberEmail = memberEmail.trim()
  const normalizedMemberEmail = trimmedMemberEmail.toLowerCase()
  const isMemberEmailValid = isValidEmail(trimmedMemberEmail)

  const membersQ = useQuery({
    queryKey: ['engine-members', engine?.id],
    queryFn: () => apiClient.get<EngineMembersResponse>(`/engines-api/engines/${encodeURIComponent(engine!.id)}/members`, undefined, { credentials: 'include' }),
    enabled: !!engine?.id && open,
  })

  const accessRequestsQ = useQuery({
    queryKey: ['engine-access-requests', engine?.id],
    queryFn: () => apiClient.get<AccessRequest[]>(`/engines-api/engines/${encodeURIComponent(engine!.id)}/access-requests`, undefined, { credentials: 'include' }),
    enabled: !!engine?.id && canManage && open,
  })

  const usersQ = useQuery({
    queryKey: ['admin', 'users', 'search', memberUserSearch.trim()],
    queryFn: () => {
      const q = memberUserSearch.trim()
      if (q.length < 2) return Promise.resolve([] as UserSearchItem[])
      return apiClient.get<UserSearchItem[]>(`/api/admin/users/search?q=${encodeURIComponent(q)}`, undefined, { credentials: 'include' })
    },
    enabled: addMemberModal.isOpen && memberUserSearch.trim().length >= 2,
    staleTime: 30 * 1000,
  })

  const memberCapabilitiesQ = useQuery({
    queryKey: ['engine-members', engine?.id, 'capabilities'],
    queryFn: () => apiClient.get<InvitationCapabilities>(`/engines-api/engines/${encodeURIComponent(engine!.id)}/members/capabilities`, undefined, { credentials: 'include' }),
    enabled: addMemberModal.isOpen && !!engine?.id,
  })

  const memberLookupQ = useQuery({
    queryKey: ['engine-members', engine?.id, 'lookup', debouncedMemberEmail.toLowerCase(), memberRole],
    queryFn: () => apiClient.get<{ mode: 'invite' | 'direct-add' | 'existing-member' | 'direct-add-only'; user?: UserSearchItem | null }>(
      `/engines-api/engines/${encodeURIComponent(engine!.id)}/members/lookup`,
      { email: debouncedMemberEmail.toLowerCase(), role: memberRole },
      { credentials: 'include' },
    ),
    enabled: addMemberModal.isOpen && !!engine?.id && isValidEmail(debouncedMemberEmail),
    staleTime: 30 * 1000,
  })

  const resetAddMemberForm = React.useCallback(() => {
    setMemberEmail('')
    setMemberRole('operator')
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
    resetAddMemberForm()
    addMemberModal.closeModal()
  }, [addMemberModal, resetAddMemberForm])

  const openAddMemberModal = React.useCallback(() => {
    resetAddMemberForm()
    addMemberModal.openModal()
  }, [addMemberModal, resetAddMemberForm])

  const deleteMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      await apiClient.delete(`/engines-api/engines/${encodeURIComponent(engine!.id)}/members/${encodeURIComponent(memberId)}`, { credentials: 'include' })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['engine-members', engine?.id] })
      notify({ kind: 'success', title: 'Member removed' })
    },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to remove member', subtitle: getUiErrorMessage(e, 'Failed to remove member') }),
  })

  const assignDelegateM = useMutation({
    mutationFn: (email: string | null) => apiClient.post(`/engines-api/engines/${encodeURIComponent(engine!.id)}/delegate`, { email }, { credentials: 'include' }),
    onSuccess: async (_result, email) => {
      await qc.invalidateQueries({ queryKey: ['engine-members', engine?.id] })
      closeAddMemberModal()
      notify({ kind: 'success', title: email ? 'Delegate assigned' : 'Delegate removed' })
    },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to update delegate', subtitle: getUiErrorMessage(e, 'Failed to update delegate') }),
  })

  const updateMemberRoleM = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'operator' | 'deployer' }) =>
      apiClient.patch<void>(`/engines-api/engines/${encodeURIComponent(engine!.id)}/members/${encodeURIComponent(userId)}`, { role }, { credentials: 'include' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['engine-members', engine?.id] })
      notify({ kind: 'success', title: 'Role updated' })
    },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to update role', subtitle: getUiErrorMessage(e, 'Failed to update role') }),
  })

  const reissuePendingInviteM = useMutation({
    mutationFn: (invite: PendingEngineInvite) => apiClient.post<any>(
      `/engines-api/engines/${encodeURIComponent(engine!.id)}/pending-invites/${encodeURIComponent(invite.invitationId)}/reissue`,
      {},
      { credentials: 'include' },
    ),
    onSuccess: async (result, invite) => {
      await qc.invalidateQueries({ queryKey: ['engine-members', engine?.id] })
      setMemberError('')
      setMemberReveal({
        email: invite.email,
        inviteUrl: String(result.inviteUrl),
        oneTimePassword: String(result.oneTimePassword),
      })
      addMemberModal.openModal()
    },
    onError: (error: any, invite) => {
      const parsed = parseApiError(error, invite.status === 'expired' ? 'Failed to recreate invitation' : 'Failed to regenerate invitation')
      notify({ kind: 'error', title: 'Failed to reissue invitation', subtitle: parsed.message })
    },
  })

  const approveRequestM = useMutation({
    mutationFn: (requestId: string) => apiClient.post<void>(`/engines-api/engines/${encodeURIComponent(engine!.id)}/access-requests/${encodeURIComponent(requestId)}/approve`, {}, { credentials: 'include' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['engine-access-requests', engine?.id] })
      await qc.invalidateQueries({ queryKey: ['engine-members', engine?.id] })
      notify({ kind: 'success', title: 'Access request approved' })
    },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to approve request', subtitle: getUiErrorMessage(e, 'Failed to approve request') }),
  })

  const denyRequestM = useMutation({
    mutationFn: (requestId: string) => apiClient.post<void>(`/engines-api/engines/${encodeURIComponent(engine!.id)}/access-requests/${encodeURIComponent(requestId)}/deny`, {}, { credentials: 'include' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['engine-access-requests', engine?.id] })
      notify({ kind: 'success', title: 'Access request denied' })
    },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to deny request', subtitle: getUiErrorMessage(e, 'Failed to deny request') }),
  })

  const resolvedInviteCapabilities = memberCapabilitiesQ.data || { ssoRequired: false, emailConfigured: true }
  const localLoginDisabled = Boolean(resolvedInviteCapabilities.ssoRequired)
  const emailConfigured = Boolean(resolvedInviteCapabilities.emailConfigured)
  const inviteDeliveryOptions = getInvitationDeliveryOptions(resolvedInviteCapabilities)
  const noInviteDeliveryOptions = inviteDeliveryOptions.length === 0
  const canAssignDelegate = Boolean(canManage && engine?.myRole === 'owner')
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

  const submitAddMember = async () => {
    if (!isMemberEmailValid) {
      setMemberError('Please enter a valid email address')
      return
    }

    if (memberLookupMode === 'existing-member') {
      setMemberError('This user already has access to this engine')
      return
    }

    if (memberRole === 'delegate') {
      if (!canAssignDelegate) {
        setMemberError('Only the engine owner can assign a delegate')
        return
      }
      if (memberLookupMode !== 'direct-add') {
        setMemberError('Delegates must already exist as platform users before they can be assigned to an engine')
        return
      }
      assignDelegateM.mutate(normalizedMemberEmail)
      return
    }

    if (memberLookupMode === 'invite') {
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

    try {
      setMemberSubmitting(true)
      setMemberError('')
      setMemberReveal(null)

      const result = await apiClient.post<any>(`/engines-api/engines/${encodeURIComponent(engine!.id)}/members`, {
        email: normalizedMemberEmail,
        role: memberRole,
        ...(memberLookupMode === 'invite' ? { deliveryMethod: memberDeliveryMethod } : {}),
      }, { credentials: 'include' })

      await qc.invalidateQueries({ queryKey: ['engine-members', engine?.id] })

      if (result?.invited) {
        if (!result?.emailSent && result?.inviteUrl && result?.oneTimePassword) {
          setMemberReveal({
            email: normalizedMemberEmail,
            inviteUrl: String(result.inviteUrl),
            oneTimePassword: String(result.oneTimePassword),
          })
          return
        }

        notify({
          kind: 'success',
          title: 'Member invited',
          subtitle: result?.emailSent ? `Invitation emailed to ${normalizedMemberEmail}` : result?.emailError || 'Invitation created successfully.',
        })
      } else {
        notify({ kind: 'success', title: 'Member added' })
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
            {canManage && accessRequestsQ.data && accessRequestsQ.data.length > 0 && (
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
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{req.project?.name || req.projectId}</div>
                        <div style={{ fontSize: 12, color: 'var(--cds-text-secondary)' }}>
                          Requested by {req.requestedBy?.email || req.requestedById} • Role: {roleLabel(req.requestedRole)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
                        <Button kind="ghost" size="sm" hasIconOnly renderIcon={Close} iconDescription="Deny" onClick={() => denyRequestM.mutate(req.id)} disabled={denyRequestM.isPending} />
                        <Button kind="primary" size="sm" hasIconOnly renderIcon={Checkmark} iconDescription="Approve" onClick={() => approveRequestM.mutate(req.id)} disabled={approveRequestM.isPending} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {membersQ.isLoading ? (
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
                              {canManage && (
                                <Button kind="primary" size="sm" onClick={openAddMemberModal}>
                                  Add user
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
                                const isOwner = member?.role === 'owner'
                                const isDelegate = member?.role === 'delegate'
                                const canReissuePendingInvite = Boolean(
                                  canManage && pendingInvite && pendingInvite.deliveryMethod === 'manual' && pendingInvite.status !== 'onboarding'
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
                                          <Tag type={tagTypeForRole(member.role)} size="sm">{roleLabel(member.role)}</Tag>
                                        ) : null}
                                      </div>
                                    </TableCell>
                                    <TableCell style={{ textAlign: 'right' }}>
                                      {canReissuePendingInvite ? (
                                        <OverflowMenu size="sm" flipped wrapperClasses="eg-no-tooltip" iconDescription="">
                                          <OverflowMenuItem
                                            itemText={pendingInvite?.status === 'expired' ? 'Recreate invite link and OTP' : 'Regenerate invite link and OTP'}
                                            onClick={() => pendingInvite && reissuePendingInviteM.mutate(pendingInvite)}
                                          />
                                        </OverflowMenu>
                                      ) : canAssignDelegate && isDelegate && member ? (
                                        <OverflowMenu size="sm" flipped iconDescription="Options">
                                          <OverflowMenuItem itemText="Remove delegate" isDelete hasDivider onClick={() => assignDelegateM.mutate(null)} />
                                        </OverflowMenu>
                                      ) : canManage && member && !isOwner && !isDelegate ? (
                                        <OverflowMenu size="sm" flipped iconDescription="Options">
                                          {member.role === 'operator' ? (
                                            <OverflowMenuItem itemText="Change role to Deployer" onClick={() => updateMemberRoleM.mutate({ userId: member.userId, role: 'deployer' })} />
                                          ) : (
                                            <OverflowMenuItem itemText="Change role to Operator" onClick={() => updateMemberRoleM.mutate({ userId: member.userId, role: 'operator' })} />
                                          )}
                                          <OverflowMenuItem itemText="Remove" isDelete hasDivider onClick={() => deleteMemberMutation.mutate(member.userId)} />
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
        label="Engine members"
        title="Add user"
        submitText={memberRole === 'delegate' ? 'Save delegate' : memberLookupMode === 'invite' ? 'Create invitation' : 'Add member'}
        busy={memberSubmitting || assignDelegateM.isPending || reissuePendingInviteM.isPending}
        busyText={memberRole === 'delegate' ? 'Saving...' : memberLookupMode === 'invite' ? 'Creating...' : 'Adding...'}
        submitDisabled={
          !isMemberEmailValid ||
          memberLookupQ.isFetching ||
          memberCapabilitiesQ.isLoading ||
          memberLookupMode === 'existing-member' ||
          (memberRole === 'delegate' && memberLookupMode !== 'direct-add') ||
          (memberRole !== 'delegate' && memberLookupMode === 'invite' && noInviteDeliveryOptions)
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
            {memberRole === 'delegate' && (
              <InlineNotification
                kind="info"
                title="Existing user required"
                subtitle="Delegates must already exist as platform users before they can be assigned to an engine."
                lowContrast
                hideCloseButton
              />
            )}
            {memberRole !== 'delegate' && localLoginDisabled && (
              <InlineNotification
                kind="info"
                title="Local sign-in disabled"
                subtitle="One-time password invitations are unavailable while SSO is enforced. Email delivery remains available."
                lowContrast
                hideCloseButton
              />
            )}
            {memberRole !== 'delegate' && !emailConfigured && !localLoginDisabled && (
              <InlineNotification
                kind="info"
                title="Email delivery unavailable"
                subtitle="Email is not configured in Admin UI → Platform Settings → Email, so invitations must be delivered manually."
                lowContrast
                hideCloseButton
              />
            )}
            {memberRole !== 'delegate' && noInviteDeliveryOptions && (
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
                title="Existing user found"
                subtitle={memberRole === 'delegate' ? `${existingLookupUser.email} will be assigned as delegate.` : `${existingLookupUser.email} will be added directly without creating an invitation.`}
                lowContrast
                hideCloseButton
              />
            )}

            <div>
              <div style={{ fontSize: 'var(--cds-label-01-font-size, 0.75rem)', marginBottom: 'var(--spacing-3)' }}>Who</div>
              <UserLookupEmailField
                id="engine-member-user-search"
                labelText="Email"
                placeholder="Search existing users or enter an email"
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

            <div>
              <div style={{ fontSize: 'var(--cds-label-01-font-size, 0.75rem)', marginBottom: 'var(--spacing-3)' }}>Access</div>
              <Select
                id="engine-member-role"
                labelText="Role"
                value={memberRole}
                onChange={(e: any) => setMemberRole(e.target.value as AssignableEngineRole)}
                disabled={memberSubmitting || assignDelegateM.isPending}
              >
                {canAssignDelegate && <SelectItem value="delegate" text="Delegate" />}
                <SelectItem value="operator" text="Operator" />
                <SelectItem value="deployer" text="Deployer" />
              </Select>
              <div style={{ marginTop: 'var(--spacing-3)', fontSize: '0.75rem', color: 'var(--cds-text-secondary, #525252)' }}>
                {getEngineRoleDescription(memberRole)}
              </div>
            </div>

            {memberRole !== 'delegate' && memberLookupMode === 'invite' && !noInviteDeliveryOptions && (
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
    </>
  )
}
