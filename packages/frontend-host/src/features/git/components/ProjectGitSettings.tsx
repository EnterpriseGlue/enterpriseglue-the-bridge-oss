import React, { useState, useEffect, useContext, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Modal,
  TextInput,
  Dropdown,
  Button,
  InlineNotification,
  InlineLoading,
  Tag,
  Tile,
  Toggletip,
  ToggletipButton,
  ToggletipContent,
} from '@carbon/react'
import { Information, ConnectionSignal, TrashCan, Renew } from '@carbon/icons-react'
import { apiClient } from '../../../shared/api/client'
import { parseApiError } from '../../../shared/api/apiErrorUtils'
import { ProjectPermission } from '../../../shared/auth/permissions'
import { AuthContext } from '../../../contexts/AuthContext'
import { evaluateActionSnapshot } from '../../../shared/auth/guards'
import {
  ProjectGitConnectionSchema,
  ProjectGitConnectionQuerySchema,
  ProjectGitConnectionRequestSchema,
  ProjectGitConnectionReceiptSchema,
  ProjectGitConnectionOperationReceiptSchema,
  UpdateProjectGitConnectionTokenRequestSchema,
  DisconnectProjectGitConnectionRequestSchema,
  type DisconnectProjectGitConnectionRequest,
  type ProjectGitConnectionRequest,
  type UpdateProjectGitConnectionTokenRequest,
} from '@enterpriseglue/shared/schemas/git/repository.js'

import { permissionSnapshotAuthorityKey } from '../../../contexts/authSessionPermissions'
import { getBrowserSessionRevision } from '../../../utils/browserSession'

interface ProjectGitSettingsProps {
  projectId: string
  open: boolean
  onClose: () => void
  canManageConnection?: boolean
  manageConnectionUnavailableReason?: string | null
}

const PROVIDER_OPTIONS = [
  { id: 'github', text: 'GitHub' },
  { id: 'gitlab', text: 'GitLab' },
  { id: 'bitbucket', text: 'Bitbucket' },
  { id: 'azure-devops', text: 'Azure DevOps' },
]

function TokenInfoPanel() {
  return (
    <div style={{ fontSize: '13px', lineHeight: 1.5, maxWidth: 400 }}>
      <p style={{ fontWeight: 600, marginBottom: 8 }}>How to create a service token:</p>
      <p style={{ marginBottom: 8 }}>
        <strong>GitHub (recommended):</strong> Go to{' '}
        <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noopener noreferrer">
          Fine-grained tokens
        </a>
        {' → '} Generate new token → Select the target repo → Set <em>Contents</em> to "Read and write".
      </p>
      <p style={{ marginBottom: 8 }}>
        <strong>GitLab:</strong> Project → Settings → Access Tokens → Create with <code>write_repository</code> scope.
      </p>
      <p style={{ marginBottom: 8 }}>
        <strong>Bitbucket:</strong> Personal settings → App passwords → Create with <em>Repositories: Write</em>.
      </p>
      <p style={{ marginBottom: 0 }}>
        <strong>Azure DevOps:</strong> User settings → Personal access tokens → <em>Code: Read & Write</em> scope.
      </p>
      <p style={{ marginTop: 8, color: 'var(--color-text-secondary)' }}>
        Tip: Use a service/bot account so the token isn't tied to a personal account.
      </p>
    </div>
  )
}

export function ProjectGitSettings(props: ProjectGitSettingsProps) {
  const auth = useContext(AuthContext)
  const authority = JSON.stringify([auth?.user?.session?.principal.id || auth?.user?.id || null,
    auth?.user?.session?.tenant.id || null, auth?.sessionRevision ?? null, permissionSnapshotAuthorityKey(auth?.permissions)])
  // Private inputs and pending UI belong to one project/open/authority lifetime.
  return <ProjectGitSettingsForm key={JSON.stringify([props.projectId, props.open, authority,
    props.canManageConnection, props.manageConnectionUnavailableReason])} {...props} authority={authority} />
}

function ProjectGitSettingsForm({
  projectId,
  open,
  onClose,
  canManageConnection = true,
  manageConnectionUnavailableReason,
  authority,
}: ProjectGitSettingsProps & { authority: string }) {
  const queryClient = useQueryClient()
  const authContext = useContext(AuthContext)
  const projectResource = { type: 'project' as const, id: projectId }
  const hasPermissionSnapshot = Boolean(authContext?.permissions)
  const readConnectionDecision = evaluateActionSnapshot(
    authContext?.permissions ?? null,
    'project.git.repositories.read',
    projectResource
  )
  const manageConnectionDecision = evaluateActionSnapshot(
    authContext?.permissions ?? null,
    'project.git.repositories.manage',
    projectResource
  )
  const readConnectionUnavailableReason = hasPermissionSnapshot && !readConnectionDecision.allowed
    ? readConnectionDecision.reason
    : null

  // Form state
  const [providerId, setProviderId] = useState('github')
  const [repoName, setRepoName] = useState('')
  const [namespace, setNamespace] = useState('')
  const [branch, setBranch] = useState('main')
  const [token, setToken] = useState('')
  const [updateToken, setUpdateToken] = useState('')
  const [showUpdateToken, setShowUpdateToken] = useState(false)
  const [error, setError] = useState<string | null>(null)
  type Operation = 'connect' | 'token' | 'disconnect'
  const [busy, setBusy] = useState<Operation | null>(null)
  const activeRef = useRef(false), mountedRef = useRef(true), closedRef = useRef(false), lifetimeRef = useRef(0)
  const renderedSession = useRef(getBrowserSessionRevision()).current
  const current = (lifetime: number) => mountedRef.current && !closedRef.current && lifetime === lifetimeRef.current && renderedSession === getBrowserSessionRevision()
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; lifetimeRef.current += 1 } }, [])

  // Fetch connection status
  const connectionQ = useQuery({
    queryKey: ['git-connection', projectId, authority],
    queryFn: async () => {
      // The query already owns its project/authority cache key. Remounting the
      // observer must not invalidate an otherwise current read in StrictMode.
      const query = ProjectGitConnectionQuerySchema.safeParse({ projectId })
      if (!query.success || renderedSession !== getBrowserSessionRevision()) throw new Error('Connection context changed; reopen settings')
      const raw = await apiClient.get('/git-api/project-connection', query.data)
      if (renderedSession !== getBrowserSessionRevision()) throw new Error('Connection context changed; reopen settings')
      const parsed = ProjectGitConnectionSchema.safeParse(raw)
      if (!parsed.success) throw new Error('Connection status was not verified')
      return parsed.data
    },
    enabled: open && !!projectId && !readConnectionUnavailableReason,
  })

  const conn = connectionQ.data
  const cleanManageConnectionUnavailableReason = hasPermissionSnapshot && !manageConnectionDecision.allowed
    ? manageConnectionDecision.reason
    : null
  const legacyManageConnectionUnavailableReason = manageConnectionUnavailableReason || (
    canManageConnection ? null : `Missing permission ${ProjectPermission.GIT_CONNECT}`
  )
  const gitConnectionUnavailableReason = cleanManageConnectionUnavailableReason || legacyManageConnectionUnavailableReason
  const canMutateConnection = !gitConnectionUnavailableReason

  const statusVerified = connectionQ.isSuccess && !!conn && !readConnectionUnavailableReason
  const isBusy = busy !== null
  const canConfirm = () => open && current(lifetimeRef.current) && !activeRef.current && statusVerified && canMutateConnection

  async function runOperation(kind: Operation, request: ProjectGitConnectionRequest | UpdateProjectGitConnectionTokenRequest | DisconnectProjectGitConnectionRequest) {
    if (!canConfirm()) return
    const lifetime = lifetimeRef.current
    const plan = (() => {
      if (kind === 'connect') {
        const parsed = ProjectGitConnectionRequestSchema.safeParse({ ...request })
        return parsed.success ? { kind: 'connect' as const, request: parsed.data } : null
      }
      if (kind === 'token') {
        const parsed = UpdateProjectGitConnectionTokenRequestSchema.safeParse({ ...request })
        return parsed.success ? { kind: 'token' as const, request: parsed.data } : null
      }
      const parsed = DisconnectProjectGitConnectionRequestSchema.safeParse({ ...request })
      return parsed.success ? { kind: 'disconnect' as const, request: parsed.data } : null
    })()
    if (!plan) { setError('Connection request was not verified'); return }
    const captured = plan.request
    const privateToken = plan.kind === 'disconnect' ? null : plan.request.token
    activeRef.current = true
    setBusy(kind); setError(null)
    try {
      let raw: unknown
      if (kind === 'connect') raw = await apiClient.post('/git-api/project-connection', captured)
      else if (kind === 'token') raw = await apiClient.put('/git-api/project-connection/token', captured)
      else raw = await apiClient.delete('/git-api/project-connection', {
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(captured),
      })
      if (!current(lifetime)) return
      if (plan.kind === 'connect') {
        const receipt = ProjectGitConnectionReceiptSchema.safeParse(raw)
        const expected = plan.request.namespace ? `${plan.request.namespace}/${plan.request.repositoryName}` : plan.request.repositoryName
        if (!receipt.success || receipt.data.repoFullName !== expected) throw new Error('Connection response was not verified')
      } else if (!ProjectGitConnectionOperationReceiptSchema.safeParse(raw).success) {
        throw new Error('Connection response was not verified')
      }
      setToken(''); setUpdateToken(''); setShowUpdateToken(false)
      // Refresh the consumers of this connection, not just the settings query.
      await Promise.all([
        ['git-connection', projectId], ['git', 'repository', projectId], ['git', 'repositories'],
        ['git', 'sync-status', projectId], ['starbase', 'projects'],
      ].map(queryKey => queryClient.invalidateQueries({ queryKey })))
    } catch (failure) {
      if (!current(lifetime)) return
      const message = parseApiError(failure, 'Git connection change failed').message
      setError(privateToken ? message.split(privateToken).join('[redacted]') : message)
    } finally {
      if (current(lifetime)) { activeRef.current = false; setBusy(null) }
    }
  }

  const handleConnect = () => {
    if (!canConfirm() || conn?.connected !== false || !repoName.trim() || !token.trim()) return
    void runOperation('connect', { projectId, providerId, repositoryName: repoName.trim(),
      namespace: namespace.trim() || undefined, defaultBranch: branch.trim() || 'main', token: token.trim() })
  }
  const handleUpdateToken = () => {
    if (!canConfirm() || conn?.connected !== true || !updateToken.trim()) return
    void runOperation('token', { projectId, token: updateToken.trim() })
  }
  const handleDisconnect = () => {
    if (!canConfirm() || conn?.connected !== true) return
    if (!confirm('Disconnect this project from Git? The repository will not be deleted.')) return
    void runOperation('disconnect', { projectId })
  }
  const handleClose = () => {
    closedRef.current = true; lifetimeRef.current += 1
    setToken(''); setUpdateToken(''); setRepoName(''); setNamespace(''); setBranch('main'); setError(null); setBusy(null)
    onClose()
  }

  const isConnected = conn?.connected

  // Token staleness: warn if lastValidatedAt is missing or older than 7 days
  const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000
  const isTokenStale = isConnected && conn?.lastValidatedAt
    ? (Date.now() - conn.lastValidatedAt) > STALE_THRESHOLD_MS
    : isConnected && !conn?.lastValidatedAt
  const tokenStatusColor = isTokenStale
    ? 'var(--cds-support-warning, #f1c21b)'
    : 'var(--cds-support-success, #24a148)'

  return (
    <Modal
      open={open}
      onRequestClose={handleClose}
      modalHeading="Git Connection"
      passiveModal
      size="md"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', paddingTop: 'var(--spacing-3)' }}>
        {connectionQ.isLoading && <InlineLoading description="Loading connection status..." />}
        {connectionQ.isError && <InlineNotification kind="error" title="Connection status unavailable"
          subtitle="Connection status was not verified" hideCloseButton lowContrast />}

        {error && (
          <InlineNotification
            kind="error"
            title="Error"
            subtitle={error}
            hideCloseButton
            lowContrast
          />
        )}

        {/* Token stale/expired warning */}
        {isConnected && isTokenStale && (
          <InlineNotification
            kind="warning"
            title="Token may be expired"
            subtitle="The service token hasn't been validated recently. Ask a project admin to update it."
            hideCloseButton
            lowContrast
          />
        )}

        {gitConnectionUnavailableReason && (
          <InlineNotification
            kind="info"
            title="Git connection changes unavailable"
            subtitle={gitConnectionUnavailableReason}
            hideCloseButton
            lowContrast
          />
        )}

        {readConnectionUnavailableReason && (
          <InlineNotification
            kind="info"
            title="Git connection status unavailable"
            subtitle={readConnectionUnavailableReason}
            hideCloseButton
            lowContrast
          />
        )}

        {/* Connected state */}
        {statusVerified && isConnected && conn && (
          <>
            <Tile>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)', marginBottom: 'var(--spacing-3)' }}>
                <ConnectionSignal size={20} style={{ color: tokenStatusColor }} />
                <span style={{ fontSize: '16px', fontWeight: 600 }}>Connected</span>
                <Tag type="green" size="sm">
                  {PROVIDER_OPTIONS.find(p => p.id === conn.providerId)?.text || conn.providerId}
                </Tag>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-3)', fontSize: '14px' }}>
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: 2 }}>Repository</div>
                  <div style={{ fontWeight: 500 }}>
                    {conn.namespace ? `${conn.namespace}/` : ''}{conn.repositoryName}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: 2 }}>Branch</div>
                  <div>{conn.defaultBranch}</div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: 2 }}>Token</div>
                  <div style={{ fontSize: '13px' }}>{conn.hasToken ? 'Configured' : 'Not set'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: 2 }}>Last validated</div>
                  <div>{conn.lastValidatedAt ? new Date(conn.lastValidatedAt).toLocaleString() : 'Never'}</div>
                </div>
                {conn.lastSyncAt && (
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: 2 }}>Last sync</div>
                    <div>{new Date(conn.lastSyncAt).toLocaleString()}</div>
                  </div>
                )}
              </div>
            </Tile>

            {/* Update Token */}
            {showUpdateToken ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--spacing-3)' }}>
                  <TextInput
                    id="update-token"
                    labelText="New Token"
                    type="password"
                    value={updateToken}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUpdateToken(e.target.value)}
                    placeholder="ghp_... or glpat-..."
                    disabled={!canMutateConnection || isBusy || closedRef.current}
                    style={{ flex: 1 }}
                  />
                  <Toggletip align="bottom">
                    <ToggletipButton label="Token setup guide">
                      <Information size={16} />
                    </ToggletipButton>
                    <ToggletipContent>
                      <TokenInfoPanel />
                    </ToggletipContent>
                  </Toggletip>
                </div>
                <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
                  <Button
                    size="sm"
                    onClick={handleUpdateToken}
                    disabled={!updateToken.trim() || isBusy || !canMutateConnection}
                    title={gitConnectionUnavailableReason ?? undefined}
                  >
                    {busy === 'token' ? 'Validating...' : 'Test & Save'}
                  </Button>
                  <Button size="sm" kind="ghost" disabled={isBusy} onClick={() => { setShowUpdateToken(false); setUpdateToken('') }}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 'var(--spacing-3)' }}>
                <Button
                  size="sm"
                  kind="tertiary"
                  renderIcon={Renew}
                  onClick={() => setShowUpdateToken(true)}
                  disabled={isBusy || !canMutateConnection}
                  title={gitConnectionUnavailableReason ?? undefined}
                >
                  Update Token
                </Button>
                <Button
                  size="sm"
                  kind="danger--ghost"
                  renderIcon={TrashCan}
                  onClick={handleDisconnect}
                  disabled={isBusy || !canMutateConnection}
                  title={gitConnectionUnavailableReason ?? undefined}
                >
                  Disconnect
                </Button>
              </div>
            )}
          </>
        )}

        {/* Not connected state */}
        {statusVerified && !isConnected && (
          <>
            <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', margin: 0 }}>
              Connect this project to a Git repository. A service token will be used for all push/pull operations — team members don't need their own GitHub account.
            </p>

            <Dropdown
              id="git-provider"
              titleText="Provider"
              label="Select provider"
              items={PROVIDER_OPTIONS}
              itemToString={(item: typeof PROVIDER_OPTIONS[number] | null) => item?.text || ''}
              selectedItem={PROVIDER_OPTIONS.find(p => p.id === providerId)}
              onChange={({ selectedItem }: any) => setProviderId(selectedItem?.id || 'github')}
              disabled={!canMutateConnection || isBusy || closedRef.current}
              size="md"
            />

            <div style={{ display: 'flex', gap: 'var(--spacing-3)' }}>
              <TextInput
                id="git-namespace"
                labelText="Owner / Namespace"
                value={namespace}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNamespace(e.target.value)}
                placeholder="e.g. my-org"
                disabled={!canMutateConnection || isBusy || closedRef.current}
                style={{ flex: 1 }}
              />
              <TextInput
                id="git-repo"
                labelText="Repository name"
                value={repoName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRepoName(e.target.value)}
                placeholder="e.g. my-project"
                disabled={!canMutateConnection || isBusy || closedRef.current}
                style={{ flex: 1 }}
                invalid={!repoName.trim() && repoName !== ''}
                invalidText="Required"
              />
            </div>

            <TextInput
              id="git-branch"
              labelText="Default branch"
              value={branch}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBranch(e.target.value)}
              placeholder="main"
              disabled={!canMutateConnection || isBusy || closedRef.current}
            />

            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--spacing-3)' }}>
              <TextInput
                id="git-token"
                labelText="Service Token (PAT)"
                type="password"
                value={token}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToken(e.target.value)}
                placeholder="ghp_... or glpat-..."
                disabled={!canMutateConnection || isBusy || closedRef.current}
                style={{ flex: 1 }}
                invalid={!token.trim() && token !== ''}
                invalidText="Required"
              />
              <Toggletip align="bottom">
                <ToggletipButton label="Token setup guide">
                  <Information size={16} />
                </ToggletipButton>
                <ToggletipContent>
                  <TokenInfoPanel />
                </ToggletipContent>
              </Toggletip>
            </div>

            <Button
              onClick={handleConnect}
              disabled={!repoName.trim() || !token.trim() || isBusy || !canMutateConnection}
              title={gitConnectionUnavailableReason ?? undefined}
            >
              {busy === 'connect' ? 'Validating & Connecting...' : 'Test & Connect'}
            </Button>
          </>
        )}
      </div>
    </Modal>
  )
}
