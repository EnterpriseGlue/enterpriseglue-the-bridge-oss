import { GitSyncRequestSchema, GitSyncResponseSchema, type GitSyncRequest } from '@enterpriseglue/shared/schemas/git/repository.js';
import { apiClient } from '../../../shared/api/client';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import { getBrowserSessionRevision } from '../../../utils/browserSession';

function validatedRequest(request: GitSyncRequest) {
  const parsed = GitSyncRequestSchema.safeParse(request);
  if (!parsed.success) throw new Error('Sync request was not verified');
  return parsed.data;
}

/** A resolved HTTP request alone is not a successful sync receipt. */
export async function syncProject(request: GitSyncRequest, assertCurrent: () => void) {
  const captured = validatedRequest({ ...request });
  const session = getBrowserSessionRevision();
  const check = () => {
    assertCurrent();
    if (session !== getBrowserSessionRevision()) throw new Error('Sync context changed; review the target again');
  };
  check();
  const result = GitSyncResponseSchema.safeParse(await apiClient.post('/git-api/sync', captured));
  check();
  if (!result.success) throw new Error('Sync response was not verified');
  const receipt = result.data;
  if (receipt.error || (captured.direction === 'push' && receipt.pulled)
    || (captured.direction === 'pull' && receipt.pushed)
    || ((receipt.pushed || receipt.pulled) !== (receipt.filesChanged > 0))
    || (receipt.pushed && (!receipt.commitSha?.trim() || receipt.commitSha !== receipt.commitSha.trim()))) {
    throw new Error('Sync response was not verified');
  }
  return receipt;
}

export interface SyncBatchProject { id: string; name: string; gitUrl?: string | null }
export async function syncProjectBatch(projects: readonly SyncBatchProject[], request: Pick<GitSyncRequest, 'direction' | 'message'>, assertCurrent: () => void) {
  const selected = projects.map(project => ({ id: project.id, name: project.name, gitUrl: project.gitUrl }));
  const captured = { ...request };
  const session = getBrowserSessionRevision();
  const check = () => { assertCurrent(); if (session !== getBrowserSessionRevision()) throw new Error('Sync context changed; review the target again'); };
  if (new Set(selected.map(project => project.id)).size !== selected.length) throw new Error('Selected projects must be distinct');
  const planned = selected.map(project => ({ project, request: project.gitUrl ? validatedRequest({ ...captured, projectId: project.id }) : null }));
  const result = { succeeded: [] as { id: string; name: string }[], failed: [] as { id: string; name: string; error: string }[], skipped: [] as { id: string; name: string; reason: string }[] };
  for (const { project, request: body } of planned) {
    check();
    if (!project.gitUrl) { result.skipped.push({ id: project.id, name: project.name, reason: 'Not connected to Git' }); continue; }
    try {
      await syncProject(body!, check);
      result.succeeded.push({ id: project.id, name: project.name });
    } catch (error) {
      // Authority/view changes stop the remaining queue. An owned failed project
      // is reported once, never retried automatically.
      check();
      result.failed.push({ id: project.id, name: project.name, error: parseApiError(error, 'Sync failed').message });
    }
  }
  check();
  return result;
}
