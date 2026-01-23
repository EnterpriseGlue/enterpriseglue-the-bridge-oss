import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  InlineNotification,
  TextInput,
  Dropdown,
  Tag,
  DataTable,
  DataTableSkeleton,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  OverflowMenu,
  OverflowMenuItem,
  ComposedModal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ComboBox,
  Loading,
} from '@carbon/react'
import { Add, Chip, UserMultiple, Close, Checkmark } from '@carbon/icons-react'
import FormModal from '../../../components/FormModal'
import { PageLayout, PageHeader, PAGE_GRADIENTS } from '../../../shared/components/PageLayout'
import { useModal } from '../../../shared/hooks/useModal'
import { useAuth } from '../../../shared/hooks/useAuth'
import { useToast } from '../../../shared/notifications/ToastProvider'
import { getUiErrorMessage } from '../../../shared/api/apiErrorUtils'
import { EngineAccessError, isEngineAccessError } from '../shared/components/EngineAccessError'
import InviteMemberModal from '../../../components/InviteMemberModal'
import { apiClient } from '../../../shared/api/client'
import EngineMembersModal from './components/EngineMembersModal'
 

// Types for engine members
type EngineRole = 'owner' | 'delegate' | 'deployer' | 'viewer'
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

const MEMBER_ROLE_OPTIONS: EngineRole[] = ['delegate']

function roleLabel(role: EngineRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1)
}

function tagTypeForRole(role: EngineRole): any {
  switch (role) {
    case 'owner': return 'red'
    case 'delegate': return 'magenta'
    case 'deployer': return 'blue'
    case 'viewer': return 'teal'
    default: return 'gray'
  }
}


export default function Engines() {
  const qc = useQueryClient()
  const engineModal = useModal<any>()
  const { user } = useAuth()
  const { notify } = useToast()
  const isAdmin = user?.platformRole === 'admin'
  const [editing, setEditing] = React.useState<any | null>(null)
  const [form, setForm] = React.useState<any>({ name: '', baseUrl: '', type: 'camunda7', authType: 'none', username: '', passwordEnc: '', environmentTagId: '' })
  const [searchQuery, setSearchQuery] = React.useState('')

  // Engine members panel state
  const [membersOpen, setMembersOpen] = React.useState(false)
  const [selectedEngine, setSelectedEngine] = React.useState<any | null>(null)
  const addMemberModal = useModal()
  const inviteMemberModal = useModal()
  const [memberEmail, setMemberEmail] = React.useState('')
  const [memberRole, setMemberRole] = React.useState<EngineRole>('viewer')
  const [memberUserSearch, setMemberUserSearch] = React.useState('')
  const [selectedMemberUser, setSelectedMemberUser] = React.useState<UserSearchItem | null>(null)

  const TYPE_ITEMS = React.useMemo(() => ([{ id: 'camunda7', label: 'Camunda 7' }, { id: 'operaton', label: 'Operaton (Camunda 7 fork)' }]), [])
  const AUTH_ITEMS = React.useMemo(() => ([{ id: 'none', label: 'None' }, { id: 'basic', label: 'Basic' }]), [])

  // Fetch environment tags (read-only, used by engine owners/delegates too)
  const envTagsQ = useQuery({ queryKey: ['engines', 'environment-tags'], queryFn: () => apiClient.get<any[]>('/engines-api/environment-tags', undefined, { credentials: 'include' }) })
  const envTags = envTagsQ.data
  const hasSingleTag = Array.isArray(envTags) && envTags.length === 1
  const hasMultipleTags = Array.isArray(envTags) && envTags.length > 1

  const listQ = useQuery({ queryKey: ['engines'], queryFn: () => apiClient.get<any[]>('/engines-api/engines', undefined, { credentials: 'include' }) })

  const createM = useMutation({
    mutationFn: (payload: any) => apiClient.post<any>('/engines-api/engines', payload, { credentials: 'include' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engines'] })
      qc.invalidateQueries({ queryKey: ['engines','active'] })
      engineModal.closeModal()
      notify({ kind: 'success', title: 'Engine created' })
    },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to create engine', subtitle: getUiErrorMessage(e, 'Failed to create') })
  })
  const updateM = useMutation({
    mutationFn: (payload: any) => apiClient.put<any>(`/engines-api/engines/${encodeURIComponent(editing.id)}`, payload, { credentials: 'include' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engines'] })
      qc.invalidateQueries({ queryKey: ['engines','active'] })
      engineModal.closeModal()
      setEditing(null)
      notify({ kind: 'success', title: 'Engine updated' })
    },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to update engine', subtitle: getUiErrorMessage(e, 'Failed to update') })
  })
  const deleteM = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/engines-api/engines/${encodeURIComponent(id)}`, { credentials: 'include' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engines'] })
      notify({ kind: 'success', title: 'Engine deleted' })
    },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to delete engine', subtitle: getUiErrorMessage(e, 'Failed to delete') })
  })
  const testM = useMutation({
    mutationFn: (id: string) => apiClient.post<any>(`/engines-api/engines/${encodeURIComponent(id)}/test`, {}, { credentials: 'include' }),
    onSuccess: (_data, id) => { qc.invalidateQueries({ queryKey: ['engines'] }); qc.invalidateQueries({ queryKey: ['engines','health', id] }) },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to test connection', subtitle: getUiErrorMessage(e, 'Failed to test connection') })
  })

  function openNew() {
    if (!isAdmin) {
      notify({ kind: 'error', title: 'Only platform admins can create engines' })
      return
    }
    setEditing(null)
    // Auto-assign environment tag if there's only one
    const autoTagId = hasSingleTag ? envTags![0].id : ''
    setForm({ name: '', baseUrl: '', type: 'camunda7', authType: 'none', username: '', passwordEnc: '', environmentTagId: autoTagId })
    engineModal.openModal()
  }
  function openEdit(row: any) {
    setEditing(row)
    setForm({
      name: row.name || '',
      baseUrl: row.baseUrl || '',
      type: row.type || 'camunda7',
      authType: row.authType || (row.username ? 'basic' : 'none'),
      username: row.username || '',
      passwordEnc: row.passwordEnc || '',
      environmentTagId: row.environmentTagId || '',
    })
    engineModal.openModal()
  }

  const rows = listQ.data || []
  const [isAddFirstEngineHover, setIsAddFirstEngineHover] = React.useState(false)

  function canManageEngine(engine: any): boolean {
    if (isAdmin) return true
    const r = String(engine?.myRole || '')
    return r === 'owner' || r === 'delegate' || r === 'admin'
  }

  // Engine members queries & mutations
  const membersQ = useQuery({
    queryKey: ['engine-members', selectedEngine?.id],
    queryFn: () => apiClient.get<EngineMember[]>(`/engines-api/engines/${selectedEngine?.id}/members`, undefined, { credentials: 'include' }),
    enabled: membersOpen && !!selectedEngine?.id,
  })

  const accessRequestsQ = useQuery({
    queryKey: ['engine-access-requests', selectedEngine?.id],
    queryFn: () => apiClient.get<AccessRequest[]>(`/engines-api/engines/${selectedEngine?.id}/access-requests`, undefined, { credentials: 'include' }),
    enabled: membersOpen && !!selectedEngine?.id && canManageEngine(selectedEngine),
  })

  const userSearchQ = useQuery({
    queryKey: ['admin', 'users', 'search', memberUserSearch.trim()],
    queryFn: () => {
      const q = memberUserSearch.trim()
      if (q.length < 2) return Promise.resolve([] as UserSearchItem[])
      return apiClient.get<UserSearchItem[]>(`/api/admin/users/search?q=${encodeURIComponent(q)}`, undefined, { credentials: 'include' })
    },
    enabled: addMemberModal.isOpen && memberUserSearch.trim().length >= 2,
    staleTime: 30 * 1000,
  })

  const addMemberM = useMutation({
    mutationFn: (data: { email: string; role: EngineRole }) =>
      apiClient.post<any>(`/engines-api/engines/${selectedEngine?.id}/members`, data, { credentials: 'include' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engine-members', selectedEngine?.id] })
      addMemberModal.closeModal()
      setMemberEmail('')
      setMemberRole('viewer')
      setMemberUserSearch('')
      setSelectedMemberUser(null)
      notify({ kind: 'success', title: 'Member added successfully' })
    },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to add member', subtitle: getUiErrorMessage(e, 'Failed to add member') }),
  })

  const removeMemberM = useMutation({
    mutationFn: (userId: string) =>
      apiClient.delete(`/engines-api/engines/${selectedEngine?.id}/members/${userId}`, { credentials: 'include' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engine-members', selectedEngine?.id] })
      notify({ kind: 'success', title: 'Member removed' })
    },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to remove member', subtitle: getUiErrorMessage(e, 'Failed to remove member') }),
  })

  const updateMemberRoleM = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: EngineRole }) =>
      apiClient.patch<void>(`/engines-api/engines/${selectedEngine?.id}/members/${userId}`, { role }, { credentials: 'include' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engine-members', selectedEngine?.id] })
      notify({ kind: 'success', title: 'Role updated' })
    },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to update role', subtitle: getUiErrorMessage(e, 'Failed to update role') }),
  })

  const approveRequestM = useMutation({
    mutationFn: (requestId: string) =>
      apiClient.post<void>(`/engines-api/engines/${selectedEngine?.id}/access-requests/${requestId}/approve`, {}, { credentials: 'include' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engine-access-requests', selectedEngine?.id] })
      qc.invalidateQueries({ queryKey: ['engine-members', selectedEngine?.id] })
      notify({ kind: 'success', title: 'Access request approved' })
    },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to approve request', subtitle: getUiErrorMessage(e, 'Failed to approve request') }),
  })

  const denyRequestM = useMutation({
    mutationFn: (requestId: string) =>
      apiClient.post<void>(`/engines-api/engines/${selectedEngine?.id}/access-requests/${requestId}/deny`, {}, { credentials: 'include' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engine-access-requests', selectedEngine?.id] })
      notify({ kind: 'success', title: 'Access request denied' })
    },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to deny request', subtitle: getUiErrorMessage(e, 'Failed to deny request') }),
  })

  function openMembersPanel(engine: any) {
    setSelectedEngine(engine)
    setMembersOpen(true)
  }

  function closeMembersPanel() {
    setMembersOpen(false)
    setSelectedEngine(null)
  }

  function submitAddMember() {
    if (!memberEmail.trim()) return
    addMemberM.mutate({ email: memberEmail.trim(), role: memberRole })
  }

  const tableHeaders = React.useMemo(
    () => [
      { key: 'name', header: 'Name' },
      { key: 'baseUrl', header: 'Base URL' },
      { key: 'type', header: 'Type' },
      { key: 'environment', header: 'Environment' },
      { key: 'health', header: 'Health' },
      { key: 'version', header: 'Version' },
      { key: 'actions', header: '' },
    ],
    []
  )

  const visibleEngines = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((e: any) => {
      const envTagName = Array.isArray(envTags)
        ? (envTags.find((t) => t.id === e.environmentTagId)?.name || '')
        : ''
      const hay = [
        String(e?.name || ''),
        String(e?.baseUrl || ''),
        String(e?.type || ''),
        String(envTagName || ''),
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [rows, searchQuery, envTags])

  return (
    <PageLayout style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)', background: 'var(--color-bg-primary)', minHeight: '100vh' }}>
      <PageHeader
        icon={Chip}
        title="Engines"
        subtitle="Manage workflow engine connections and monitor their health"
        gradient={PAGE_GRADIENTS.blue}
      />

      {/* Access Error State */}
      {listQ.isError && (() => {
        const accessErr = isEngineAccessError(listQ.error)
        if (accessErr) {
          return <EngineAccessError status={accessErr.status} message={accessErr.message} />
        }
        return (
          <InlineNotification
            lowContrast
            kind="error"
            title="Failed to load engines"
            subtitle={(listQ.error as any)?.message || 'Unknown error'}
          />
        )
      })()}

      {/* Loading State */}
      {listQ.isLoading && (
        <TableContainer>
          <TableToolbar>
            <TableToolbarContent>
              <TableToolbarSearch
                persistent
                onChange={(e: any) => setSearchQuery(e.target.value)}
                value={searchQuery}
                placeholder="Search engines"
              />
              {isAdmin && (
                <Button kind="primary" renderIcon={Add} onClick={openNew}>
                  Add engine
                </Button>
              )}
            </TableToolbarContent>
          </TableToolbar>
          <DataTableSkeleton
            showToolbar={false}
            showHeader
            headers={tableHeaders}
            rowCount={8}
            columnCount={tableHeaders.length}
          />
        </TableContainer>
      )}

      {/* Empty State */}
      {!listQ.isLoading && rows.length === 0 && (
        <div style={{ 
          background: 'var(--color-bg-secondary)', 
          border: '2px dashed var(--color-border-primary)', 
          borderRadius: '8px', 
          padding: 'var(--spacing-8)', 
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--spacing-3)'
        }}>
          <Chip size={48} style={{ color: 'var(--color-text-tertiary)' }} />
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--color-text-primary)' }}>No engines configured</h3>
            <p style={{ margin: '8px 0 0 0', fontSize: '14px', color: 'var(--color-text-secondary)', maxWidth: '400px' }}>
              Get started by adding your first workflow engine connection
            </p>
          </div>
          <Button 
            kind="secondary" 
            size="md"
            style={isAddFirstEngineHover ? { backgroundColor: '#474747', cursor: 'pointer' } : undefined}
            onMouseEnter={() => setIsAddFirstEngineHover(true)}
            onMouseLeave={() => setIsAddFirstEngineHover(false)}
            renderIcon={Add} 
            onClick={openNew}
          >
            {isAdmin ? 'Add your first engine' : 'No engines configured'}
          </Button>
        </div>
      )}

      {/* Engines List */}
      {!listQ.isLoading && rows.length > 0 && (
        <TableContainer>
          <DataTable
            rows={visibleEngines.map((e: any) => {
              const envTag = Array.isArray(envTags) ? envTags.find((t) => t.id === e.environmentTagId) : null
              return {
                id: e.id,
                name: e.name || '—',
                baseUrl: e.baseUrl || '—',
                type: e.type || 'camunda7',
                environment: envTag?.name || '—',
                health: '',
                version: '',
                actions: '',
              }
            })}
            headers={tableHeaders}
          >
            {({ rows: tableRows, headers, getHeaderProps, getRowProps, getTableProps, getToolbarProps }) => (
              <>
                <TableToolbar {...getToolbarProps()}>
                  <TableToolbarContent>
                    <TableToolbarSearch
                      persistent
                      onChange={(e: any) => setSearchQuery(e.target.value)}
                      value={searchQuery}
                      placeholder="Search engines"
                    />
                    {isAdmin && (
                      <Button kind="primary" renderIcon={Add} onClick={openNew}>
                        Add engine
                      </Button>
                    )}
                  </TableToolbarContent>
                </TableToolbar>
                <Table {...getTableProps()} size="md" useZebraStyles>
                  <TableHead>
                    <TableRow>
                      {headers.map((header) => (
                        <TableHeader
                          {...getHeaderProps({ header })}
                          style={
                            header.key === 'actions'
                              ? { width: 48, textAlign: 'right' }
                              : undefined
                          }
                        >
                          {header.header}
                        </TableHeader>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tableRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={headers.length}>No engines match this search.</TableCell>
                      </TableRow>
                    )}
                    {tableRows.map((row) => {
                      const engine = rows.find((e: any) => e.id === row.id)
                      const canManage = !!engine && canManageEngine(engine)

                      return (
                        <TableRow {...getRowProps({ row })}>
                          {row.cells.map((cell) => {
                            const key = cell.info.header

                            if (key === 'baseUrl') {
                              const url = engine?.baseUrl
                              const safeHref = (() => {
                                if (typeof url !== 'string') return null
                                const raw = url.trim()
                                if (!raw) return null
                                if (raw.startsWith('//')) return null
                                try {
                                  const u = new URL(raw, window.location.origin)
                                  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
                                  return u.toString()
                                } catch {
                                  return null
                                }
                              })()
                              return (
                                <TableCell key={cell.id}>
                                  {safeHref ? (
                                    <a
                                      href={safeHref}
                                      target="_blank"
                                      rel="noreferrer"
                                      style={{ color: 'var(--color-primary)', textDecoration: 'none' }}
                                    >
                                      {safeHref}
                                    </a>
                                  ) : url ? (
                                    <span>{String(url)}</span>
                                  ) : (
                                    '—'
                                  )}
                                </TableCell>
                              )
                            }

                            if (key === 'environment') {
                              const envTag = Array.isArray(envTags)
                                ? envTags.find((t) => t.id === engine?.environmentTagId)
                                : null
                              return (
                                <TableCell key={cell.id}>
                                  {envTag ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <div
                                        style={{
                                          width: 8,
                                          height: 8,
                                          borderRadius: '50%',
                                          background: envTag.color,
                                        }}
                                      />
                                      <span style={{ fontSize: '13px' }}>{envTag.name}</span>
                                    </div>
                                  ) : (
                                    '—'
                                  )}
                                </TableCell>
                              )
                            }

                            if (key === 'health') {
                              const id = row.id
                              return (
                                <TableCell key={cell.id}>
                                  <EngineHealthBadge engineId={id} version={engine?.version} />
                                </TableCell>
                              )
                            }

                            if (key === 'version') {
                              const id = row.id
                              return (
                                <TableCell key={cell.id}>
                                  <EngineVersionCell engineId={id} initialVersion={engine?.version} />
                                </TableCell>
                              )
                            }

                            if (key === 'actions') {
                              return (
                                <TableCell key={cell.id} onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
                                  <OverflowMenu size="sm" flipped wrapperClasses="eg-no-tooltip" iconDescription="Options">
                                    {canManage && (
                                      <OverflowMenuItem
                                        itemText="Edit"
                                        onClick={() => openEdit(engine)}
                                      />
                                    )}
                                    {canManage && (
                                      <OverflowMenuItem itemText="Test connection" onClick={() => testM.mutate(row.id)} />
                                    )}
                                    <OverflowMenuItem
                                      itemText="Manage members"
                                      onClick={() => openMembersPanel(engine)}
                                    />
                                    {canManage && (
                                      <OverflowMenuItem
                                        itemText="Delete"
                                        isDelete
                                        hasDivider
                                        onClick={() => deleteM.mutate(row.id)}
                                      />
                                    )}
                                  </OverflowMenu>
                                </TableCell>
                              )
                            }

                            return <TableCell key={cell.id}>{cell.value}</TableCell>
                          })}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </>
            )}
          </DataTable>
        </TableContainer>
      )}

      {/* Engine Members Panel - Using extracted component */}
      <EngineMembersModal
        open={membersOpen}
        engine={selectedEngine}
        canManage={selectedEngine ? canManageEngine(selectedEngine) : false}
        onClose={closeMembersPanel}
      />

      <FormModal
        open={engineModal.isOpen}
        onClose={() => {
          engineModal.closeModal()
          setEditing(null)
        }}
        onSubmit={() => {
          const payload: any = { ...form }
          if (payload.authType !== 'basic') {
            payload.username = undefined
            payload.passwordEnc = undefined
          }
          if (editing) updateM.mutate(payload)
          else createM.mutate(payload)
        }}
        title={editing ? 'Edit engine' : 'Add engine'}
        submitText={editing ? 'Save' : 'Create'}
        busy={createM.isPending || updateM.isPending}
        submitDisabled={!form.name || !form.baseUrl}
        size="lg"
      >
        <TextInput
          id="eng-name"
          labelText="Name"
          value={form.name}
          onChange={(e) => setForm((f: any) => ({ ...f, name: (e.target as any).value }))}
          disabled={createM.isPending || updateM.isPending}
        />
        <TextInput
          id="eng-url"
          labelText="Base URL"
          placeholder="http://localhost:8080/engine-rest"
          value={form.baseUrl}
          onChange={(e) => setForm((f: any) => ({ ...f, baseUrl: (e.target as any).value }))}
          disabled={createM.isPending || updateM.isPending}
        />
        <Dropdown
          id="eng-type"
          titleText="Type"
          label="Select type"
          items={TYPE_ITEMS}
          itemToString={(it: any) => it ? it.label : ''}
          selectedItem={TYPE_ITEMS.find(i => i.id === form.type)}
          onChange={({ selectedItem }: any) => setForm((f: any) => ({ ...f, type: selectedItem?.id }))}
          disabled={createM.isPending || updateM.isPending}
        />
        <Dropdown
          id="eng-auth"
          titleText="Auth"
          label="Select auth"
          items={AUTH_ITEMS}
          itemToString={(it: any) => it ? it.label : ''}
          selectedItem={AUTH_ITEMS.find(i => i.id === form.authType)}
          onChange={({ selectedItem }: any) => setForm((f: any) => ({ ...f, authType: selectedItem?.id }))}
          disabled={createM.isPending || updateM.isPending}
        />
        {/* Environment Tag - only show dropdown if multiple tags exist */}
        {hasMultipleTags && (
          <Dropdown
            id="eng-env"
            titleText="Environment"
            label="Select environment"
            items={envTags!.map(t => ({ id: t.id, label: t.name, color: t.color }))}
            itemToString={(it: any) => it ? it.label : ''}
            selectedItem={envTags!.map(t => ({ id: t.id, label: t.name, color: t.color })).find(i => i.id === form.environmentTagId)}
            onChange={({ selectedItem }: any) => setForm((f: any) => ({ ...f, environmentTagId: selectedItem?.id || '' }))}
            disabled={createM.isPending || updateM.isPending || (editing && editing.environmentLocked)}
          />
        )}
        {/* Show read-only environment info when single tag */}
        {hasSingleTag && (
          <div style={{ marginBottom: 'var(--spacing-4)' }}>
            <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>
              Environment
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', padding: '8px 0' }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: envTags![0].color }} />
              <span style={{ fontSize: '14px' }}>{envTags![0].name}</span>
              <Tag type="gray" size="sm">Auto-assigned</Tag>
            </div>
          </div>
        )}
        {form.authType === 'basic' && (
          <>
            <TextInput
              id="eng-user"
              labelText="Username"
              value={form.username}
              onChange={(e) => setForm((f: any) => ({ ...f, username: (e.target as any).value }))}
              disabled={createM.isPending || updateM.isPending}
            />
            <TextInput
              id="eng-pass"
              type="password"
              labelText="Password"
              value={form.passwordEnc}
              onChange={(e) => setForm((f: any) => ({ ...f, passwordEnc: (e.target as any).value }))}
              disabled={createM.isPending || updateM.isPending}
            />
          </>
        )}
      </FormModal>
    </PageLayout>
  )
}

function EngineHealthBadge({ engineId, version }: { engineId: string; version?: string | null }) {
  const q = useQuery({ queryKey: ['engines','health', engineId], queryFn: () => apiClient.get<any | null>(`/engines-api/engines/${encodeURIComponent(engineId)}/health`, undefined, { credentials: 'include' }) })
  const h = q.data
  const status = h?.status || 'unknown'
  const label = status === 'connected' ? 'Connected' : (status === 'disconnected' ? 'Disconnected' : 'Unknown')
  const type = status === 'connected' ? 'green' : (status === 'disconnected' ? 'red' : 'cool-gray')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
      <Tag type={type as any}>{label}</Tag>
      {typeof h?.latencyMs === 'number' && <span style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)' }}>{h.latencyMs} ms</span>}
    </div>
  )
}

function EngineVersionCell({ engineId, initialVersion }: { engineId: string; initialVersion?: string | null }) {
  const q = useQuery({ queryKey: ['engines','health', engineId], queryFn: () => apiClient.get<any | null>(`/engines-api/engines/${encodeURIComponent(engineId)}/health`, undefined, { credentials: 'include' }) })
  const v = initialVersion || q.data?.version
  return <span style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)' }}>{v ? `v${v}` : '—'}</span>
}
