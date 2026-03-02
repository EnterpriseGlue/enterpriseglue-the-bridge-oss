/**
 * React Query hooks for Platform Authorization API
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';

// Types
export interface SsoClaimsMapping {
  id: string;
  providerId: string | null;
  claimType: 'group' | 'role' | 'email_domain' | 'custom';
  claimKey: string;
  claimValue: string;
  targetRole: 'admin' | 'developer' | 'user';
  priority: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PolicyCondition {
  timeWindow?: {
    start?: string;
    end?: string;
    timezone?: string;
    daysOfWeek?: number[];
  };
  userAttribute?: {
    key: string;
    operator: 'eq' | 'neq' | 'in' | 'notIn' | 'contains';
    value: string | string[];
  };
  resourceAttribute?: {
    key: string;
    operator: 'eq' | 'neq' | 'in' | 'notIn';
    value: string | string[] | boolean;
  };
  environment?: {
    ipRange?: string[];
    requireMfa?: boolean;
  };
}

export interface AuthzPolicy {
  id: string;
  name: string;
  description?: string;
  effect: 'allow' | 'deny';
  priority: number;
  resourceType?: string;
  action?: string;
  conditions: PolicyCondition;
  isActive: boolean;
}

export interface AuthzAuditEntry {
  id: string;
  userId: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  decision: 'allow' | 'deny';
  reason: string;
  policyId: string | null;
  context: string;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: number;
}

// Query keys
export const authzQueryKeys = {
  ssoMappings: ['platform-admin', 'authz', 'sso-mappings'] as const,
  policies: ['platform-admin', 'authz', 'policies'] as const,
  auditLog: (params?: Record<string, any>) => ['platform-admin', 'authz', 'audit', params] as const,
};

// ============================================================================
// SSO Claims Mapping Hooks
// ============================================================================

export function useSsoClaimsMappings() {
  return useQuery({
    queryKey: authzQueryKeys.ssoMappings,
    queryFn: () => apiClient.get<SsoClaimsMapping[]>('/api/authz/sso-mappings'),
  });
}

export function useCreateSsoMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<SsoClaimsMapping, 'id' | 'createdAt' | 'updatedAt'>) =>
      apiClient.post<{ id: string }>('/api/authz/sso-mappings', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: authzQueryKeys.ssoMappings }),
  });
}

export function useUpdateSsoMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<SsoClaimsMapping> & { id: string }) =>
      apiClient.put<void>(`/api/authz/sso-mappings/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: authzQueryKeys.ssoMappings }),
  });
}

export function useDeleteSsoMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/authz/sso-mappings/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: authzQueryKeys.ssoMappings }),
  });
}

export function useTestSsoMapping() {
  return useMutation({
    mutationFn: (data: { claims: Record<string, any>; providerId?: string }) =>
      apiClient.post<{ resolvedRole: string; matchedMappings: Array<{ id: string; name: string; targetRole: string }> }>(
        '/api/authz/sso-mappings/test',
        data
      ),
  });
}

// ============================================================================
// Authorization Policy Hooks
// ============================================================================

export function useAuthzPolicies() {
  return useQuery({
    queryKey: authzQueryKeys.policies,
    queryFn: () => apiClient.get<AuthzPolicy[]>('/api/authz/policies'),
  });
}

export function useCreatePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<AuthzPolicy, 'id' | 'isActive'>) =>
      apiClient.post<{ id: string }>('/api/authz/policies', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: authzQueryKeys.policies }),
  });
}

export function useUpdatePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<AuthzPolicy> & { id: string }) =>
      apiClient.put<void>(`/api/authz/policies/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: authzQueryKeys.policies }),
  });
}

export function useDeletePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/authz/policies/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: authzQueryKeys.policies }),
  });
}

// ============================================================================
// Authorization Check Hooks
// ============================================================================

export function useCheckPermission() {
  return useMutation({
    mutationFn: (data: {
      action: string;
      resourceType?: string;
      resourceId?: string;
      userAttributes?: Record<string, any>;
      resourceAttributes?: Record<string, any>;
    }) =>
      apiClient.post<{
        allowed: boolean;
        decision: 'allow' | 'deny';
        reason: string;
        policyId?: string;
        policyName?: string;
      }>('/api/authz/check', data),
  });
}

// ============================================================================
// Audit Log Hooks
// ============================================================================

export function useAuthzAuditLog(params?: {
  userId?: string;
  resourceType?: string;
  resourceId?: string;
  decision?: 'allow' | 'deny';
  limit?: number;
  offset?: number;
}) {
  const searchParams = new URLSearchParams();
  if (params?.userId) searchParams.set('userId', params.userId);
  if (params?.resourceType) searchParams.set('resourceType', params.resourceType);
  if (params?.resourceId) searchParams.set('resourceId', params.resourceId);
  if (params?.decision) searchParams.set('decision', params.decision);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));

  const queryString = searchParams.toString();
  const url = `/api/authz/audit${queryString ? `?${queryString}` : ''}`;

  return useQuery({
    queryKey: authzQueryKeys.auditLog(params),
    queryFn: () => apiClient.get<AuthzAuditEntry[]>(url),
  });
}
