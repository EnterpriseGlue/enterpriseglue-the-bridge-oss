import {
  UserAuditResponseSchema,
  UserDirectoryListResponseSchema,
  UserEffectiveAccessResponseSchema,
  UserIdentityContextSchema,
  UserLifecycleMutationResponseSchema,
  UserSessionsResponseSchema,
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

function forRequestedUser<T extends { userId: string }>(userId: string, response: T): T {
  if (response.userId !== userId) throw new Error('User directory response does not match the requested user');
  return response;
}

export const userDirectoryApi = {
  list: async (filters: UserDirectoryFilters = {}) =>
    UserDirectoryListResponseSchema.parse(await apiClient.get('/api/users/directory', filters)),
  identityContext: async (userId: string) => {
    const response = UserIdentityContextSchema.parse(await apiClient.get(`/api/users/${encodeURIComponent(userId)}/identity-context`));
    if (response.user.id !== userId) throw new Error('User directory response does not match the requested user');
    return response;
  },
  effectiveAccess: async (userId: string) => forRequestedUser(userId,
    UserEffectiveAccessResponseSchema.parse(await apiClient.get(`/api/users/${encodeURIComponent(userId)}/effective-access`))),
  sessions: async (userId: string) => forRequestedUser(userId,
    UserSessionsResponseSchema.parse(await apiClient.get(`/api/users/${encodeURIComponent(userId)}/sessions`))),
  audit: async (userId: string, limit = 50) => forRequestedUser(userId,
    UserAuditResponseSchema.parse(await apiClient.get(`/api/users/${encodeURIComponent(userId)}/audit`, { limit }))),
  deactivate: async (userId: string, reason: string) => forRequestedUser(userId,
    UserLifecycleMutationResponseSchema.parse(await apiClient.post(`/api/users/${encodeURIComponent(userId)}/deactivate`, { reason }))),
  reactivate: async (userId: string, reason: string) => forRequestedUser(userId,
    UserLifecycleMutationResponseSchema.parse(await apiClient.post(`/api/users/${encodeURIComponent(userId)}/reactivate`, { reason }))),
  revokeSessions: async (userId: string, reason: string) => forRequestedUser(userId,
    UserLifecycleMutationResponseSchema.parse(await apiClient.post(`/api/users/${encodeURIComponent(userId)}/revoke-sessions`, { reason }))),
};
