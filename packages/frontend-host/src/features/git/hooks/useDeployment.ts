/**
 * React Query hook for Git deployments
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { gitApi } from '../api/gitApi';
import type { DeployRequest, RollbackRequest } from '../types/git';

/**
 * Deploy project to Git (commit + push + tag)
 */
export function useDeployment(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: Omit<DeployRequest, 'projectId'>) =>
      gitApi.deploy({ ...params, projectId }),
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['git', 'deployments', projectId] });
      queryClient.invalidateQueries({ queryKey: ['git', 'commits', projectId] });
      queryClient.invalidateQueries({ queryKey: ['git', 'repository', projectId] });
      queryClient.invalidateQueries({ queryKey: ['git', 'deployments', 'recent'] });
    },
  });
}

/**
 * Rollback to a specific commit
 */
export function useRollback(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commitSha: string) =>
      gitApi.rollback({ projectId, commitSha }),
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['git', 'deployments', projectId] });
      queryClient.invalidateQueries({ queryKey: ['git', 'commits', projectId] });
      queryClient.invalidateQueries({ queryKey: ['git', 'repository', projectId] });
      // Also invalidate files since they changed
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'files'] });
    },
  });
}

/**
 * Get deployment history for a project
 */
export function useDeployments(projectId: string | undefined) {
  return useQuery({
    queryKey: ['git', 'deployments', projectId],
    queryFn: () => gitApi.getDeployments(projectId!),
    enabled: !!projectId,
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Get commit history for a project
 */
export function useCommitHistory(projectId: string | undefined, limit = 100) {
  return useQuery({
    queryKey: ['git', 'commits', projectId, limit],
    queryFn: () => gitApi.getCommits(projectId!, limit),
    enabled: !!projectId,
    staleTime: 30000, // 30 seconds
  });
}
