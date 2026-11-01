/**
 * Sync Modal
 * Handles push/pull operations with remote Git repository
 */

import React, { useState, useEffect, useRef } from 'react';
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
import { syncProject } from '../api/syncProject';
import { permissionSnapshotAuthorityKey } from '../../../contexts/authSessionPermissions';
import { getBrowserSessionRevision } from '../../../utils/browserSession';
import { apiClient } from '../../../shared/api/client';
import { fetchList } from '../../../shared/api/fetchList';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import { usePlatformSyncSettings } from '../../platform-admin/hooks/usePlatformSyncSettings';
import { useAuth } from '../../../shared/hooks/useAuth';
import { ProjectPermission } from '../../../shared/auth/permissions';
import { evaluateActionSnapshot } from '../../../shared/auth/guards';
import type { GitSyncRequest, GitSyncStatusResponse } from '@enterpriseglue/shared/schemas/git/repository.js';

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
  projectId: string;
  providerId: string;
  remoteUrl: string;
  repositoryName: string;
  defaultBranch: string;
  lastSyncAt: number | null;
  lastCommitSha: string | null;
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
  const location = useLocation();
  const { permissions, hasProjectPermission, user, sessionRevision } = useAuth();
  const authority = JSON.stringify([user?.session?.principal.id || user?.id || null, user?.session?.tenant.id || null, sessionRevision ?? null, permissionSnapshotAuthorityKey(permissions)]);
  const authoritySession = useRef({ authority, revision: getBrowserSessionRevision() });
  if (authoritySession.current.authority !== authority) authoritySession.current = { authority, revision: getBrowserSessionRevision() };
  const pathname = location?.pathname ?? '';

  const tenantSlugMatch = pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null;
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : null;
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : '';
  const toTenantPath = (p: string) => (tenantSlug ? `${tenantPrefix}${p}` : p);

  const [direction, setDirection] = useState<SyncDirection>('push');
  const [commitMessage, setCommitMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const projectResource = { type: 'project' as const, id: projectId };
  const syncStatusDecision = evaluateActionSnapshot(permissions, 'project.git.sync.status', projectResource);
  const syncRunDecision = evaluateActionSnapshot(permissions, 'project.git.sync.run', projectResource);
  const canReadSyncStatus = syncStatusDecision.allowed ||
    hasProjectPermission(projectId, ProjectPermission.GIT_PULL) ||
    hasProjectPermission(projectId, ProjectPermission.GIT_PUSH);

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
  }, [open, projectId, authority, pushEnabled, pullEnabled]);

  // Fetch repository info
  const repoQuery = useQuery({
    queryKey: ['git', 'repository', projectId, authority],
    queryFn: async () => {
      const repos = await fetchList<RepoInfo>('/git-api/repositories', { projectId });
      return repos.find((r: RepoInfo) => r.projectId === projectId) || null;
    },
    enabled: open,
  });

  const providerIdForTokenCheck = repoQuery.data?.providerId;
  const credentialValidQuery = useQuery({
    queryKey: ['git', 'credentials', 'valid', providerIdForTokenCheck, authority],
    queryFn: async () => {
      return apiClient.get<{ valid: boolean }>(
        `/git-api/credentials/${encodeURIComponent(providerIdForTokenCheck || '')}/validate`
      ).catch(() => ({ valid: false }));
    },
    enabled: open && !sharingEnabled && !!providerIdForTokenCheck,
  });

  // Fetch sync status
  const statusQuery = useQuery({
    queryKey: ['git', 'sync-status', projectId],
    queryFn: async () => {
      return apiClient.get<GitSyncStatusResponse>('/git-api/sync/status', { projectId }).catch(() => null);
    },
    enabled: open && !!repoQuery.data && canReadSyncStatus,
  });

  const repo = repoQuery.data;
  const noRepo = !repoQuery.isLoading && !repo;
  const requiresPersonalToken = !sharingEnabled;
  const personalTokenValid = !requiresPersonalToken || credentialValidQuery.data?.valid === true;
  const tokenCheckLoading = requiresPersonalToken && (credentialValidQuery.isLoading || credentialValidQuery.isFetching);
  const requiredSyncPermission = direction === 'pull' ? ProjectPermission.GIT_PULL : ProjectPermission.GIT_PUSH;
  const availability = permissions?.projects?.find(project => project.resourceId === projectId)?.actionAvailability;
  const explicitlyRestricted = availability ? Boolean(availability.restrictions['project.git.sync.run']) && !availability.allowedActions.includes('project.git.sync.run') : false;
  const hasDirectionPermission = hasProjectPermission(projectId, requiredSyncPermission);
  // The registry's sync action uses push as its primary permission. An allowed
  // push action is never evidence for the additional pull permission.
  const canRunSyncAction = !explicitlyRestricted && (direction === 'push' ? syncRunDecision.allowed || hasDirectionPermission : hasDirectionPermission);
  const syncUnavailableReason = canRunSyncAction ? null : explicitlyRestricted ? syncRunDecision.reason : `Missing permission ${requiredSyncPermission}`;
  const scope = JSON.stringify([open, projectId, authority, direction, commitMessage, repo?.id, repo?.providerId,
    personalTokenValid, pushEnabled, pullEnabled, syncUnavailableReason]);
  const scopeRef = useRef(scope), lifetimeRef = useRef(0), activeRef = useRef<number | null>(null), submittedRef = useRef<number | null>(null);
  if (scopeRef.current !== scope) { scopeRef.current = scope; lifetimeRef.current += 1; }
  const mountedRef = useRef(true);
  const renderedSession = authoritySession.current.revision;
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; lifetimeRef.current += 1; }; }, []);
  type Intent = GitSyncRequest & { isCurrent: () => boolean; assertCurrent: () => void };
  const syncMutation = useMutation({
    mutationFn: (intent: Intent) => syncProject({ projectId: intent.projectId, direction: intent.direction, message: intent.message }, intent.assertCurrent),
    onSuccess: (_data, intent) => {
      if (!intent.isCurrent()) return;
      queryClient.invalidateQueries({ queryKey: ['git', 'deployments', intent.projectId] });
      queryClient.invalidateQueries({ queryKey: ['git', 'deployments', 'recent'] });
      queryClient.invalidateQueries({ queryKey: ['git', 'repository', intent.projectId] });
      queryClient.invalidateQueries({ queryKey: ['git', 'sync-status', intent.projectId] });
      queryClient.invalidateQueries({ queryKey: ['vcs', 'commits', intent.projectId] });
      queryClient.invalidateQueries({ queryKey: ['uncommitted-files', intent.projectId] });
      onSuccess?.();
      if (intent.isCurrent()) onClose();
    },
    onError: (failure, intent) => {
      if (intent.isCurrent()) setError(parseApiError(failure, 'Sync failed').message);
    },
    onSettled: (_data, _error, intent) => { if (intent.isCurrent()) activeRef.current = null; },
  });
  const isLoading = submittedRef.current === lifetimeRef.current && syncMutation.isPending;
  const currentError = submittedRef.current === lifetimeRef.current ? error : null;
  const directionEnabled = direction === 'push' ? pushEnabled : pullEnabled;
  const canSubmit = open && !isLoading && !noRepo && commitMessage.trim().length > 0 && personalTokenValid && !tokenCheckLoading && directionEnabled && !syncUnavailableReason;
  const handleSync = () => {
    if (!mountedRef.current || scope !== scopeRef.current || !canSubmit || activeRef.current === lifetimeRef.current || renderedSession !== getBrowserSessionRevision()) return;
    const lifetime = lifetimeRef.current, session = renderedSession;
    const isCurrent = () => mountedRef.current && lifetime === lifetimeRef.current && session === getBrowserSessionRevision();
    const intent: Intent = { projectId, direction, message: commitMessage.trim(), isCurrent,
      assertCurrent: () => { if (!isCurrent()) throw new Error('Sync context changed; review the target again'); } };
    activeRef.current = lifetime; submittedRef.current = lifetime;
    setError(null); syncMutation.reset(); syncMutation.mutate(intent);
  };
  const handleClose = () => { lifetimeRef.current += 1; setError(null); setCommitMessage(''); onClose(); };

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
      onRequestClose={handleClose}
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
          {syncUnavailableReason && (
            <InlineNotification
              kind="warning"
              title="Sync unavailable"
              subtitle={syncUnavailableReason}
              lowContrast
              hideCloseButton
            />
          )}

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
            disabled={isLoading}
            maxCount={200}
            enableCounter
            invalid={commitMessage.length === 0 && currentError !== null}
            invalidText="Version message is required"
          />

          {/* Sync Direction */}
          <div>
            <div style={{ marginBottom: 'var(--spacing-3)', fontWeight: 500 }}>
              Sync Direction
            </div>
            <RadioButtonGroup
              disabled={isLoading}
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
          {currentError && (
            <InlineNotification
              kind="error"
              title="Sync Failed"
              subtitle={currentError}
              lowContrast
              hideCloseButton
            />
          )}
        </div>
      )}
    </Modal>
  );
}
