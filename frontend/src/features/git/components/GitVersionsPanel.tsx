/**
 * Versions Panel
 * Shows VCS version history with timeline style
 */

import React, { useState, lazy, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, InlineNotification, InlineLoading, ProgressIndicator, ProgressStep, Toggle } from '@carbon/react';
import { apiClient } from '../../../shared/api/client';
import { parseApiError } from '../../../shared/api/apiErrorUtils';

// Lazy load the viewers
const Viewer = lazy(() => import('../../shared/components/Viewer'));
const DMNDrdMini = lazy(() => import('../../starbase/components/DMNDrdMini'));

interface GitVersionsPanelProps {
  projectId: string;
  fileId?: string;
  fileName?: string;
  fileType?: 'bpmn' | 'dmn';
  hasUnsavedVersion?: boolean;
  lastEditedAt?: number | null;
}

interface VcsCommit {
  id: string;
  branchId: string;
  message: string;
  userId: string;
  createdAt: number;
  hash: string;
  versionNumber?: number | null;
  fileVersionNumber?: number | null; // Sequential version number for this specific file
  source?: string;
  isRemote?: boolean;
}

const MANUAL_SOURCES = new Set(['manual', 'restore']);

function isManualCommit(commit: VcsCommit): boolean {
  return MANUAL_SOURCES.has(commit.source ?? 'manual');
}

function isAutoCommitMessage(message: string): boolean {
  const msg = message.toLowerCase();
  return msg.startsWith('sync from starbase') ||
    msg.startsWith('merge from draft') ||
    msg.startsWith('pull from remote');
}

function getSourceLabel(source: string | undefined): string | null {
  switch (source) {
    case 'sync-push': return 'Sync';
    case 'sync-pull': return 'Pull';
    case 'deploy': return 'Deploy';
    case 'system': return 'Auto';
    case 'restore': return 'Restore';
    default: return null;
  }
}

interface FileSnapshot {
  id: string;
  name: string;
  type: string;
  content: string | null;
  changeType: string;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString('en-GB', { 
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

function formatTimeExact(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatEditedTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = Math.max(0, now - timestamp);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Edited just now';
  if (diffMins < 60) return `Edited ${diffMins} min ago`;
  if (diffHours < 24) return `Edited ${diffHours} h ago`;
  if (diffDays < 7) return `Edited ${diffDays} d ago`;
  return `Edited ${new Date(timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
}

function InlineTag({ type, children }: { type: string; children: React.ReactNode }) {
  const safeType = String(type || 'gray');
  const className = `cds--tag cds--tag--sm cds--layout--size-sm cds--tag--${safeType}`;
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center' }}>
      {children}
    </span>
  );
}

export default function GitVersionsPanel({ projectId, fileId, fileName, fileType = 'bpmn', hasUnsavedVersion, lastEditedAt }: GitVersionsPanelProps) {
  const queryClient = useQueryClient();
  const [selectedCommit, setSelectedCommit] = useState<VcsCommit | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewXml, setPreviewXml] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(10);
  const [showSystemVersions, setShowSystemVersions] = useState(false);

  // Fetch VCS commit history filtered to this specific file
  const commitsQuery = useQuery({
    queryKey: ['vcs', 'commits', projectId, fileId],
    queryFn: async () => {
      // Use fileId to only get commits that affected this file
      const params: Record<string, string> = { branch: 'all' };
      if (fileId) params.fileId = fileId;
      const data = await apiClient.get<{ commits: VcsCommit[] }>(
        `/vcs-api/projects/${projectId}/commits`,
        params
      );
      
      // Always filter out internal auto-generated merge/sync commits
      const filteredCommits = data.commits.filter(commit => !isAutoCommitMessage(commit.message));
      
      return { commits: filteredCommits };
    },
    enabled: !!projectId,
    staleTime: 10000, // 10 seconds
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch file snapshots for selected commit
  const snapshotsQuery = useQuery({
    queryKey: ['vcs', 'commit-files', projectId, selectedCommit?.id],
    queryFn: async () => {
      return apiClient.get<{ files: FileSnapshot[] }>(
        `/vcs-api/projects/${projectId}/commits/${selectedCommit!.id}/files`
      );
    },
    enabled: !!selectedCommit && previewOpen,
  });

  // Restore mutation
  const restoreMutation = useMutation({
    mutationFn: async (commitId: string) => {
      return apiClient.post(`/vcs-api/projects/${projectId}/commits/${commitId}/restore`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vcs', 'commits', projectId] });
      queryClient.invalidateQueries({ queryKey: ['file'] });
      setPreviewOpen(false);
      setSelectedCommit(null);
      // Clear local XML history so restored content takes effect
      if (fileId) {
        localStorage.removeItem(`xml-history-${fileId}`);
      }
      // Reload to show restored content
      window.location.reload();
    },
  });

  const handleCommitClick = (commit: VcsCommit) => {
    setSelectedCommit(commit);
    setPreviewXml(null); // Reset preview XML
    setPreviewOpen(true);
  };

  const handleClosePreview = () => {
    setPreviewOpen(false);
    setSelectedCommit(null);
    setPreviewXml(null);
  };

  const handleRestore = () => {
    if (selectedCommit) {
      restoreMutation.mutate(selectedCommit.id);
    }
  };

  // Extract XML from snapshots when loaded
  React.useEffect(() => {
    if (snapshotsQuery.data?.files) {
      const files = snapshotsQuery.data.files;

      const score = (s: FileSnapshot) => {
        let v = 0;
        if (s.content) v += 10;
        if (s.changeType !== 'unchanged') v += 5;
        if (s.changeType === 'deleted') v -= 20;
        return v;
      };

      const pickBest = (candidates: FileSnapshot[]) => {
        let best: FileSnapshot | undefined;
        for (const c of candidates) {
          if (!best || score(c) > score(best)) best = c;
        }
        return best;
      };

      // Prefer the most recent snapshot for this exact file (name + type)
      let file: FileSnapshot | undefined;

      if (fileName) {
        const exactMatches = files.filter(f => f.name === fileName && f.type === fileType);
        if (exactMatches.length > 0) {
          file = pickBest(exactMatches);
        } else {
          const nameMatches = files.filter(f => f.name === fileName);
          if (nameMatches.length > 0) {
            file = pickBest(nameMatches);
          }
        }
      }

      // Fallbacks: latest by type, then any file with content
      if (!file) {
        const typeMatches = files.filter(f => f.type === fileType);
        if (typeMatches.length > 0) {
          file = pickBest(typeMatches);
        }
      }

      if (!file) {
        const anyWithContent = files.filter(f => f.content);
        if (anyWithContent.length > 0) {
          file = pickBest(anyWithContent);
        }
      }

      if (file?.content) {
        setPreviewXml(file.content);
      }
    }
  }, [snapshotsQuery.data, fileName, fileType]);

  if (commitsQuery.isLoading) {
    return <div style={{ padding: 'var(--spacing-4)', fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>Loading versions...</div>;
  }

  if (commitsQuery.isError) {
    return (
      <div style={{ padding: 'var(--spacing-4)' }}>
        <InlineNotification
          kind="error"
          title="Failed to load versions"
          subtitle="Could not fetch version history"
          lowContrast
          hideCloseButton
        />
      </div>
    );
  }

  const allCommits = commitsQuery.data?.commits || [];
  const systemCount = allCommits.filter(c => !isManualCommit(c)).length;

  // Filter based on toggle
  const displayCommits = showSystemVersions
    ? allCommits
    : allCommits.filter(c => isManualCommit(c));

  // Sort commits in descending order (newest first). Prefer file-specific version numbers when available.
  const commits = [...displayCommits].sort((a, b) => {
    const aFileVersion = typeof a.fileVersionNumber === 'number' ? a.fileVersionNumber : null;
    const bFileVersion = typeof b.fileVersionNumber === 'number' ? b.fileVersionNumber : null;
    if (aFileVersion !== null && bFileVersion !== null && aFileVersion !== bFileVersion) {
      return bFileVersion - aFileVersion;
    }
    return b.createdAt - a.createdAt;
  });

  // Show newest N, but render oldest->newest for ProgressIndicator so latest is always the current step.
  // We will reverse the *visual* order with CSS so latest appears at the top.
  const visibleCommitsNewestFirst = commits.slice(0, Math.min(visibleCount, commits.length));
  const visibleCommits = [...visibleCommitsNewestFirst].reverse();
  const latestIndex = Math.max(visibleCommits.length - 1, 0);

  const showUnsavedStep = Boolean(hasUnsavedVersion);
  // If we have an unsaved version, that step should be the current (half-circle) step.
  // If everything is saved, we set currentIndex to one-past-the-end so all saved versions render as complete (checkmark).
  const currentIndex = visibleCommits.length;

  if (commits.length === 0) {
    return (
      <div style={{ padding: 'var(--spacing-4)' }}>
        <div style={{ fontSize: 'var(--text-14)', color: 'var(--color-text-secondary)' }}>
          No versions yet. Save a version to start tracking changes.
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Scrollable timeline */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '12px 16px',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        <style>{`
          .git-versions-progress .cds--progress--vertical,
          .git-versions-progress .bx--progress--vertical {
            display: flex;
            flex-direction: column-reverse;
          }

          .git-versions-unsaved-step .cds--progress-label,
          .git-versions-unsaved-step .bx--progress-label {
            font-style: italic;
          }

          .git-versions-progress .cds--progress-label:hover,
          .git-versions-progress .bx--progress-label:hover {
            box-shadow: none;
            color: inherit;
            cursor: inherit;
          }

          .git-versions-step-previewable .cds--progress-step-button,
          .git-versions-step-previewable .bx--progress-step-button {
            cursor: pointer;
          }

          .git-versions-step-title {
            color: var(--cds-link-primary, #0f62fe);
            text-decoration: none;
            display: inline;
          }

          .git-versions-step-previewable:hover .git-versions-step-title {
            text-decoration: underline;
          }

          .git-versions-step-nonpreviewable .git-versions-step-title {
            color: inherit;
          }

          .cds--progress-step .cds--progress-label,
          .bx--progress-step .bx--progress-label {
            white-space: normal;
            word-break: break-word;
            overflow-wrap: anywhere;
            max-width: 100%;
          }
          .cds--progress-step .cds--progress-optional,
          .bx--progress-step .bx--progress-optional {
            white-space: normal;
            word-break: break-word;
            overflow-wrap: anywhere;
            max-width: 100%;
          }
        `}</style>

        <div className="git-versions-progress">
          <ProgressIndicator
            vertical
            currentIndex={currentIndex}
            onChange={(nextIndex: number) => {
              const total = showUnsavedStep ? visibleCommits.length + 1 : visibleCommits.length;
              const idx = Math.max(0, Math.min(nextIndex, total - 1));
              if (showUnsavedStep && idx === visibleCommits.length) return;
              if (!showUnsavedStep && idx === latestIndex) return;
              const commit = visibleCommits[idx];
              if (commit) handleCommitClick(commit);
            }}
          >
          {visibleCommits.map((commit, index) => {
            const isLatest = index === latestIndex;
            const origin = commit.isRemote ? 'Remote' : 'Local';
            const isPreviewable = showUnsavedStep ? true : !isLatest;
            const timeText = formatTime(commit.createdAt);

            const Step: any = ProgressStep;

            return (
              <Step
                key={commit.id}
                className={isPreviewable ? 'git-versions-step-previewable' : 'git-versions-step-nonpreviewable'}
                label={(
                  <span style={{ display: 'inline-flex', flexDirection: 'column', gap: '4px' }}>
                    <span className="git-versions-step-title">
                      {commit.fileVersionNumber ? `v${commit.fileVersionNumber} — ` : (commit.versionNumber ? `v${commit.versionNumber} — ` : '')}{commit.message}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      {isLatest ? <InlineTag type="green">Latest</InlineTag> : null}
                      <InlineTag type={commit.isRemote ? 'blue' : 'purple'}>{origin}</InlineTag>
                      {!isManualCommit(commit) && getSourceLabel(commit.source) && (
                        <InlineTag type="gray">{getSourceLabel(commit.source)}</InlineTag>
                      )}
                      <span style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)' }}>{timeText}</span>
                    </span>
                  </span>
                ) as any}
                secondaryLabel={''}
                complete={isLatest}
                {...({ title: isPreviewable ? 'Preview version' : '' } as any)}
              />
            );
          })}

          {showUnsavedStep && (
            <ProgressStep
              key="unsaved"
              className="git-versions-unsaved-step"
              label="Unsaved version"
              secondaryLabel={typeof lastEditedAt === 'number' ? formatEditedTime(lastEditedAt) : 'Edited recently'}
            />
          )}
          </ProgressIndicator>
        </div>

        {visibleCommits.length < commits.length && (
          <div style={{ marginTop: 'var(--spacing-5)' }}>
            <Button kind="ghost" size="sm" onClick={() => setVisibleCount((c) => c + 10)}>
              Load older versions
            </Button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ 
        padding: 'var(--spacing-2) var(--spacing-3)',
        borderTop: '1px solid var(--color-border-primary)',
        fontSize: 'var(--text-12)',
        color: 'var(--color-text-tertiary)'
      }}>
        {systemCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Toggle
              id="show-system-versions"
              size="sm"
              labelA=""
              labelB=""
              toggled={showSystemVersions}
              onToggle={() => setShowSystemVersions(v => !v)}
            />
            <span>Show system versions ({systemCount})</span>
          </div>
        )}
        {!systemCount && (
          <>Showing {visibleCommits.length} of {commits.length} version{commits.length !== 1 ? 's' : ''}</>
        )}
      </div>

      {/* Preview Modal with Diagram Viewer */}
      <Modal
        open={previewOpen}
        onRequestClose={handleClosePreview}
        modalHeading={selectedCommit ? `Version: ${selectedCommit.message}` : 'Version Preview'}
        modalLabel={selectedCommit ? formatTimeExact(selectedCommit.createdAt) : ''}
        primaryButtonText={restoreMutation.isPending ? 'Restoring...' : 'Restore this version'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={restoreMutation.isPending || !previewXml}
        onRequestSubmit={handleRestore}
        size="lg"
        passiveModal={false}
      >
        <div style={{ height: '500px', display: 'flex', flexDirection: 'column' }}>
          {/* Loading state */}
          {snapshotsQuery.isLoading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <InlineLoading description="Loading version..." />
            </div>
          )}

          {/* Error states */}
          {snapshotsQuery.isError && (
            <InlineNotification
              kind="error"
              title="Failed to load version"
              subtitle="Could not fetch file content"
              lowContrast
              hideCloseButton
            />
          )}

          {restoreMutation.isError && (
            <InlineNotification
              kind="error"
              title="Restore failed"
              subtitle={parseApiError(restoreMutation.error, 'Restore failed').message}
              lowContrast
              style={{ marginBottom: 'var(--spacing-3)' }}
            />
          )}

          {/* Info bar */}
          {snapshotsQuery.data && (
            <div style={{ 
              padding: 'var(--spacing-3)', 
              background: 'var(--color-bg-secondary)', 
              borderBottom: '1px solid var(--color-border-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              flexShrink: 0
            }}>
              <span style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>
                Restoring will replace current content
              </span>
            </div>
          )}

          {/* Diagram Viewer */}
          {previewXml && fileType === 'bpmn' && (
            <div style={{ flex: 1, position: 'relative', background: 'var(--color-bg-primary)' }}>
              <Suspense fallback={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                  <InlineLoading description="Loading diagram viewer..." />
                </div>
              }>
                <Viewer xml={previewXml} />
              </Suspense>
            </div>
          )}

          {/* DMN Viewer */}
          {previewXml && fileType === 'dmn' && (
            <div style={{ flex: 1, position: 'relative', background: 'var(--color-bg-primary)' }}>
              <Suspense fallback={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                  <InlineLoading description="Loading DMN viewer..." />
                </div>
              }>
                <DMNDrdMini xml={previewXml} preferDecisionTable />
              </Suspense>
            </div>
          )}

          {/* No content */}
          {!snapshotsQuery.isLoading && !previewXml && snapshotsQuery.data && (
            <div style={{ 
              flex: 1, 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              color: 'var(--color-text-tertiary)'
            }}>
              No diagram content found in this version
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
