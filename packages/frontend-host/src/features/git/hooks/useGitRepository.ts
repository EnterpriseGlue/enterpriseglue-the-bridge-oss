/**
 * React Query hook for Git repository management
 */

import { useQuery } from '@tanstack/react-query';
import { gitApi } from '../api/gitApi';

/**
 * Get all repositories for the current user
 */
export function useGitRepositories() {
  return useQuery({
    queryKey: ['git', 'repositories'],
    queryFn: () => gitApi.getRepositories(),
    staleTime: 60000, // 1 minute
  });
}

/**
 * Get repository for a specific project
 */
export function useGitRepository(projectId: string | undefined) {
  return useQuery({
    queryKey: ['git', 'repository', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      
      // Get all repositories and find the one for this project
      const repos = await gitApi.getRepositories();
      return repos.find(r => r.projectId === projectId) || null;
    },
    enabled: !!projectId,
    staleTime: 60000, // 1 minute
  });
}

/**
 * Check if project has Git repository connected
 */
export function useHasGitRepository(projectId: string | undefined): boolean {
  const { data: repository } = useGitRepository(projectId);
  return !!repository;
}
