import React from 'react'
import {
  Button,
  InlineNotification,
  RadioButton,
  RadioButtonGroup,
  Select,
  SelectItem,
  TextInput,
} from '@carbon/react'
import { Checkmark, Link as LinkIcon } from '@carbon/icons-react'
import type { AuthMethod } from '../hooks/useOnlineProjectWizard'

export interface CreateOnlineProjectAuthSectionProps {
  providerId: string
  isLoading: boolean
  existingCredentials: { id: string; name?: string; providerUsername?: string }[]
  connectionMode: 'select' | 'new'
  selectedCredentialId: string
  handleSelectCredential: (value: string) => void
  isConnected: boolean
  connectedUser: string | null
  setConnectionMode: (value: 'select' | 'new') => void
  authMethod: AuthMethod
  setAuthMethod: (value: AuthMethod) => void
  supportsOAuth: boolean
  connectionName: string
  setConnectionName: (value: string) => void
  token: string
  setToken: (value: string) => void
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error'
  connectionError: string | null
  connectWithPAT: () => void
  connectWithOAuth: () => void
  navigate: (path: string) => void
  toTenantPath: (path: string) => string
  providerName?: string
}

export function CreateOnlineProjectAuthSection({
  providerId,
  isLoading,
  existingCredentials,
  connectionMode,
  selectedCredentialId,
  handleSelectCredential,
  isConnected,
  connectedUser,
  setConnectionMode,
  authMethod,
  setAuthMethod,
  supportsOAuth,
  connectionName,
  setConnectionName,
  token,
  setToken,
  connectionStatus,
  connectionError,
  connectWithPAT,
  connectWithOAuth,
  navigate,
  toTenantPath,
  providerName,
}: CreateOnlineProjectAuthSectionProps) {
  return (
    <div
      style={{
        padding: 'var(--spacing-4)',
        backgroundColor: 'var(--cds-layer-01)',
        borderRadius: '4px',
        border: '1px solid var(--cds-border-subtle-01)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-3)' }}>
        <div style={{ fontWeight: 500 }}>Authentication</div>
        {/* Git connections now managed per-project in Git Settings */}
      </div>

      {existingCredentials.length > 0 && connectionMode === 'select' ? (
        <>
          <Select
            id="account-select"
            labelText="Select Connection"
            value={selectedCredentialId}
            onChange={(e) => handleSelectCredential(e.target.value)}
            disabled={isLoading}
            style={{ marginBottom: 'var(--spacing-3)' }}
          >
            {existingCredentials.map((cred) => (
              <SelectItem
                key={cred.id}
                value={cred.id}
                text={cred.name || cred.providerUsername || 'Unknown Account'}
              />
            ))}
            <SelectItem value="new" text="+ Add new connection..." />
          </Select>

          {isConnected && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-2)',
                padding: 'var(--spacing-3)',
                backgroundColor: '#defbe6',
                color: '#0e6027',
                borderRadius: '4px',
              }}
            >
              <Checkmark size={16} style={{ color: '#0e6027' }} />
              <span>
                Using connection <strong>{connectedUser}</strong>
              </span>
            </div>
          )}
        </>
      ) : (
        <>
          {existingCredentials.length > 0 && (
            <Button
              kind="ghost"
              size="sm"
              onClick={() => {
                setConnectionMode('select')
                if (existingCredentials.length > 0) {
                  handleSelectCredential(existingCredentials[0].id)
                }
              }}
              style={{ marginBottom: 'var(--spacing-3)', padding: 0 }}
            >
              ← Back to saved accounts
            </Button>
          )}

          {supportsOAuth && (
            <RadioButtonGroup
              name="auth-method"
              valueSelected={authMethod}
              onChange={(value) => setAuthMethod(value as AuthMethod)}
              orientation="horizontal"
              style={{ marginBottom: 'var(--spacing-3)' }}
            >
              <RadioButton labelText="Personal Access Token" value="pat" />
              <RadioButton labelText="OAuth" value="oauth" />
            </RadioButtonGroup>
          )}

          {authMethod === 'pat' || !supportsOAuth ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
              <TextInput
                id="connection-name"
                labelText="Connection Name (Optional)"
                placeholder="e.g., Work GitHub, Personal"
                value={connectionName}
                onChange={(e) => setConnectionName(e.target.value)}
                disabled={isLoading}
                helperText="Give this connection a name to identify it later"
              />
              <div style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'flex-end' }}>
                <TextInput
                  id="token"
                  labelText="Personal Access Token"
                  type="password"
                  placeholder="ghp_xxxx..."
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  disabled={isLoading}
                  style={{ flex: 1 }}
                  invalid={connectionStatus === 'error'}
                  invalidText={connectionError || undefined}
                />
                <Button
                  kind="secondary"
                  size="md"
                  onClick={connectWithPAT}
                  disabled={!token.trim() || isLoading}
                  renderIcon={connectionStatus === 'connecting' ? undefined : LinkIcon}
                >
                  {connectionStatus === 'connecting' ? 'Connecting...' : 'Connect'}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              kind="secondary"
              onClick={connectWithOAuth}
              disabled={isLoading}
              renderIcon={LinkIcon}
            >
              {connectionStatus === 'connecting' ? 'Connecting...' : `Connect with ${providerName || 'Provider'}`}
            </Button>
          )}

          {connectionError && (
            <InlineNotification
              kind="error"
              title="Connection failed"
              subtitle={connectionError}
              lowContrast
              hideCloseButton
              style={{ marginTop: 'var(--spacing-3)' }}
            />
          )}
        </>
      )}
    </div>
  )
}
