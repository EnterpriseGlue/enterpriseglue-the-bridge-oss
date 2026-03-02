import React, { useEffect, useState } from 'react'
import {
  Button,
  Checkbox,
  InlineNotification,
  NumberInput,
  Select,
  SelectItem,
  TextInput,
  Tile,
  Toggle,
} from '@carbon/react'
import { PlatformGrid, PlatformRow, PlatformCol } from './PlatformGrid'
import type { PlatformSettings } from '../../../api/platform-admin'
import { parseApiError } from '../../../shared/api/apiErrorUtils'

type Scope = 'processDetails' | 'history' | 'logs' | 'errors' | 'audit'
type Provider = 'presidio' | 'gcp_dlp' | 'aws_comprehend' | 'azure_pii'

const ALL_SCOPES: Scope[] = ['processDetails', 'history', 'logs', 'errors', 'audit']

interface PiiRedactionSettingsSectionProps {
  settings: PlatformSettings | undefined
  saving: boolean
  onSave: (updates: Partial<PlatformSettings>) => Promise<void>
}

export function PiiRedactionSettingsSection({ settings, saving, onSave }: PiiRedactionSettingsSectionProps) {
  const [piiRegexEnabled, setPiiRegexEnabled] = useState(false)
  const [piiExternalProviderEnabled, setPiiExternalProviderEnabled] = useState(false)
  const [piiExternalProviderType, setPiiExternalProviderType] = useState<Provider | ''>('')
  const [piiExternalProviderEndpoint, setPiiExternalProviderEndpoint] = useState('')
  const [piiExternalProviderAuthHeader, setPiiExternalProviderAuthHeader] = useState('')
  const [piiExternalProviderAuthToken, setPiiExternalProviderAuthToken] = useState('')
  const [clearExternalToken, setClearExternalToken] = useState(false)
  const [piiExternalProviderProjectId, setPiiExternalProviderProjectId] = useState('')
  const [piiExternalProviderRegion, setPiiExternalProviderRegion] = useState('')
  const [piiRedactionStyle, setPiiRedactionStyle] = useState('<TYPE>')
  const [piiMaxPayloadSizeBytes, setPiiMaxPayloadSizeBytes] = useState(262144)
  const [selectedScopes, setSelectedScopes] = useState<Scope[]>([...ALL_SCOPES])
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const showProviderProjectId = piiExternalProviderType === 'gcp_dlp'
  const showProviderRegion = piiExternalProviderType === 'gcp_dlp' || piiExternalProviderType === 'aws_comprehend' || piiExternalProviderType === 'azure_pii'

  useEffect(() => {
    if (!settings) return
    setPiiRegexEnabled(Boolean(settings.piiRegexEnabled))
    setPiiExternalProviderEnabled(Boolean(settings.piiExternalProviderEnabled))
    setPiiExternalProviderType((settings.piiExternalProviderType as Provider | null) || '')
    setPiiExternalProviderEndpoint(String(settings.piiExternalProviderEndpoint || ''))
    setPiiExternalProviderAuthHeader(String(settings.piiExternalProviderAuthHeader || ''))
    setPiiExternalProviderAuthToken('')
    setClearExternalToken(false)
    setPiiExternalProviderProjectId(String(settings.piiExternalProviderProjectId || ''))
    setPiiExternalProviderRegion(String(settings.piiExternalProviderRegion || ''))
    setPiiRedactionStyle(String(settings.piiRedactionStyle || '<TYPE>'))
    setPiiMaxPayloadSizeBytes(Number(settings.piiMaxPayloadSizeBytes || 262144))
    const scopes = (Array.isArray(settings.piiScopes) ? settings.piiScopes : []) as Scope[]
    setSelectedScopes(scopes.length ? scopes : [...ALL_SCOPES])
  }, [settings])

  const toggleScope = (scope: Scope, checked: boolean) => {
    setSelectedScopes((prev) => {
      if (checked) return Array.from(new Set([...prev, scope])) as Scope[]
      return prev.filter((s) => s !== scope)
    })
  }

  const handleSave = async () => {
    setSaveError(null)
    setSaveSuccess(false)

    if (piiExternalProviderEnabled && !piiExternalProviderType) {
      setSaveError('Select an external provider type before saving.')
      return
    }

    if (piiExternalProviderEnabled && !piiExternalProviderEndpoint.trim()) {
      setSaveError('Provider endpoint is required when external provider is enabled.')
      return
    }

    if (selectedScopes.length === 0) {
      setSaveError('Select at least one redaction scope.')
      return
    }

    const payload: Partial<PlatformSettings> = {
      piiRegexEnabled,
      piiExternalProviderEnabled,
      piiExternalProviderType: piiExternalProviderEnabled ? (piiExternalProviderType || null) : null,
      piiExternalProviderEndpoint: piiExternalProviderEndpoint.trim() || null,
      piiExternalProviderAuthHeader: piiExternalProviderAuthHeader.trim() || null,
      piiExternalProviderProjectId: piiExternalProviderProjectId.trim() || null,
      piiExternalProviderRegion: piiExternalProviderRegion.trim() || null,
      piiRedactionStyle: piiRedactionStyle.trim() || '<TYPE>',
      piiScopes: selectedScopes,
      piiMaxPayloadSizeBytes: Math.max(1, Math.floor(Number(piiMaxPayloadSizeBytes) || 262144)),
    }

    if (clearExternalToken) {
      payload.piiExternalProviderAuthToken = null
    } else if (piiExternalProviderAuthToken.trim()) {
      payload.piiExternalProviderAuthToken = piiExternalProviderAuthToken.trim()
    }

    try {
      await onSave(payload)
      setSaveSuccess(true)
      setPiiExternalProviderAuthToken('')
      setClearExternalToken(false)
    } catch (error: any) {
      const parsed = parseApiError(error, 'Failed to save PII settings')
      setSaveError(parsed.message)
    }
  }

  return (
    <PlatformGrid style={{ paddingInline: 0 }}>
      <PlatformRow>
        <PlatformCol sm={4} md={8} lg={16} style={{ marginInlineStart: 0, marginInlineEnd: 0 }}>
          <Tile>
            <h3 style={{ margin: '0 0 var(--spacing-2) 0', fontSize: '16px', fontWeight: 600 }}>PII Redaction</h3>
            <p style={{ margin: '0 0 var(--spacing-4) 0', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
              Configure backend redaction for process details, history, logs, errors, and audit data.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', maxWidth: 820 }}>
              {saveError && (
                <InlineNotification kind="error" title="Failed to save" subtitle={saveError} onCloseButtonClick={() => setSaveError(null)} />
              )}
              {saveSuccess && (
                <InlineNotification kind="success" title="Saved" subtitle="PII redaction settings updated." onCloseButtonClick={() => setSaveSuccess(false)} />
              )}

              <Toggle
                id="pii-regex-enabled"
                labelText="Enable regex redaction"
                labelA="Off"
                labelB="On"
                toggled={piiRegexEnabled}
                onToggle={(checked) => setPiiRegexEnabled(checked)}
                disabled={saving}
              />

              <Toggle
                id="pii-external-enabled"
                labelText="Enable external PII provider"
                labelA="Off"
                labelB="On"
                toggled={piiExternalProviderEnabled}
                onToggle={(checked) => setPiiExternalProviderEnabled(checked)}
                disabled={saving}
              />

              <Select
                id="pii-provider-type"
                labelText="Provider"
                value={piiExternalProviderType}
                onChange={(e) => setPiiExternalProviderType((e.target.value || '') as Provider | '')}
                disabled={saving || !piiExternalProviderEnabled}
              >
                <SelectItem value="" text="Select provider" />
                <SelectItem value="presidio" text="Presidio" />
                <SelectItem value="gcp_dlp" text="Google Cloud DLP" />
                <SelectItem value="aws_comprehend" text="AWS Comprehend" />
                <SelectItem value="azure_pii" text="Azure AI Language (PII)" />
              </Select>

              <TextInput
                id="pii-provider-endpoint"
                labelText="Provider endpoint"
                value={piiExternalProviderEndpoint}
                onChange={(e) => setPiiExternalProviderEndpoint(e.target.value)}
                placeholder="https://..."
                disabled={saving || !piiExternalProviderEnabled}
              />

              <TextInput
                id="pii-provider-auth-header"
                labelText="Auth header name (optional)"
                value={piiExternalProviderAuthHeader}
                onChange={(e) => setPiiExternalProviderAuthHeader(e.target.value)}
                placeholder="Authorization"
                disabled={saving || !piiExternalProviderEnabled}
              />

              <TextInput
                id="pii-provider-auth-token"
                type="password"
                labelText="Auth token (leave empty to keep current)"
                value={piiExternalProviderAuthToken}
                onChange={(e) => {
                  setPiiExternalProviderAuthToken(e.target.value)
                  if (e.target.value.trim()) setClearExternalToken(false)
                }}
                placeholder="••••••••"
                disabled={saving || !piiExternalProviderEnabled}
              />

              <Checkbox
                id="pii-provider-clear-token"
                labelText="Clear currently stored auth token"
                checked={clearExternalToken}
                onChange={(_, { checked }) => {
                  setClearExternalToken(checked)
                  if (checked) setPiiExternalProviderAuthToken('')
                }}
                disabled={saving || !piiExternalProviderEnabled}
              />

              {showProviderProjectId && (
                <TextInput
                  id="pii-provider-project-id"
                  labelText="Project ID"
                  value={piiExternalProviderProjectId}
                  onChange={(e) => setPiiExternalProviderProjectId(e.target.value)}
                  placeholder="gcp-project-id"
                  disabled={saving || !piiExternalProviderEnabled}
                />
              )}

              {showProviderRegion && (
                <TextInput
                  id="pii-provider-region"
                  labelText="Region"
                  value={piiExternalProviderRegion}
                  onChange={(e) => setPiiExternalProviderRegion(e.target.value)}
                  placeholder="us-central1"
                  disabled={saving || !piiExternalProviderEnabled}
                />
              )}

              <TextInput
                id="pii-redaction-style"
                labelText="Redaction style"
                value={piiRedactionStyle}
                onChange={(e) => setPiiRedactionStyle(e.target.value)}
                placeholder="<TYPE>"
                helperText="Use <TYPE> placeholder to inject the detected entity type."
                disabled={saving}
              />

              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: 'var(--spacing-2)' }}>Scopes</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)' }}>
                  {ALL_SCOPES.map((scope) => (
                    <Checkbox
                      key={scope}
                      id={`pii-scope-${scope}`}
                      labelText={scope}
                      checked={selectedScopes.includes(scope)}
                      onChange={(_, { checked }) => toggleScope(scope, checked)}
                      disabled={saving}
                    />
                  ))}
                </div>
              </div>

              <NumberInput
                id="pii-max-payload"
                label="Max payload size (bytes)"
                min={1}
                value={piiMaxPayloadSizeBytes}
                onChange={(e, data) => {
                  const fromData = Number((data as any)?.value)
                  const fromInput = Number((e?.target as HTMLInputElement)?.value)
                  const value = Number.isFinite(fromData) ? fromData : fromInput
                  if (Number.isFinite(value)) setPiiMaxPayloadSizeBytes(value)
                }}
                disabled={saving}
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button kind="primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save PII Settings'}
                </Button>
              </div>
            </div>
          </Tile>
        </PlatformCol>
      </PlatformRow>
    </PlatformGrid>
  )
}
