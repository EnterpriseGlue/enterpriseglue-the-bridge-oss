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
  Select,
  SelectItem,
  Checkbox,
  InlineNotification,
  InlineLoading,
  Tag,
} from '@carbon/react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
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
  open: boolean;
  onClose: () => void;
}

export default function DeployDialog({ projectId, open, onClose }: DeployDialogProps) {
  const deployment = useDeployment(projectId);

  const [message, setMessage] = useState('Deploy: Feature implementation');
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

  const handleDeploy = async () => {
    if (!message.trim() || !selectedEngineId) {
      return;
    }

    const deployParams: Omit<DeployRequest, 'projectId'> = {
      message: message.trim(),
      createTag,
      environment: selectedEngine?.environment?.name,
    };

    if (createTag && tagName) {
      deployParams.tagName = tagName;
    }

    try {
      await deployment.mutateAsync(deployParams);
      onClose();
      setMessage('');
      setSelectedEngineId('');
      setCreateTag(false);
      setTagName('');
    } catch (error) {
      console.error('Deployment failed:', error);
    }
  };

  const isValid = message.trim().length > 0 && message.trim().length <= 500 && !!selectedEngineId;

  // Loading state
  if (enginesQuery.isLoading) {
    return (
      <Modal open={open} onRequestClose={onClose} modalHeading="Deploy" secondaryButtonText="Cancel" size="sm" passiveModal>
        <InlineLoading description="Loading connected engines..." style={{ padding: 'var(--spacing-5)' }} />
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
      primaryButtonText={deployment.isPending ? 'Deploying...' : 'Deploy'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={!isValid || deployment.isPending}
      size="sm"
    >
      <div style={{ marginBottom: 'var(--spacing-5)' }}>
        <TextInput
          id="commit-message"
          labelText="Commit Message"
          placeholder="Deploy: Feature implementation"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          invalid={message.length > 500}
          invalidText="Message must be 500 characters or less"
          helperText="Describe what changes you're deploying"
          maxLength={500}
          autoFocus
          disabled={deployment.isPending}
        />
      </div>

      <div style={{ marginBottom: 'var(--spacing-5)' }}>
        <Select
          id="engine-target"
          labelText="Deploy to"
          value={selectedEngineId}
          onChange={(e) => setSelectedEngineId(e.target.value)}
          disabled={deployment.isPending}
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

      <div style={{ marginBottom: 'var(--spacing-5)' }}>
        <Checkbox
          id="create-tag"
          labelText="Create deployment tag"
          checked={createTag}
          onChange={(_, { checked }) => setCreateTag(checked)}
          disabled={deployment.isPending}
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
              disabled={deployment.isPending}
            />
          </div>
        )}
      </div>

      {deployment.isPending && (
        <InlineLoading
          description="Deploying to engine..."
          style={{ marginTop: 'var(--spacing-5)' }}
        />
      )}

      {deployment.isError && (() => {
        const parsed = parseApiError(deployment.error, 'Deployment failed');
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

      {deployment.isSuccess && (
        <InlineNotification
          kind="success"
          title="Deployed successfully"
          subtitle={`Committed and pushed to Git repository`}
          lowContrast
          hideCloseButton
          style={{ marginTop: 'var(--spacing-5)' }}
        />
      )}
    </Modal>
  );
}
