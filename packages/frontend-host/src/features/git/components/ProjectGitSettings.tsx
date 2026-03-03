import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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

interface GitConnectionInfo {
  connected: boolean
  providerId?: string
  repositoryName?: string
  namespace?: string
  defaultBranch?: string
  remoteUrl?: string
  hasToken?: boolean
  lastValidatedAt?: number | null
  tokenScopeHint?: string | null
  connectedByUserId?: string | null
  lastSyncAt?: number | null
}

interface ProjectGitSettingsProps {
  projectId: string
  open: boolean
  onClose: () => void
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

export function ProjectGitSettings({ projectId, open, onClose }: ProjectGitSettingsProps) {
  const queryClient = useQueryClient()

  // Form state
  const [providerId, setProviderId] = useState('github')
  const [repoName, setRepoName] = useState('')
  const [namespace, setNamespace] = useState('')
  const [branch, setBranch] = useState('main')
  const [token, setToken] = useState('')
  const [updateToken, setUpdateToken] = useState('')
  const [showUpdateToken, setShowUpdateToken] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch connection status
  const connectionQ = useQuery({
    queryKey: ['git-connection', projectId],
    queryFn: () => apiClient.get<GitConnectionInfo>('/git-api/project-connection', { projectId }),
    enabled: open && !!projectId,
  })

  const conn = connectionQ.data

  // Reset form when opening
  useEffect(() => {
    if (open) {
      setToken('')
      setUpdateToken('')
      setShowUpdateToken(false)
      setError(null)
    }
  }, [open])

  // Connect mutation
  const connectMutation = useMutation({
    mutationFn: (data: { projectId: string; providerId: string; repositoryName: string; namespace?: string; defaultBranch: string; token: string }) =>
      apiClient.post('/git-api/project-connection', data),
    onSuccess: () => {
      setError(null)
      setToken('')
      queryClient.invalidateQueries({ queryKey: ['git-connection', projectId] })
    },
    onError: (err: any) => {
      const parsed = parseApiError(err)
      setError(parsed.message || 'Failed to connect')
    },
  })

  // Update token mutation
  const updateTokenMutation = useMutation({
    mutationFn: (data: { projectId: string; token: string }) =>
      apiClient.put('/git-api/project-connection/token', data),
    onSuccess: () => {
      setError(null)
      setUpdateToken('')
      setShowUpdateToken(false)
      queryClient.invalidateQueries({ queryKey: ['git-connection', projectId] })
    },
    onError: (err: any) => {
      const parsed = parseApiError(err)
      setError(parsed.message || 'Failed to update token')
    },
  })

  // Disconnect mutation
  const disconnectMutation = useMutation({
    mutationFn: () => apiClient.delete('/git-api/project-connection', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId }),
    }),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['git-connection', projectId] })
    },
    onError: (err: any) => {
      const parsed = parseApiError(err)
      setError(parsed.message || 'Failed to disconnect')
    },
  })

  const handleConnect = () => {
    if (!repoName.trim() || !token.trim()) return
    setError(null)
    connectMutation.mutate({
      projectId,
      providerId,
      repositoryName: repoName.trim(),
      namespace: namespace.trim() || undefined,
      defaultBranch: branch.trim() || 'main',
      token: token.trim(),
    })
  }

  const handleUpdateToken = () => {
    if (!updateToken.trim()) return
    setError(null)
    updateTokenMutation.mutate({ projectId, token: updateToken.trim() })
  }

  const handleDisconnect = () => {
    if (!confirm('Disconnect this project from Git? The repository will not be deleted.')) return
    disconnectMutation.mutate()
  }

  const isConnected = conn?.connected
  const isBusy = connectMutation.isPending || updateTokenMutation.isPending || disconnectMutation.isPending

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
      onRequestClose={onClose}
      modalHeading="Git Connection"
      passiveModal
      size="md"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', paddingTop: 'var(--spacing-3)' }}>
        {connectionQ.isLoading && <InlineLoading description="Loading connection status..." />}

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

        {/* Connected state */}
        {isConnected && conn && (
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
                  <Button size="sm" onClick={handleUpdateToken} disabled={!updateToken.trim() || isBusy}>
                    {updateTokenMutation.isPending ? 'Validating...' : 'Test & Save'}
                  </Button>
                  <Button size="sm" kind="ghost" onClick={() => { setShowUpdateToken(false); setUpdateToken('') }}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 'var(--spacing-3)' }}>
                <Button size="sm" kind="tertiary" renderIcon={Renew} onClick={() => setShowUpdateToken(true)}>
                  Update Token
                </Button>
                <Button size="sm" kind="danger--ghost" renderIcon={TrashCan} onClick={handleDisconnect} disabled={isBusy}>
                  Disconnect
                </Button>
              </div>
            )}
          </>
        )}

        {/* Not connected state */}
        {!connectionQ.isLoading && !isConnected && (
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
              size="md"
            />

            <div style={{ display: 'flex', gap: 'var(--spacing-3)' }}>
              <TextInput
                id="git-namespace"
                labelText="Owner / Namespace"
                value={namespace}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNamespace(e.target.value)}
                placeholder="e.g. my-org"
                style={{ flex: 1 }}
              />
              <TextInput
                id="git-repo"
                labelText="Repository name"
                value={repoName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRepoName(e.target.value)}
                placeholder="e.g. my-project"
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
            />

            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--spacing-3)' }}>
              <TextInput
                id="git-token"
                labelText="Service Token (PAT)"
                type="password"
                value={token}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToken(e.target.value)}
                placeholder="ghp_... or glpat-..."
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
              disabled={!repoName.trim() || !token.trim() || isBusy}
            >
              {connectMutation.isPending ? 'Validating & Connecting...' : 'Test & Connect'}
            </Button>
          </>
        )}
      </div>
    </Modal>
  )
}
