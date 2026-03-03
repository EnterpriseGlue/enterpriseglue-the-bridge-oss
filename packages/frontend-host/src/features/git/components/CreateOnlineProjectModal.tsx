/**
 * Create Online Project Modal
 * Creates a new project with a remote Git repository
 * 
 * Flow:
 * 1. User selects provider and auth method (OAuth or PAT)
 * 2. User connects to provider (OAuth popup or enters PAT)
 * 3. User fills project details
 * 4. On Create: validate -> check duplicate -> create remote repo -> create local project
 */

import React from 'react';
import {
  Modal,
  TextInput,
  Select,
  SelectItem,
  InlineNotification,
  InlineLoading,
  Toggle,
} from '@carbon/react';
import { useOnlineProjectWizard } from '../hooks/useOnlineProjectWizard';
import { CreateOnlineProjectExistingConnectionPanel } from './CreateOnlineProjectExistingConnectionPanel';
import { CreateOnlineProjectAuthSection } from './CreateOnlineProjectAuthSection';
import { CreateOnlineProjectRepoModeFields } from './CreateOnlineProjectRepoModeFields';



interface CreateOnlineProjectModalProps {
  open: boolean;
  onClose: () => void;
  existingProjectId?: string;
  existingProjectName?: string;
}

export default function CreateOnlineProjectModal({ open, onClose, existingProjectId, existingProjectName }: CreateOnlineProjectModalProps) {
  const {
    navigate,
    toTenantPath,
    isExistingProject,
    isEditConnectedProject,
    existingRepo,
    projectName,
    setProjectName,
    importFromEngine,
    setImportFromEngine,
    selectedImportEngineId,
    setSelectedImportEngineId,
    importableEngines,
    importableEnginesQuery,
    canImportFromEngine,
    connectToGit,
    setConnectToGit,
    repoMode,
    setRepoMode,
    providerId,
    setProviderId,
    namespace,
    setNamespace,
    repositoryName,
    setRepositoryName,
    description,
    setDescription,
    isPrivate,
    setIsPrivate,
    existingRepos,
    loadingRepos,
    repoFetchError,
    selectedExistingRepoUrl,
    setSelectedExistingRepoUrl,
    customRepoUrl,
    setCustomRepoUrl,
    conflictStrategy,
    setConflictStrategy,
    connectionMode,
    setConnectionMode,
    selectedCredentialId,
    authMethod,
    setAuthMethod,
    token,
    setToken,
    connectionName,
    setConnectionName,
    connectionStatus,
    connectedUser,
    connectionError,
    existingCredentials,
    namespaces,
    loadingNamespaces,
    fieldErrors,
    setFieldErrors,
    generalError,
    providersQuery,
    selectedProvider,
    handleSelectCredential,
    connectWithPAT,
    connectWithOAuth,
    handleClose,
    handleSubmit,
    generateRemoteUrl,
    isConnected,
    isValid,
    isLoading,
    createMutation,
    initExistingMutation,
    createLocalMutation,
    cloneExistingMutation,
    cloneNewProjectMutation,
  } = useOnlineProjectWizard({
    open,
    onClose,
    existingProjectId,
    existingProjectName,
  });

  return (
    <Modal
      open={open}
      onRequestClose={handleClose}
      modalHeading={isEditConnectedProject ? 'Git Settings' : (isExistingProject ? 'Connect Project' : 'Create Project')}
      primaryButtonText={
        isEditConnectedProject
          ? 'Close'
          : (!connectToGit
          ? (isExistingProject ? 'Close' : 'Create Project')
          : (repoMode === 'new'
              ? (isExistingProject ? 'Create Repository & Connect' : 'Create Project & Repository')
              : 'Connect to Existing')
          )
      }
      secondaryButtonText="Cancel"
      onRequestSubmit={handleSubmit}
      primaryButtonDisabled={isLoading || !isValid}
      size="md"
    >
      <p style={{ marginBottom: 'var(--spacing-5)', color: 'var(--color-text-secondary)' }}>
        {isEditConnectedProject
          ? 'This project is already connected to Git. Use this screen to view the current repo settings and manage your Git credentials.'
          : (isExistingProject
            ? 'Connect this project to Git or keep it local.'
            : 'Create a new project, optionally connecting it to a Git repository.')}
      </p>
      
      <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
        {isEditConnectedProject && (
          <CreateOnlineProjectExistingConnectionPanel
            existingRepo={existingRepo}
            providerName={selectedProvider?.name}
          />
        )}

        {/* Project name (always shown for new projects) */}
        {!isExistingProject && (
          <TextInput
            id="project-name"
            labelText="Project Name *"
            placeholder="Order Management"
            value={projectName}
            onChange={(e) => {
              setProjectName(e.target.value);
              setFieldErrors(prev => ({ ...prev, projectName: '' }));
            }}
            disabled={isLoading}
            invalid={!!fieldErrors.projectName}
            invalidText={fieldErrors.projectName}
          />
        )}

        {!isExistingProject && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)' }}>
              <Toggle
                id="import-from-engine"
                labelText="Import latest BPMN/DMN from engine"
                labelA="Off"
                labelB="On"
                toggled={importFromEngine}
                onToggle={(checked) => {
                  setImportFromEngine(checked)
                  if (!checked) {
                    setSelectedImportEngineId('')
                  }
                }}
                disabled={isLoading || !canImportFromEngine}
              />
            </div>

            {importFromEngine && canImportFromEngine && (
              <Select
                id="import-engine"
                labelText="Source Engine *"
                value={selectedImportEngineId}
                onChange={(e) => {
                  setSelectedImportEngineId(e.target.value)
                  setFieldErrors(prev => ({ ...prev, importEngineId: '' }))
                }}
                disabled={isLoading || importableEnginesQuery.isLoading}
                invalid={!!fieldErrors.importEngineId}
                invalidText={fieldErrors.importEngineId}
              >
                <SelectItem value="" text={importableEnginesQuery.isLoading ? 'Loading engines...' : 'Select engine...'} />
                {importableEngines.map((engine) => (
                  <SelectItem
                    key={engine.id}
                    value={engine.id}
                    text={`${engine.name} (${engine.role})`}
                  />
                ))}
              </Select>
            )}

            {importFromEngine && canImportFromEngine && !importableEnginesQuery.isLoading && importableEngines.length === 0 && (
              <InlineNotification
                kind="info"
                title="No accessible engines"
                subtitle="You currently don't have an engine role that allows importing definitions."
                lowContrast
                hideCloseButton
              />
            )}

            {!canImportFromEngine && (
              <InlineNotification
                kind="info"
                title="Import unavailable"
                subtitle="Import from engine is only available when creating a new local project or a new repository project."
                lowContrast
                hideCloseButton
              />
            )}
          </>
        )}

        {/* Connect to Git toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)' }}>
          <Toggle
            id="connect-to-git"
            labelText="Connect to Git repository"
            labelA="Off"
            labelB="On"
            toggled={connectToGit}
            onToggle={(checked) => setConnectToGit(checked)}
          />
          {isExistingProject && (
            <span style={{ color: 'var(--cds-text-secondary)', fontSize: '12px' }}>
              Turn off to keep this project local only.
            </span>
          )}
        </div>

        {/* Git section */}
        {connectToGit && (
          <>
            {/* Provider Selection */}
            <Select
              id="provider"
              labelText="Git Provider *"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              disabled={isLoading || isEditConnectedProject}
            >
              <SelectItem value="" text="Select provider..." />
              {providersQuery.data?.map(provider => (
                <SelectItem key={provider.id} value={provider.id} text={provider.name} />
              ))}
            </Select>

            {/* Authentication Section */}
            {providerId && (
              <CreateOnlineProjectAuthSection
                providerId={providerId}
                isLoading={isLoading}
                existingCredentials={existingCredentials}
                connectionMode={connectionMode}
                selectedCredentialId={selectedCredentialId}
                handleSelectCredential={handleSelectCredential}
                isConnected={isConnected}
                connectedUser={connectedUser}
                setConnectionMode={setConnectionMode}
                authMethod={authMethod}
                setAuthMethod={setAuthMethod}
                supportsOAuth={!!selectedProvider?.supportsOAuth}
                connectionName={connectionName}
                setConnectionName={setConnectionName}
                token={token}
                setToken={setToken}
                connectionStatus={connectionStatus}
                connectionError={connectionError}
                connectWithPAT={connectWithPAT}
                connectWithOAuth={connectWithOAuth}
                navigate={navigate}
                toTenantPath={toTenantPath}
                providerName={selectedProvider?.name}
              />
            )}

            {/* Repo mode */}
            {isConnected && !isEditConnectedProject && (
              <CreateOnlineProjectRepoModeFields
                repoMode={repoMode}
                setRepoMode={setRepoMode}
                isConnected={isConnected}
                namespaces={namespaces}
                namespace={namespace}
                setNamespace={setNamespace}
                loadingNamespaces={loadingNamespaces}
                repositoryName={repositoryName}
                setRepositoryName={setRepositoryName}
                fieldErrors={fieldErrors}
                setFieldErrors={setFieldErrors}
                description={description}
                setDescription={setDescription}
                isPrivate={isPrivate}
                setIsPrivate={setIsPrivate}
                isLoading={isLoading}
                loadingRepos={loadingRepos}
                generateRemoteUrl={generateRemoteUrl}
                repoFetchError={repoFetchError}
                existingRepos={existingRepos}
                selectedExistingRepoUrl={selectedExistingRepoUrl}
                setSelectedExistingRepoUrl={setSelectedExistingRepoUrl}
                customRepoUrl={customRepoUrl}
                setCustomRepoUrl={setCustomRepoUrl}
                conflictStrategy={conflictStrategy}
                setConflictStrategy={setConflictStrategy}
              />
            )}
          </>
        )}

        {/* Loading State */}
        {(createMutation.isPending || initExistingMutation.isPending || createLocalMutation.isPending || cloneExistingMutation.isPending || cloneNewProjectMutation.isPending) && (
          <InlineLoading description="Creating repository and project..." />
        )}

        {/* General Error */}
        {generalError && (
          <InlineNotification
            kind="error"
            title="Failed to create project"
            subtitle={generalError}
            lowContrast
            hideCloseButton
          />
        )}
      </div>
    </Modal>
  );
}
