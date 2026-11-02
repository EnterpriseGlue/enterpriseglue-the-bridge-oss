import { CommitFileSnapshotsResponseSchema } from '@enterpriseglue/shared/schemas/starbase/commit-snapshot.js';
import { apiClient } from '../../../shared/api/client';

export async function getProjectCommitSnapshots(projectId: string, commitId: string) {
  return CommitFileSnapshotsResponseSchema.parse(await apiClient.get(
    `/vcs-api/projects/${encodeURIComponent(projectId)}/commits/${encodeURIComponent(commitId)}/files`,
  ));
}

export { selectCommitFileSnapshot } from '@enterpriseglue/shared/utils/commit-snapshot.js';
