/**
 * Engine Members Modal
 * Manages engine members, delegates, and access requests
 */

import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Tag,
  ComposedModal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ComboBox,
  TextInput,
  Loading,
} from '@carbon/react'
import { Add, Close, Checkmark } from '@carbon/icons-react'
import { useModal } from '../../../../shared/hooks/useModal'
import InviteMemberModal from '../../../../components/InviteMemberModal'
import { apiClient } from '../../../../shared/api/client'

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

interface EngineMembersModalProps {
  open: boolean
  engine: { id: string; name: string; ownerId?: string } | null
  canManage: boolean
  onClose: () => void
}

function roleLabel(role: EngineRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1)
}

export default function EngineMembersModal({ open, engine, canManage, onClose }: EngineMembersModalProps) {
  const qc = useQueryClient()
  const addMemberModal = useModal()
  const inviteMemberModal = useModal()
  
  const [memberEmail, setMemberEmail] = React.useState('')
  const [memberUserSearch, setMemberUserSearch] = React.useState('')
  const [selectedMemberUser, setSelectedMemberUser] = React.useState<UserSearchItem | null>(null)

  // Queries
  const membersQ = useQuery({
    queryKey: ['engine-members', engine?.id],
    queryFn: () => apiClient.get<EngineMember[]>(`/engines-api/engines/${encodeURIComponent(engine!.id)}/members`, undefined, { credentials: 'include' }),
    enabled: !!engine?.id && open,
  })

  const accessRequestsQ = useQuery({
    queryKey: ['engine-access-requests', engine?.id],
    queryFn: () => apiClient.get<AccessRequest[]>(`/engines-api/engines/${encodeURIComponent(engine!.id)}/access-requests`, undefined, { credentials: 'include' }),
    enabled: !!engine?.id && canManage && open,
  })

  const usersQ = useQuery({
    queryKey: ['engine-member-search', engine?.id, memberUserSearch],
    queryFn: async () => {
      if (!engine?.id || memberUserSearch.length < 2) return [] as UserSearchItem[]
      const data = await apiClient.get<UserSearchItem[]>(`/engines-api/engines/${encodeURIComponent(engine.id)}/members/search?query=${encodeURIComponent(memberUserSearch)}`, undefined, { credentials: 'include' })
      return data
    },
    enabled: !!engine?.id && memberUserSearch.length >= 2 && open,
  })

  // Mutations
  const deleteMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      await apiClient.delete(`/engines-api/engines/${encodeURIComponent(engine!.id)}/members/${encodeURIComponent(memberId)}`, { credentials: 'include' })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['engine-members', engine?.id] })
    },
  })

  const addMemberM = useMutation({
    mutationFn: (payload: { email: string; role: EngineRole }) =>
      apiClient.post<EngineMember>(`/engines-api/engines/${encodeURIComponent(engine!.id)}/members`, payload, { credentials: 'include' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engine-members', engine?.id] })
      addMemberModal.closeModal()
      setMemberEmail('')
      setSelectedMemberUser(null)
    },
  })

  const approveRequestM = useMutation({
    mutationFn: (requestId: string) =>
      apiClient.post<void>(`/engines-api/access-requests/${encodeURIComponent(requestId)}/approve`, {}, { credentials: 'include' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engine-access-requests', engine?.id] })
      qc.invalidateQueries({ queryKey: ['engine-members', engine?.id] })
    },
  })

  const accessRequestsMutation = useMutation({
    mutationFn: async ({ requestId, status }: { requestId: string; status: 'approved' | 'denied' }) => {
      await apiClient.post(`/engines-api/engines/access-requests/${encodeURIComponent(requestId)}`, { status }, { credentials: 'include' })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['engine-access-requests', engine?.id] })
    },
  })

  const submitAddMember = () => {
    if (!memberEmail.trim()) return
    addMemberM.mutate({ email: memberEmail.trim(), role: 'delegate' })
  }

  if (!open || !engine) return null

  return (
    <>
      <ComposedModal open size="lg" onClose={onClose}>
        <ModalHeader
          label={engine.name}
          title="Engine Members"
          closeModal={onClose}
        />
        <ModalBody style={{ paddingBottom: 'var(--spacing-6)' }}>
          {/* Owner/Delegate Info */}
          <div style={{ marginBottom: 'var(--spacing-5)' }}>
            <div style={{ fontSize: '12px', color: 'var(--cds-text-secondary)', marginBottom: 'var(--spacing-2)' }}>
              Ownership
            </div>
            <div style={{ display: 'flex', gap: 'var(--spacing-4)', flexWrap: 'wrap' }}>
              {engine.ownerId && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
                  <Tag type="red" size="sm">Owner</Tag>
                  <span style={{ fontSize: '13px' }}>
                    {membersQ.data?.find(m => m.role === 'owner')?.user?.email || engine.ownerId}
                  </span>
                </div>
              )}
              {membersQ.data?.filter(m => m.role === 'delegate').map(d => (
                <div key={d.userId} style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
                  <Tag type="magenta" size="sm">Delegate</Tag>
                  <span style={{ fontSize: '13px' }}>{d.user?.email || d.userId}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Access Requests */}
          {canManage && accessRequestsQ.data && accessRequestsQ.data.length > 0 && (
            <div style={{ marginBottom: 'var(--spacing-5)', padding: 'var(--spacing-4)', background: 'var(--cds-layer-02)', borderRadius: '8px' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: 'var(--spacing-3)', display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
                <span>Pending Access Requests</span>
                <Tag type="purple" size="sm">{accessRequestsQ.data.length}</Tag>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
                {accessRequestsQ.data.map(req => (
                  <div
                    key={req.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: 'var(--spacing-3)',
                      background: 'var(--cds-layer-01)',
                      borderRadius: '4px',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 500 }}>
                        {req.project?.name || req.projectId}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--cds-text-secondary)' }}>
                        Requested by {req.requestedBy?.email || req.requestedById} • Role: {roleLabel(req.requestedRole)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
                      <Button
                        kind="ghost"
                        size="sm"
                        hasIconOnly
                        renderIcon={Close}
                        iconDescription="Deny"
                        onClick={() => accessRequestsMutation.mutate({ requestId: req.id, status: 'denied' })}
                        disabled={accessRequestsMutation.isPending}
                      />
                      <Button
                        kind="primary"
                        size="sm"
                        hasIconOnly
                        renderIcon={Checkmark}
                        iconDescription="Approve"
                        onClick={() => approveRequestM.mutate(req.id)}
                        disabled={approveRequestM.isPending}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add Delegate / Invite */}
          {canManage && (
            <div style={{ marginBottom: 'var(--spacing-4)', display: 'flex', gap: 'var(--spacing-3)' }}>
              {membersQ.data?.filter(m => m.role === 'delegate').length === 0 && (
                <Button
                  kind="tertiary"
                  size="sm"
                  renderIcon={Add}
                  onClick={() => {
                    setMemberEmail('')
                    setMemberUserSearch('')
                    setSelectedMemberUser(null)
                    addMemberModal.openModal()
                  }}
                >
                  Add delegate
                </Button>
              )}
              <Button
                kind="ghost"
                size="sm"
                onClick={() => inviteMemberModal.openModal()}
              >
                Invite user
              </Button>
            </div>
          )}
          
          {canManage && membersQ.data?.filter(m => m.role === 'delegate').length === 0 && (
            <p style={{ fontSize: '12px', color: 'var(--cds-text-secondary)', marginBottom: 'var(--spacing-4)' }}>
              A delegate can manage this engine on your behalf (approve access requests, but cannot delete or transfer ownership).
            </p>
          )}

          {membersQ.isLoading && <Loading small withOverlay={false} />}
        </ModalBody>
      </ComposedModal>

      {/* Add Member Modal */}
      {addMemberModal.isOpen && (
        <ComposedModal open size="sm" onClose={() => addMemberModal.closeModal()}>
          <ModalHeader label="Engine management" title="Add delegate" closeModal={() => addMemberModal.closeModal()} />
          <ModalBody style={{ overflow: 'visible', paddingBottom: 'var(--spacing-6)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
              <ComboBox
                id="member-user-search"
                titleText="User"
                placeholder="Search existing users..."
                items={(Array.isArray(usersQ.data) ? usersQ.data : []) as any}
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
                onChange={(e: any) => {
                  const next = String(e.target.value || '')
                  setMemberEmail(next)
                  if (selectedMemberUser && next.trim() !== selectedMemberUser.email) {
                    setSelectedMemberUser(null)
                  }
                }}
              />
              <p style={{ fontSize: '12px', color: 'var(--cds-text-secondary)' }}>
                This user will be added as a <strong>Delegate</strong> and can manage this engine on your behalf.
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button kind="secondary" onClick={() => addMemberModal.closeModal()}>
              Cancel
            </Button>
            <Button
              kind="primary"
              disabled={!memberEmail.trim() || addMemberM.isPending}
              onClick={submitAddMember}
            >
              {addMemberM.isPending ? 'Adding...' : 'Add'}
            </Button>
          </ModalFooter>
        </ComposedModal>
      )}

      <InviteMemberModal
        open={inviteMemberModal.isOpen}
        onClose={() => inviteMemberModal.closeModal()}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['engine-members', engine?.id] })}
        resourceType="engine"
        resourceId={engine?.id}
        resourceName={engine?.name}
        availableRoles={[
          { id: 'operator', label: 'Operator' },
          { id: 'deployer', label: 'Deployer' },
        ]}
        defaultRole="operator"
      />
    </>
  )
}
