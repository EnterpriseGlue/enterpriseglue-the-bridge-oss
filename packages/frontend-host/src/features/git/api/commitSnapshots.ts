import { CommitFileSnapshotsResponseSchema, type CommitFileSnapshot } from '@enterpriseglue/shared/schemas/starbase/commit-snapshot.js';
import { apiClient } from '../../../shared/api/client';

export async function getProjectCommitSnapshots(projectId: string, commitId: string) {
  return CommitFileSnapshotsResponseSchema.parse(await apiClient.get(
    `/vcs-api/projects/${encodeURIComponent(projectId)}/commits/${encodeURIComponent(commitId)}/files`,
  ));
}

export function selectCommitFileSnapshot(
  files: readonly CommitFileSnapshot[],
  target: { id?: string; name?: string; type?: string; folderId?: string | null },
): CommitFileSnapshot | null {
  if (!target.id || !target.type) return null;
  const identified = files.filter(file => file.mainFileId === target.id);
  // Stable identity survives renaming. Conflicting or deleted identity must
  // never fall back to another file that happens to have the same name/type.
  const candidates = identified.length > 0 ? identified : files.filter(file =>
    file.mainFileId === null && file.name === target.name && file.type === target.type
    && (file.folderId || null) === (target.folderId || null));
  if (candidates.length !== 1) return null;
  const file = candidates[0];
  return file.type === target.type && file.changeType !== 'deleted' && file.content ? file : null;
}
