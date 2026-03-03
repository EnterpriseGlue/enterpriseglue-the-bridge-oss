import React from 'react'
import {
  InlineNotification,
  RadioButton,
  RadioButtonGroup,
  Select,
  SelectItem,
  TextArea,
  TextInput,
  Toggle,
} from '@carbon/react'

interface RepoModeFieldsProps {
  repoMode: 'new' | 'existing' | null
  setRepoMode: (value: 'new' | 'existing') => void
  isConnected: boolean
  namespaces: { name: string; type: 'user' | 'organization' }[]
  namespace: string
  setNamespace: (value: string) => void
  loadingNamespaces: boolean
  repositoryName: string
  setRepositoryName: (value: string) => void
  fieldErrors: Record<string, string>
  setFieldErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>
  description: string
  setDescription: (value: string) => void
  isPrivate: boolean
  setIsPrivate: (value: boolean) => void
  isLoading: boolean
  loadingRepos: boolean
  generateRemoteUrl: () => string
  repoFetchError: string | null
  existingRepos: { fullName: string; url: string }[]
  selectedExistingRepoUrl: string
  setSelectedExistingRepoUrl: (value: string) => void
  customRepoUrl: string
  setCustomRepoUrl: (value: string) => void
  conflictStrategy: 'preferRemote' | 'preferLocal'
  setConflictStrategy: (value: 'preferRemote' | 'preferLocal') => void
}

export function CreateOnlineProjectRepoModeFields({
  repoMode,
  setRepoMode,
  isConnected,
  namespaces,
  namespace,
  setNamespace,
  loadingNamespaces,
  repositoryName,
  setRepositoryName,
  fieldErrors,
  setFieldErrors,
  description,
  setDescription,
  isPrivate,
  setIsPrivate,
  isLoading,
  loadingRepos,
  generateRemoteUrl,
  repoFetchError,
  existingRepos,
  selectedExistingRepoUrl,
  setSelectedExistingRepoUrl,
  customRepoUrl,
  setCustomRepoUrl,
  conflictStrategy,
  setConflictStrategy,
}: RepoModeFieldsProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
      <RadioButtonGroup
        name="repo-mode"
        valueSelected={repoMode || ''}
        onChange={(value: string | number | undefined) => {
          if (!value) return
          setRepoMode(String(value) as 'new' | 'existing')
        }}
        orientation="horizontal"
      >
        <RadioButton labelText="Create new repository" value="new" />
        <RadioButton labelText="Connect to existing repository" value="existing" />
      </RadioButtonGroup>

      {repoMode === 'new' && (
        <>
          {namespaces.length > 0 ? (
            <Select
              id="namespace"
              labelText="Organization/Namespace"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              disabled={isLoading || loadingNamespaces}
              helperText="Select where to create the repository"
            >
              {namespaces.map((ns) => (
                <SelectItem
                  key={ns.name}
                  value={ns.name}
                  text={`${ns.name}${ns.type === 'user' ? ' (personal)' : ''}`}
                />
              ))}
            </Select>
          ) : (
            <TextInput
              id="namespace"
              labelText="Organization/Namespace (Optional)"
              placeholder={loadingNamespaces ? 'Loading...' : 'my-org'}
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              helperText={
                isConnected
                  ? 'Enter organization name or leave empty for personal account'
                  : 'Connect to load available namespaces'
              }
              disabled={isLoading || loadingNamespaces}
            />
          )}

          <TextInput
            id="repository-name"
            labelText="Repository Name *"
            placeholder="order-management-bpmn"
            value={repositoryName}
            onChange={(e) => {
              setRepositoryName(e.target.value)
              setFieldErrors((prev) => ({ ...prev, repositoryName: '' }))
            }}
            disabled={isLoading}
            invalid={!!fieldErrors.repositoryName}
            invalidText={fieldErrors.repositoryName}
          />

          <TextArea
            id="description"
            labelText="Description (Optional)"
            placeholder="Brief description of the project..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isLoading}
            rows={2}
          />

          <Toggle
            id="is-private"
            labelText="Repository Visibility"
            labelA="Public"
            labelB="Private"
            toggled={isPrivate}
            onToggle={(checked) => setIsPrivate(checked)}
            disabled={isLoading}
          />

          {repositoryName && (
            <div
              style={{
                padding: 'var(--spacing-3)',
                backgroundColor: 'var(--cds-layer-01)',
                borderRadius: '4px',
                border: '1px solid var(--cds-border-subtle-01)',
              }}
            >
              <div style={{ fontSize: '12px', color: 'var(--cds-text-secondary)', marginBottom: '4px' }}>
                Repository will be created at:
              </div>
              <code style={{ fontSize: '12px', color: 'var(--cds-text-primary)' }}>{generateRemoteUrl()}</code>
            </div>
          )}
        </>
      )}

      {repoMode === 'existing' && (
        <>
          {repoFetchError ? (
            <>
              <InlineNotification
                kind="warning"
                title="Could not load repositories"
                subtitle={repoFetchError}
                lowContrast
                hideCloseButton
              />
              <TextInput
                id="custom-repo-url"
                labelText="Enter repository URL"
                placeholder="https://github.com/org/repo.git"
                value={customRepoUrl}
                onChange={(e) => setCustomRepoUrl(e.target.value)}
                disabled={isLoading}
                helperText="Enter the full URL to your repository"
              />
            </>
          ) : (
            <Select
              id="existing-repo"
              labelText="Existing Repository"
              value={selectedExistingRepoUrl}
              onChange={(e) => {
                setSelectedExistingRepoUrl(e.target.value)
                if (e.target.value) {
                  setCustomRepoUrl('')
                }
              }}
              disabled={isLoading || loadingRepos}
            >
              <SelectItem value="" text={loadingRepos ? 'Loading repositories...' : 'Select repository...'} />
              {existingRepos.map((r) => (
                <SelectItem key={r.url} value={r.url} text={r.fullName} />
              ))}
            </Select>
          )}

          <RadioButtonGroup
            name="conflict-strategy"
            legendText="If files already exist"
            valueSelected={conflictStrategy}
            onChange={(value: string | number | undefined) => {
              if (!value) return
              setConflictStrategy(String(value) as 'preferRemote' | 'preferLocal')
            }}
            orientation="vertical"
          >
            <RadioButton labelText="Prefer Git repository (overwrite local)" value="preferRemote" />
            <RadioButton labelText="Prefer local project files" value="preferLocal" />
          </RadioButtonGroup>
        </>
      )}
    </div>
  )
}
