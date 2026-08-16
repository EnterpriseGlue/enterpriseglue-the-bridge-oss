import type {
  UserAuditResponse,
  UserDirectoryListResponse,
  UserEffectiveAccessResponse,
  UserIdentityContext,
  UserLifecycleMutationResponse,
  UserSessionsResponse,
} from '@enterpriseglue/shared/schemas/platform-admin/user-directory.js';
import { apiClient } from '../../shared/api/client';

export interface UserDirectoryFilters {
  search?: string;
  status?: 'invited' | 'active' | 'locked' | 'deactivated';
  authenticationSource?: 'none' | 'local' | 'oidc' | 'saml' | 'ldap' | 'recovery';
  provisioningSource?: 'none' | 'jit' | 'scim' | 'ldap';
  provisioningDirectoryKey?: string;
  limit?: number;
  offset?: number;
}

export const userDirectoryApi = {
  list: (filters: UserDirectoryFilters = {}) =>
    apiClient.get<UserDirectoryListResponse>('/api/users/directory', filters),
  identityContext: (userId: string) =>
    apiClient.get<UserIdentityContext>(`/api/users/${encodeURIComponent(userId)}/identity-context`),
  effectiveAccess: (userId: string) =>
    apiClient.get<UserEffectiveAccessResponse>(`/api/users/${encodeURIComponent(userId)}/effective-access`),
  sessions: (userId: string) =>
    apiClient.get<UserSessionsResponse>(`/api/users/${encodeURIComponent(userId)}/sessions`),
  audit: (userId: string, limit = 50) =>
    apiClient.get<UserAuditResponse>(`/api/users/${encodeURIComponent(userId)}/audit`, { limit }),
  deactivate: (userId: string, reason: string) =>
    apiClient.post<UserLifecycleMutationResponse>(`/api/users/${encodeURIComponent(userId)}/deactivate`, { reason }),
  reactivate: (userId: string, reason: string) =>
    apiClient.post<UserLifecycleMutationResponse>(`/api/users/${encodeURIComponent(userId)}/reactivate`, { reason }),
  revokeSessions: (userId: string, reason: string) =>
    apiClient.post<UserLifecycleMutationResponse>(`/api/users/${encodeURIComponent(userId)}/revoke-sessions`, { reason }),
};
