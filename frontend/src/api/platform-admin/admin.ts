/**
 * Platform Admin API
 * Platform administration endpoints
 */

import { apiClient } from '../../shared/api/client';

// Types
export interface EnvironmentTag {
  id: string;
  name: string;
  color: string;
  manualDeployAllowed: boolean;
  sortOrder: number;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PlatformSettings {
  defaultEnvironmentTagId: string | null;
  syncPushEnabled: boolean;
  syncPullEnabled: boolean;
  gitProjectTokenSharingEnabled: boolean;
  defaultDeployRoles: string[];
  inviteAllowAllDomains: boolean;
  inviteAllowedDomains: string[];
}

export interface UserListItem {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  platformRole?: string;
  isActive: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface ProjectGovernanceItem {
  id: string;
  name: string;
  ownerEmail: string | null;
  ownerName: string | null;
  delegateEmail: string | null;
  delegateName: string | null;
  createdAt: number;
}

export interface EngineGovernanceItem {
  id: string;
  name: string;
  type: string;
  ownerEmail: string | null;
  ownerName: string | null;
  delegateEmail: string | null;
  delegateName: string | null;
  createdAt: number;
}

// API
export const platformAdminApi = {
  // Platform Settings
  getSettings: () =>
    apiClient.get<PlatformSettings>('/api/admin/settings'),

  updateSettings: (data: Partial<PlatformSettings>) =>
    apiClient.put<{ success: boolean }>('/api/admin/settings', data),

  // Environment Tags
  getEnvironments: () =>
    apiClient.get<EnvironmentTag[]>('/api/admin/environments'),

  createEnvironment: (data: { name: string; color?: string; manualDeployAllowed?: boolean }) =>
    apiClient.post<EnvironmentTag>('/api/admin/environments', data),

  updateEnvironment: (id: string, data: Partial<{ name: string; color: string; manualDeployAllowed: boolean; isDefault: boolean }>) =>
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

  updateGitProvider: (id: string, data: Partial<GitProvider>) =>
    apiClient.put<GitProvider>(`/git-api/admin/providers/${id}`, data),
};

// Git Provider type
export interface GitProvider {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  apiUrl: string;
  customBaseUrl: string | null;
  customApiUrl: string | null;
  isActive: boolean;
  displayOrder: number;
  supportsOAuth: boolean;
  supportsPAT: boolean;
  projectConnectionsCount?: number;
  gitConnectionsCount?: number;
  hasProjectConnections?: boolean;
  hasGitConnections?: boolean;
}
