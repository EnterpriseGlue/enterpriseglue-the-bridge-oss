/**
 * Deploy Dialog
 * Modal for configuring and executing Git deployment
 * Shows only engines connected to the project with their environment labels.
 * Engines tagged with CI/CD-only environments are shown but disabled.
 */

import React, { useState, useEffect } from 'react';
import {
  Modal,
  TextInput,
  TextArea,
  Select,
  SelectItem,
  Checkbox,
  InlineNotification,
  InlineLoading,
  Tag,
} from '@carbon/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import { useToast } from '../../../shared/notifications/ToastProvider';
import { useDeployment } from '../hooks/useDeployment';
import type { DeployRequest } from '../types/git';

interface ConnectedEngine {
  engineId: string;
  engineName: string;
  baseUrl?: string;
  environment?: { name: string; color: string } | null;
  health?: { status: string; latencyMs?: number } | null;
  manualDeployAllowed?: boolean;
}

interface EngineAccessData {
  accessedEngines: ConnectedEngine[];
  pendingRequests: any[];
  availableEngines: any[];
}

interface DeployDialogProps {
  projectId: string;
  fileIds?: string[];
  open: boolean;
  onClose: () => void;
  onDeploySuccess?: () => void;
}

interface ProjectGitConnection {
  connected?: boolean;
  hasToken?: boolean;
}

export default function DeployDialog({ projectId, fileIds, open, onClose, onDeploySuccess }: DeployDialogProps) {
  const deployment = useDeployment(projectId);
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const scopedFileIds = (fileIds || []).map(String).filter(Boolean);
  const isFileScopedDeploy = scopedFileIds.length > 0;

  const gitConnectionQuery = useQuery({
    queryKey: ['git-connection', projectId],
    queryFn: async () => {
      return apiClient
        .get<ProjectGitConnection>('/git-api/project-connection', { projectId })
        .catch(() => ({ connected: false, hasToken: false } as ProjectGitConnection));
    },
    enabled: open && !!projectId,
    staleTime: 30000,
  });

  const gitConnection = gitConnectionQuery.data as ProjectGitConnection | boolean | undefined;
  const gitConnected = typeof gitConnection === 'boolean'
    ? gitConnection
    : !!gitConnection?.connected;
  const gitHasToken = typeof gitConnection === 'boolean'
    ? gitConnection
    : (gitConnected ? gitConnection?.hasToken !== false : false);
  const canGitDeploy = !isFileScopedDeploy && gitConnected && gitHasToken;

  const engineDeployment = useMutation({
    mutationFn: async (params: { engineId: string; deploymentName: string; vcsCommitId?: string }) => {
      return apiClient.post(
        `/engines-api/engines/${encodeURIComponent(params.engineId)}/deployments`,
        {
          resources: isFileScopedDeploy ? { fileIds: scopedFileIds } : { projectId },
          options: {
            deploymentName: params.deploymentName,
            enableDuplicateFiltering: true,
            deployChangedOnly: true,
            vcsCommitId: params.vcsCommitId,
          },
        }
      );
    },
  });

  const saveVersion = useMutation({
    mutationFn: async (versionMessage: string) => {
      const body: { message: string; fileIds?: string[] } = { message: versionMessage }
      if (isFileScopedDeploy) {
        body.fileIds = scopedFileIds
      }
      return apiClient.post<{ commitId?: string }>(`/vcs-api/projects/${projectId}/commit`, body)
    },
  })

  const [versionTitle, setVersionTitle] = useState('');
  const [versionDescription, setVersionDescription] = useState('');
  const [selectedEngineId, setSelectedEngineId] = useState('');
  const [createTag, setCreateTag] = useState(false);
  const [tagName, setTagName] = useState('');

  // Fetch connected engines for this project
  const enginesQuery = useQuery({
    queryKey: ['project', 'engine-access', projectId],
    queryFn: () => apiClient.get<EngineAccessData>(
      `/starbase-api/projects/${projectId}/engine-access`
    ),
    staleTime: 30000,
    enabled: open && !!projectId,
  });

  const connectedEngines = enginesQuery.data?.accessedEngines || [];
  // Filter out legacy __env__ entries with no real engine
  const deployableEngines = connectedEngines.filter(e => e.engineId !== '__env__');
  const manualDeployEngines = deployableEngines.filter(e => e.manualDeployAllowed !== false);

  // Auto-select if only one deployable engine
  useEffect(() => {
    if (manualDeployEngines.length === 1 && !selectedEngineId) {
      setSelectedEngineId(manualDeployEngines[0].engineId);
    }
  }, [manualDeployEngines, selectedEngineId]);

  // Auto-generate tag name
  useEffect(() => {
    if (createTag && !tagName) {
      const timestamp = Date.now();
      setTagName(`deploy-${timestamp}`);
    }
  }, [createTag, tagName]);

  const selectedEngine = deployableEngines.find(e => e.engineId === selectedEngineId);

  const isPending = saveVersion.isPending || (canGitDeploy ? deployment.isPending : engineDeployment.isPending);
  const isError = saveVersion.isError || (canGitDeploy ? deployment.isError : engineDeployment.isError);
  const isSuccess = canGitDeploy ? deployment.isSuccess : engineDeployment.isSuccess;
  const activeError = saveVersion.error || (canGitDeploy ? deployment.error : engineDeployment.error);
  const trimmedVersionTitle = versionTitle.trim()
  const trimmedVersionDescription = versionDescription.trim()
  const semanticVersionMessage = trimmedVersionDescription
    ? `${trimmedVersionTitle} — ${trimmedVersionDescription}`
    : trimmedVersionTitle

  const handleDeploy = async () => {
    if (!trimmedVersionTitle || !selectedEngineId) {
      return;
    }

    try {
      const versionResult = await saveVersion.mutateAsync(semanticVersionMessage)
      const savedCommitId = versionResult?.commitId

      if (canGitDeploy) {
        const deployParams: Omit<DeployRequest, 'projectId'> = {
          message: trimmedVersionTitle,
          createTag,
          environment: selectedEngine?.environment?.name,
        };

        if (createTag && tagName) {
          deployParams.tagName = tagName;
        }

        await deployment.mutateAsync(deployParams);
      } else {
        await engineDeployment.mutateAsync({
          engineId: selectedEngineId,
          deploymentName: trimmedVersionTitle,
          vcsCommitId: savedCommitId,
        });
      }

      // Invalidate caches so versions panel and Mission Control button refresh immediately
      queryClient.invalidateQueries({ queryKey: ['vcs', 'commits', projectId] });
      queryClient.invalidateQueries({ queryKey: ['uncommitted-files', projectId] });
      queryClient.invalidateQueries({ queryKey: ['engine-deployments', projectId] });
      queryClient.invalidateQueries({ queryKey: ['engine-deployments', projectId, 'latest'] });

      onDeploySuccess?.();

      notify({
        kind: 'success',
        title: 'Deployment successful',
        subtitle: canGitDeploy
          ? 'Version saved, then committed and pushed to Git repository.'
          : isFileScopedDeploy
            ? 'Version saved, then current file deployed to engine.'
            : 'Version saved, then project files deployed to engine.',
      });

      onClose();
      setVersionTitle('');
      setVersionDescription('');
      setSelectedEngineId('');
      setCreateTag(false);
      setTagName('');
    } catch (error) {
      console.error('Deployment failed:', error);
    }
  };

  const isValid =
    trimmedVersionTitle.length > 0 &&
    trimmedVersionTitle.length <= 200 &&
    trimmedVersionDescription.length <= 500 &&
    versionDescription.trim().length <= 500 &&
    !!selectedEngineId;

  // Loading state
  if (enginesQuery.isLoading || gitConnectionQuery.isLoading) {
    return (
      <Modal open={open} onRequestClose={onClose} modalHeading="Deploy" secondaryButtonText="Cancel" size="sm" passiveModal>
        <InlineLoading description="Loading deployment options..." style={{ padding: 'var(--spacing-5)' }} />
      </Modal>
    );
  }

  // No engines connected
  if (deployableEngines.length === 0) {
    return (
      <Modal open={open} onRequestClose={onClose} modalHeading="Deploy" secondaryButtonText="Close" size="sm" passiveModal>
        <InlineNotification
          kind="info"
          title="No engine connected"
          subtitle="Connect an engine to this project before deploying. Go to Project Settings → Engine Access to connect an engine."
          lowContrast
          hideCloseButton
          style={{ margin: 'var(--spacing-3) 0' }}
        />
      </Modal>
    );
  }

  // All engines are CI/CD only
  if (manualDeployEngines.length === 0) {
    return (
      <Modal open={open} onRequestClose={onClose} modalHeading="Deploy" secondaryButtonText="Close" size="sm" passiveModal>
        <InlineNotification
          kind="warning"
          title="Manual deployment not available"
          subtitle="All connected engines are in CI/CD-only environments. Use your CI/CD pipeline to deploy."
          lowContrast
          hideCloseButton
          style={{ margin: 'var(--spacing-3) 0' }}
        />
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onRequestClose={onClose}
      onRequestSubmit={handleDeploy}
      modalHeading="Deploy"
      primaryButtonText={isPending ? 'Working...' : 'Save version & deploy'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={!isValid || isPending}
      size="sm"
    >
      <div style={{ marginBottom: 'var(--spacing-5)' }}>
        <TextInput
          id="semantic-version-title"
          labelText="Version title (required)"
          placeholder="Example: Invoice process v4"
          value={versionTitle}
          onChange={(e) => setVersionTitle(e.target.value)}
          invalid={versionTitle.length > 200}
          invalidText="Version title must be 200 characters or less"
          helperText="This title is used for both deployment name and commit title."
          maxLength={200}
          autoFocus
          disabled={isPending}
        />
      </div>

      <div style={{ marginBottom: 'var(--spacing-5)' }}>
        <TextArea
          id="semantic-version-description"
          labelText="Version details (optional)"
          placeholder="Example: approved routing + validation updates"
          value={versionDescription}
          onChange={(e) => setVersionDescription(e.target.value)}
          invalid={versionDescription.length > 500}
          invalidText="Version description must be 500 characters or less"
          helperText="A semantic version snapshot is always saved first before deployment."
          rows={3}
          maxLength={500}
          disabled={isPending}
        />
      </div>

      {!canGitDeploy && (
        <InlineNotification
          kind="info"
          title={gitConnected ? 'Git deploy unavailable' : 'Git not connected'}
          subtitle={isFileScopedDeploy
            ? 'This deployment will publish only the currently opened file to the selected engine.'
            : 'This deployment will publish project files directly from Starbase to the selected engine.'}
          lowContrast
          hideCloseButton
          style={{ marginBottom: 'var(--spacing-5)' }}
        />
      )}

      <div style={{ marginBottom: 'var(--spacing-5)' }}>
        <Select
          id="engine-target"
          labelText="Deploy to"
          value={selectedEngineId}
          onChange={(e) => setSelectedEngineId(e.target.value)}
          disabled={isPending}
        >
          <SelectItem value="" text="Select engine..." />
          {deployableEngines.map((engine) => {
            const canManualDeploy = engine.manualDeployAllowed !== false;
            const envLabel = engine.environment?.name || '';
            const label = envLabel
              ? `${engine.engineName} — ${envLabel}${!canManualDeploy ? ' (CI/CD only)' : ''}`
              : `${engine.engineName}${!canManualDeploy ? ' (CI/CD only)' : ''}`;
            return (
              <SelectItem
                key={engine.engineId}
                value={engine.engineId}
                text={label}
                disabled={!canManualDeploy}
              />
            );
          })}
        </Select>
        {selectedEngine?.environment && (
          <div style={{ marginTop: 'var(--spacing-2)', display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
            <Tag size="sm" style={{ backgroundColor: selectedEngine.environment.color, color: '#fff' }}>
              {selectedEngine.environment.name}
            </Tag>
            {selectedEngine.health?.status === 'connected' && (
              <Tag size="sm" type="green">Connected{selectedEngine.health.latencyMs != null ? ` ${selectedEngine.health.latencyMs}ms` : ''}</Tag>
            )}
            {selectedEngine.health?.status && selectedEngine.health.status !== 'connected' && (
              <Tag size="sm" type="red">Disconnected</Tag>
            )}
          </div>
        )}
      </div>

      {canGitDeploy && (
        <div style={{ marginBottom: 'var(--spacing-5)' }}>
          <Checkbox
            id="create-tag"
            labelText="Create deployment tag"
            checked={createTag}
            onChange={(_, { checked }) => setCreateTag(checked)}
            disabled={isPending}
          />
          <div style={{ marginTop: 'var(--spacing-2)', marginLeft: 'var(--spacing-7)', fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>
            Creates a Git tag on the deployed commit for easy reference.
          </div>
          {createTag && (
            <div style={{ marginTop: 'var(--spacing-3)', marginLeft: 'var(--spacing-7)' }}>
              <TextInput
                id="tag-name"
                labelText="Tag name"
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                placeholder="deploy-1732195200"
                size="sm"
                disabled={isPending}
              />
            </div>
          )}
        </div>
      )}

      {isPending && (
        <InlineLoading
          description={saveVersion.isPending ? 'Saving version snapshot...' : 'Deploying saved version...'}
          style={{ marginTop: 'var(--spacing-5)' }}
        />
      )}

      {isError && (() => {
        const parsed = parseApiError(activeError, 'Deployment failed');
        return (
          <InlineNotification
            kind="error"
            title="Deployment failed"
            subtitle={parsed.hint ? `${parsed.message} — ${parsed.hint}` : parsed.message}
            lowContrast
            hideCloseButton
            style={{ marginTop: 'var(--spacing-5)' }}
          />
        );
      })()}

      {isSuccess && (
        <InlineNotification
          kind="success"
          title="Deployed successfully"
          subtitle={canGitDeploy
            ? 'Version saved, committed, and pushed to Git repository'
            : isFileScopedDeploy
              ? 'Saved version published to the selected engine'
              : 'Saved version of project files published to the selected engine'}
          lowContrast
          hideCloseButton
          style={{ marginTop: 'var(--spacing-5)' }}
        />
      )}
    </Modal>
  );
}
