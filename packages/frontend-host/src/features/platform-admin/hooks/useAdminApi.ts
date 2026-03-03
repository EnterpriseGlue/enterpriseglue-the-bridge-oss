/**
 * React Query hooks for Platform Admin API
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { platformAdminApi, type PlatformSettings, type EnvironmentTag, type ProjectGovernanceItem, type EngineGovernanceItem, type GitProvider } from '../../../api/platform-admin';
// Query keys
export const adminQueryKeys = {
  settings: ['platform-admin', 'admin', 'settings'] as const,
  environments: ['platform-admin', 'admin', 'environments'] as const,
  gitProviders: ['platform-admin', 'admin', 'git-providers'] as const,
  users: (params?: { limit?: number; offset?: number }) => ['platform-admin', 'admin', 'users', params] as const,
  userSearch: (query: string) => ['platform-admin', 'admin', 'users', 'search', query] as const,
  projectsGovernance: (search?: string) => ['platform-admin', 'admin', 'governance', 'projects', search] as const,
  enginesGovernance: (search?: string) => ['platform-admin', 'admin', 'governance', 'engines', search] as const,
};

// Platform Settings hooks
export function usePlatformSettings() {
  return useQuery({
    queryKey: adminQueryKeys.settings,
    queryFn: () => platformAdminApi.getSettings(),
  });
}

export function useUpdatePlatformSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<PlatformSettings>) => platformAdminApi.updateSettings(data),
    // Optimistic update - immediately reflect the change
    onMutate: async (newData) => {
      await queryClient.cancelQueries({ queryKey: adminQueryKeys.settings });
      const previousSettings = queryClient.getQueryData<PlatformSettings>(adminQueryKeys.settings);
      
      if (previousSettings) {
        queryClient.setQueryData<PlatformSettings>(adminQueryKeys.settings, {
          ...previousSettings,
          ...newData,
        });
      }
      
      return { previousSettings };
    },
    // Rollback on error
    onError: (_err, _newData, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(adminQueryKeys.settings, context.previousSettings);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.settings });
    },
  });
}

// Environment Tags hooks
export function useEnvironmentTags() {
  return useQuery({
    queryKey: adminQueryKeys.environments,
    queryFn: () => platformAdminApi.getEnvironments(),
  });
}

export function useCreateEnvironmentTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { name: string; color?: string; manualDeployAllowed?: boolean }) =>
      platformAdminApi.createEnvironment(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.environments });
    },
  });
}

export function useUpdateEnvironmentTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<EnvironmentTag>) =>
      platformAdminApi.updateEnvironment(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.environments });
    },
  });
}

export function useDeleteEnvironmentTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => platformAdminApi.deleteEnvironment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.environments });
    },
  });
}

export function useReorderEnvironmentTags() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (orderedIds: string[]) => platformAdminApi.reorderEnvironments(orderedIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.environments });
    },
  });
}

// Users hooks
export function useAdminUsers(params?: { limit?: number; offset?: number }) {
  return useQuery({
    queryKey: adminQueryKeys.users(params),
    queryFn: () => platformAdminApi.getUsers(params),
  });
}

export function useUserSearch(query: string) {
  return useQuery({
    queryKey: adminQueryKeys.userSearch(query),
    queryFn: () => platformAdminApi.searchUsers(query),
    enabled: query.length >= 2,
  });
}

// Governance hooks
export function useAssignProjectOwner() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, userId, reason }: { projectId: string; userId: string; reason: string }) =>
      platformAdminApi.assignProjectOwner(projectId, { userId, reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['starbase', 'projects'] });
    },
  });
}

export function useAssignEngineOwner() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ engineId, userId, reason }: { engineId: string; userId: string; reason: string }) =>
      platformAdminApi.assignEngineOwner(engineId, { userId, reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['engines'] });
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.enginesGovernance() });
    },
  });
}

// Governance - Projects
export function useProjectsGovernance(search?: string) {
  return useQuery({
    queryKey: adminQueryKeys.projectsGovernance(search),
    queryFn: () => platformAdminApi.getProjectsForGovernance(search ? { search } : undefined),
  });
}

export function useAssignProjectDelegate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, userId, reason }: { projectId: string; userId: string; reason: string }) =>
      platformAdminApi.assignProjectDelegate(projectId, { userId, reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['starbase', 'projects'] });
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.projectsGovernance() });
    },
  });
}

// Governance - Engines
export function useEnginesGovernance(search?: string) {
  return useQuery({
    queryKey: adminQueryKeys.enginesGovernance(search),
    queryFn: () => platformAdminApi.getEnginesForGovernance(search ? { search } : undefined),
  });
}

export function useAssignEngineDelegate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ engineId, userId, reason }: { engineId: string; userId: string; reason: string }) =>
      platformAdminApi.assignEngineDelegate(engineId, { userId, reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['engines'] });
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.enginesGovernance() });
    },
  });
}

// Git Providers hooks
export function useAdminGitProviders() {
  return useQuery({
    queryKey: adminQueryKeys.gitProviders,
    queryFn: () => platformAdminApi.getGitProviders(),
  });
}

export function useUpdateGitProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<GitProvider> }) =>
      platformAdminApi.updateGitProvider(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.gitProviders });
      queryClient.invalidateQueries({ queryKey: ['git-providers'] }); // Also invalidate user-facing providers
    },
  });
}
