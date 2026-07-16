/**
 * Platform Admin API
 * Platform administration endpoints
 */

import { apiClient } from '../../shared/api/client';
import type {
  CreateEnvironmentTag,
  EnvironmentTag as SharedEnvironmentTag,
  UpdateEnvironmentTag,
} from '@enterpriseglue/shared/schemas/platform-admin/environment-tag.js';
import type {
  AccessAuthorityMode,
  EngineOnboardingMode,
  EngineRuntimeAuthorizationMode,
  PlatformSettings,
  ProjectEngineTargetPolicyMode,
  UpdatePlatformSettings,
} from '@enterpriseglue/shared/schemas/platform-admin/platform-settings.js';
import type {
  GovernanceEngineSummary,
  GovernanceProjectSummary,
  UserListItem,
} from '@enterpriseglue/shared/schemas/platform-admin/admin.js';
import type {
  GitProviderAdminSummary,
  UpdateGitProviderRequest,
} from '@enterpriseglue/shared/schemas/platform-admin/git-provider.js';

export type {
  AccessAuthorityMode,
  EngineOnboardingMode,
  EngineRuntimeAuthorizationMode,
  GovernanceEngineSummary,
  GovernanceProjectSummary,
  PlatformSettings,
  ProjectEngineTargetPolicyMode,
  UserListItem,
};

// Types
export type EnvironmentTag = SharedEnvironmentTag;

export type ProjectGovernanceItem = GovernanceProjectSummary;
export type EngineGovernanceItem = GovernanceEngineSummary;

// API
export const platformAdminApi = {
  // Platform Settings
  getSettings: () =>
    apiClient.get<PlatformSettings>('/api/admin/settings'),

  updateSettings: (data: UpdatePlatformSettings) =>
    apiClient.put<{ success: boolean }>('/api/admin/settings', data),

  // Environment Tags
  getEnvironments: () =>
    apiClient.get<EnvironmentTag[]>('/api/admin/environments'),

  createEnvironment: (data: CreateEnvironmentTag) =>
    apiClient.post<EnvironmentTag>('/api/admin/environments', data),

  updateEnvironment: (id: string, data: UpdateEnvironmentTag) =>
    apiClient.put<{ success: boolean }>(`/api/admin/environments/${id}`, data),

  deleteEnvironment: (id: string) =>
    apiClient.delete(`/api/admin/environments/${id}`),

  reorderEnvironments: (orderedIds: string[]) =>
    apiClient.post<{ success: boolean }>('/api/admin/environments/reorder', { orderedIds }),

  // Users
  getUsers: (params?: { limit?: number; offset?: number }) =>
    apiClient.get<UserListItem[]>('/api/users', params),

  searchUsers: (query: string) =>
    apiClient.get<UserListItem[]>('/api/admin/users/search', { q: query }),

  // Governance - Projects
  getProjectsForGovernance: (params?: { search?: string }) =>
    apiClient.get<ProjectGovernanceItem[]>('/api/admin/projects', params),

  assignProjectOwner: (projectId: string, data: { userId: string; reason: string }) =>
    apiClient.post<{ success: boolean }>(`/api/admin/projects/${projectId}/assign-owner`, data),

  assignProjectDelegate: (projectId: string, data: { userId: string; reason: string }) =>
    apiClient.post<{ success: boolean }>(`/api/admin/projects/${projectId}/assign-delegate`, data),

  // Governance - Engines
  getEnginesForGovernance: (params?: { search?: string }) =>
    apiClient.get<EngineGovernanceItem[]>('/api/admin/engines', params),

  assignEngineOwner: (engineId: string, data: { userId: string; reason: string }) =>
    apiClient.post<{ success: boolean }>(`/api/admin/engines/${engineId}/assign-owner`, data),

  assignEngineDelegate: (engineId: string, data: { userId: string; reason: string }) =>
    apiClient.post<{ success: boolean }>(`/api/admin/engines/${engineId}/assign-delegate`, data),

  // Git Providers
  getGitProviders: () =>
    apiClient.get<GitProvider[]>('/git-api/admin/providers'),

  updateGitProvider: (id: string, data: UpdateGitProviderRequest) =>
    apiClient.put<GitProvider>(`/git-api/admin/providers/${id}`, data),
};

// Git Provider type
export type GitProvider = GitProviderAdminSummary;
