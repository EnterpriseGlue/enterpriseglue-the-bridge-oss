/**
 * Sync Modal
 * Handles push/pull operations with remote Git repository
 */

import React, { useState, useEffect } from 'react';
import {
  Modal,
  RadioButtonGroup,
  RadioButton,
  InlineNotification,
  InlineLoading,
  Button,
  Tag,
  TextArea,
} from '@carbon/react';
import { 
  CloudUpload, 
  CloudDownload, 
} from '@carbon/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiClient } from '../../../shared/api/client';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import { usePlatformSyncSettings } from '../../platform-admin/hooks/usePlatformSyncSettings';

interface SyncModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  onSuccess?: () => void;
}

type SyncDirection = 'push' | 'pull';

interface RepoInfo {
  id: string;
  providerId: string;
  remoteUrl: string;
  repositoryName: string;
  defaultBranch: string;
  lastSyncAt: number | null;
  lastCommitSha: string | null;
}

interface SyncStatus {
  hasLocalChanges: boolean;
  hasRemoteChanges: boolean;
  lastSyncAt: number | null;
  localCommitCount: number;
  remoteCommitCount: number;
}

export default function SyncModal({ 
  open, 
  onClose, 
  projectId, 
  projectName,
  onSuccess 
}: SyncModalProps) {
  const queryClient = useQueryClient();
  const nav = useNavigate();
  const { pathname } = useLocation();

  const tenantSlugMatch = pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null;
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : null;
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : '';
  const toTenantPath = (p: string) => (tenantSlug ? `${tenantPrefix}${p}` : p);

  const [direction, setDirection] = useState<SyncDirection>('push');
  const [commitMessage, setCommitMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Fetch platform settings to determine which sync options are enabled
  const { data: platformSettings } = usePlatformSyncSettings();
  const pushEnabled = platformSettings?.syncPushEnabled ?? true;
  const pullEnabled = platformSettings?.syncPullEnabled ?? false;
  const sharingEnabled = platformSettings?.gitProjectTokenSharingEnabled ?? false;

  // Auto-select first enabled option and reset message when modal opens
  useEffect(() => {
    if (open) {
      if (pushEnabled) setDirection('push');
      else if (pullEnabled) setDirection('pull');
      setCommitMessage('');
      setError(null);
    }
  }, [open, pushEnabled, pullEnabled]);

  // Fetch repository info
  const repoQuery = useQuery({
    queryKey: ['git', 'repository', projectId],
    queryFn: async () => {
      const repos = await apiClient.get<RepoInfo[]>('/git-api/repositories', { projectId });
      return repos.find((r: RepoInfo) => r) || null;
    },
    enabled: open,
  });

  const providerIdForTokenCheck = repoQuery.data?.providerId;
  const credentialValidQuery = useQuery({
    queryKey: ['git', 'credentials', 'valid', providerIdForTokenCheck],
    queryFn: async () => {
      return apiClient.get<{ valid: boolean }>(
        `/git-api/credentials/${providerIdForTokenCheck}/validate`
      ).catch(() => ({ valid: false }));
    },
    enabled: open && !sharingEnabled && !!providerIdForTokenCheck,
  });

  // Fetch sync status
  const statusQuery = useQuery({
    queryKey: ['git', 'sync-status', projectId],
    queryFn: async () => {
      return apiClient.get<SyncStatus>('/git-api/sync/status', { projectId }).catch(() => null);
    },
    enabled: open && !!repoQuery.data,
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      return apiClient.post('/git-api/sync', {
        projectId,
        direction,
        message: commitMessage.trim(),
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['git', 'deployments', projectId] });
      queryClient.invalidateQueries({ queryKey: ['git', 'deployments', 'recent'] });
      queryClient.invalidateQueries({ queryKey: ['git', 'repository', projectId] });
      queryClient.invalidateQueries({ queryKey: ['git', 'sync-status', projectId] });
      queryClient.invalidateQueries({ queryKey: ['vcs', 'commits', projectId] });
      queryClient.invalidateQueries({ queryKey: ['uncommitted-files', projectId] });
      queryClient.invalidateQueries({ queryKey: ['uncommitted-files', projectId, 'draft'] });
      onSuccess?.();
      onClose();
    },
    onError: (err: Error) => {
      const parsed = parseApiError(err, 'Sync failed');
      setError(parsed.message);
    },
  });

  const handleSync = () => {
    setError(null);
    syncMutation.mutate();
  };

  const repo = repoQuery.data;
  const status = statusQuery.data;
  const isLoading = syncMutation.isPending;
  const noRepo = !repoQuery.isLoading && !repo;

  const requiresPersonalToken = !sharingEnabled;
  const personalTokenValid = !requiresPersonalToken || (credentialValidQuery.data?.valid ?? false);
  const tokenCheckLoading = requiresPersonalToken && credentialValidQuery.isLoading;

  const canSubmit = !isLoading && !noRepo && commitMessage.trim().length > 0 && personalTokenValid && !tokenCheckLoading;

  const formatLastSync = (timestamp: number | null) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  };

  return (
    <Modal
      open={open}
      onRequestClose={onClose}
      modalHeading={`Sync: ${projectName}`}
      primaryButtonText={isLoading ? 'Syncing...' : 'Sync Now'}
      secondaryButtonText="Cancel"
      onRequestSubmit={handleSync}
      primaryButtonDisabled={!canSubmit}
      size="sm"
    >
      {noRepo ? (
        <InlineNotification
          kind="warning"
          title="No Remote Repository"
          subtitle="This project is not connected to a remote Git repository."
          lowContrast
          hideCloseButton
        />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
          {!sharingEnabled && !tokenCheckLoading && !personalTokenValid && (
            <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
              <InlineNotification
                kind="warning"
                title="Git credentials required"
                subtitle="This platform requires each user to connect their own Git credentials to sync."
                lowContrast
                hideCloseButton
              />
              <div>
                <Button
                  kind="secondary"
                  size="sm"
                  onClick={() => nav(toTenantPath('/settings/git-connections'))}
                >
                  Connect Git credentials
                </Button>
              </div>
            </div>
          )}

          {!sharingEnabled && tokenCheckLoading && (
            <InlineLoading description="Checking Git credentials..." />
          )}

          {/* First sync warning */}
          {repo && !repo.lastSyncAt && (
            <InlineNotification
              kind="info"
              title="First sync"
              subtitle="This is the first sync for this project. All files will be pushed which may take a moment."
              lowContrast
              hideCloseButton
            />
          )}

          {/* Version Message - Required */}
          <TextArea
            id="commit-message"
            labelText="Version message"
            placeholder="Describe your changes..."
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            rows={2}
            maxCount={200}
            enableCounter
            invalid={commitMessage.length === 0 && error !== null}
            invalidText="Version message is required"
          />

          {/* Sync Direction */}
          <div>
            <div style={{ marginBottom: 'var(--spacing-3)', fontWeight: 500 }}>
              Sync Direction
            </div>
            <RadioButtonGroup
              name="sync-direction"
              valueSelected={direction}
              onChange={(value) => setDirection(value as SyncDirection)}
              orientation="vertical"
            >
              {pushEnabled && (
                <RadioButton
                  labelText={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
                      <CloudUpload size={16} />
                      <span>Push to Remote</span>
                      <span style={{ color: 'var(--cds-text-secondary)', fontSize: '12px' }}>
                        — Upload local changes
                      </span>
                    </div>
                  }
                  value="push"
                />
              )}
              {pullEnabled && (
                <RadioButton
                  labelText={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
                      <CloudDownload size={16} />
                      <span>Pull from Remote</span>
                      <span style={{ color: 'var(--cds-text-secondary)', fontSize: '12px' }}>
                        — Download remote changes
                      </span>
                    </div>
                  }
                  value="pull"
                />
              )}
            </RadioButtonGroup>
          </div>

          {/* Loading */}
          {isLoading && (
            <InlineLoading 
              description={
                direction === 'push' ? 'Pushing to remote...' :
                'Pulling from remote...'
              } 
            />
          )}

          {/* Error */}
          {error && (
            <InlineNotification
              kind="error"
              title="Sync Failed"
              subtitle={error}
              lowContrast
              hideCloseButton
            />
          )}
        </div>
      )}
    </Modal>
  );
}
