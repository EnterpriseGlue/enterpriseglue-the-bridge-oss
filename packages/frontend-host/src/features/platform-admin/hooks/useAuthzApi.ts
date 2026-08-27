/**
 * React Query hooks for Platform Authorization API
 */

import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query';
import type {
  AuthzCreatedIdResponse as SharedAuthzCreatedIdResponse,
  AuthzGroupCreate as SharedAuthzGroupCreate,
  AuthzGroupMembershipCreate as SharedAuthzGroupMembershipCreate,
  AuthzGroupUpdate as SharedAuthzGroupUpdate,
  AuthzMutationSuccessResponse as SharedAuthzMutationSuccessResponse,
  AuthzPrincipalType as SharedAuthzPrincipalType,
  BridgeDecisionRequest as SharedBridgeDecisionRequest,
  BridgeDecisionResponse as SharedBridgeDecisionResponse,
  AuthzGroup as SharedAuthzGroup,
  AuthzGroupMembership as SharedAuthzGroupMembership,
  AuthzGroupSource as SharedAuthzGroupSource,
  AuthzOwnershipMode as SharedAuthzOwnershipMode,
  AuthzAuditLogResponse as SharedAuthzAuditLogResponse,
  AuthzAuditQuery as SharedAuthzAuditQuery,
  AuthzCheckRequest as SharedAuthzCheckRequest,
  AuthzCheckResponse as SharedAuthzCheckResponse,
  AuthzPolicyCreate as SharedAuthzPolicyCreate,
  AuthzPolicyResponse as SharedAuthzPolicyResponse,
  AuthzPolicyUpdate as SharedAuthzPolicyUpdate,
  AuthzResourceType as SharedAuthzResourceType,
  ApiClient as SharedApiClient,
  ApiClientWithToken as SharedApiClientWithToken,
  CurrentUserPermissions as SharedCurrentUserPermissions,
  CustomPermissionCreate as SharedCustomPermissionCreate,
  CustomPermissionCreateResponse as SharedCustomPermissionCreateResponse,
  CustomRoleCreate as SharedCustomRoleCreate,
  CustomRoleUpdate as SharedCustomRoleUpdate,
  DeploymentEligibilityEvaluateResponse as SharedDeploymentEligibilityEvaluateResponse,
  EffectiveAccessEvaluateResponse,
  EngineSetDetail as SharedEngineSetDetail,
  EngineSetCreate as SharedEngineSetCreate,
  EngineSetMaterializationResult as SharedEngineSetMaterializationResult,
  EngineSetPreview as SharedEngineSetPreview,
  EngineSetSelector as SharedEngineSetSelector,
  EngineSetSummary as SharedEngineSetSummary,
  EngineSetUpdate as SharedEngineSetUpdate,
  EngineCapabilityStatus as SharedEngineCapabilityStatus,
  EngineFieldOwnership as SharedEngineFieldOwnership,
  EngineLifecycleStatus as SharedEngineLifecycleStatus,
  EngineManagementMode as SharedEngineManagementMode,
  EngineRuntimeQueryCapabilities as SharedEngineRuntimeQueryCapabilities,
  ExternalEngineCapabilities as SharedExternalEngineCapabilities,
  ExternalEngineCapabilityDiagnostics as SharedExternalEngineCapabilityDiagnostics,
  ExternalEngineDecommissionResponse as SharedExternalEngineDecommissionResponse,
  ExternalEngineMaterializationDiagnostics as SharedExternalEngineMaterializationDiagnostics,
  ExternalEngineReactivateResponse as SharedExternalEngineReactivateResponse,
  ExternalEngineReconcileResponse as SharedExternalEngineReconcileResponse,
  ExternalEngineRegistration as SharedExternalEngineRegistration,
  ExternalEngineRegistrationAuditEntry as SharedExternalEngineRegistrationAuditEntry,
  ExternalEngineRegistrationAuditAction as SharedExternalEngineRegistrationAuditAction,
  ExternalEngineRegistrationAuditQuery as SharedExternalEngineRegistrationAuditQuery,
  ExternalEngineSystem as SharedExternalEngineSystem,
  ExternalEngineSystemCreate as SharedExternalEngineSystemCreate,
  ExternalEngineSystemUpdate as SharedExternalEngineSystemUpdate,
  IdentityMappingResponse,
  IdentityProviderConnectionTestResponse,
  IdentityProviderExternalIdentityUnlinkResponse,
  IdentityProviderMembershipReplayResponse,
  IdentityProviderReconciliationPreview,
  IdentityProviderResponse,
  PermissionCatalogEntry as SharedPermissionCatalogEntry,
  ProjectEngineTarget as SharedProjectEngineTarget,
  ProjectEngineTargetMode as SharedProjectEngineTargetMode,
  ProjectEngineTargetCreate as SharedProjectEngineTargetCreate,
  ProjectEngineTargetSyncLegacyResponse as SharedProjectEngineTargetSyncLegacyResponse,
  ProjectEngineTargetUpdate as SharedProjectEngineTargetUpdate,
  PolicyCondition as SharedPolicyCondition,
  RoleAssignment as SharedRoleAssignment,
  RoleAssignmentCreate as SharedRoleAssignmentCreate,
  RoleAssignmentCreateResponse as SharedRoleAssignmentCreateResponse,
  RoleAssignmentSource as SharedRoleAssignmentSource,
  RoleDetail as SharedRoleDetail,
  RoleSummary as SharedRoleSummary,
  RuntimeResource as SharedRuntimeResource,
  RuntimeResourceSet as SharedRuntimeResourceSet,
  RuntimeResourceSetMaterializationResult as SharedRuntimeResourceSetMaterializationResult,
  ServiceAccount as SharedServiceAccount,
  ServiceAccountWithToken as SharedServiceAccountWithToken,
  SsoSyncDiagnosticsRunRequest as SharedSsoSyncDiagnosticsRunRequest,
  SsoSyncDiagnosticsScanResult as SharedSsoSyncDiagnosticsScanResult,
  SsoSyncEventsQuery as SharedSsoSyncEventsQuery,
  SsoSyncRunsQuery as SharedSsoSyncRunsQuery,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';
import { CurrentUserPermissionsSchema } from '@enterpriseglue/shared/schemas/platform-admin/authz.js';
import type { EngineMetadataReconciliationResult as SharedEngineMetadataReconciliationResult } from '@enterpriseglue/shared/schemas/platform-admin/deployment-receipt.js';
import type {
  ConfigBundleApplyReconciliation,
  ConfigBundleApplyResult,
  ConfigBundleApplyRun,
  ConfigBundleApplyRunChange,
  ConfigBundleBootstrapStatus,
  ConfigBundleDiffChange,
  ConfigBundleDiffResponse,
  ConfigBundleIdentityReplayTask,
  ConfigBundleIdentitySnapshot,
  ConfigBundlePreviewResponse,
  ConfigBundleRuntimeReconciliation,
  ConfigBundleRuntimeReconciliationTask,
  ConfigBundleSecretPreflightResponse,
  GovernanceOwnershipReceipt,
  GovernanceOwnershipState,
} from '@enterpriseglue/shared/schemas/platform-admin/config-bundle.js';
import type {
  IdentityProviderAuthenticationMode,
  IdentityProviderType as IdentityProviderProtocol,
  IdentitySyncEvent as SharedIdentitySyncEvent,
  IdentitySyncRun as SharedIdentitySyncRun,
} from '@enterpriseglue/shared/schemas/platform-admin/identity.js';
import { apiClient } from '../../../shared/api/client';
import { fetchList } from '../../../shared/api/fetchList';

export type {
  ConfigBundleApplyReconciliation,
  ConfigBundleApplyResult,
  ConfigBundleApplyRun,
  ConfigBundleApplyRunChange,
  ConfigBundleBootstrapStatus,
  ConfigBundleDiffChange,
  ConfigBundleDiffResponse,
  ConfigBundleIdentityReplayTask,
  ConfigBundleIdentitySnapshot,
  ConfigBundlePreviewResponse,
  ConfigBundleRuntimeReconciliation,
  ConfigBundleRuntimeReconciliationTask,
  ConfigBundleSecretPreflightResponse,
  GovernanceOwnershipReceipt,
  GovernanceOwnershipState,
};

// Types
export type AuthzResourceType = SharedAuthzResourceType;
export type AuthzPrincipalType = SharedAuthzPrincipalType;
export type RoleAssignmentSource = SharedRoleAssignmentSource;

export type PermissionCatalogEntry = SharedPermissionCatalogEntry;

export type CurrentUserPermissions = SharedCurrentUserPermissions;

export type RoleSummary = SharedRoleSummary;
export type RoleDetail = SharedRoleDetail;

export type CreateCustomRolePayload = SharedCustomRoleCreate;
export type CreateCustomPermissionPayload = SharedCustomPermissionCreate;
/** The API path owns the role id; the request body remains the shared schema. */
export type UpdateCustomRolePayload = SharedCustomRoleUpdate & { id: string };

export type RoleAssignment = SharedRoleAssignment;
export type RoleAssignmentCreate = SharedRoleAssignmentCreate;
export type AuthzCreatedIdResponse = SharedAuthzCreatedIdResponse;
export type AuthzMutationSuccessResponse = SharedAuthzMutationSuccessResponse;
export type CustomPermissionCreateResponse = SharedCustomPermissionCreateResponse;
export type RoleAssignmentCreateResponse = SharedRoleAssignmentCreateResponse;
export type AuthzGroupSource = SharedAuthzGroupSource;
export type AuthzOwnershipMode = SharedAuthzOwnershipMode;
export type AuthzGroup = SharedAuthzGroup;
export type AuthzGroupMembership = SharedAuthzGroupMembership;
export type AuthzGroupCreate = SharedAuthzGroupCreate;
export type AuthzGroupUpdate = SharedAuthzGroupUpdate;
export type AuthzGroupMembershipCreate = SharedAuthzGroupMembershipCreate;

export type ApiClient = SharedApiClient;
export type ApiClientWithToken = SharedApiClientWithToken;
export type ServiceAccount = SharedServiceAccount;
export type ServiceAccountWithToken = SharedServiceAccountWithToken;

export type EngineManagementMode = SharedEngineManagementMode;
export type EngineLifecycleStatus = SharedEngineLifecycleStatus;
export type EngineCapabilityStatus = SharedEngineCapabilityStatus;
export type EngineFieldOwnership = SharedEngineFieldOwnership;
export type EngineRuntimeQueryCapabilities = SharedEngineRuntimeQueryCapabilities;
export type ExternalEngineCapabilities = SharedExternalEngineCapabilities;
export type ExternalEngineCapabilityDiagnostics = SharedExternalEngineCapabilityDiagnostics;
export type ExternalEngineMaterializationDiagnostics = SharedExternalEngineMaterializationDiagnostics;
export type ExternalEngineSystem = SharedExternalEngineSystem;

export type ExternalEngineSystemCreatePayload = SharedExternalEngineSystemCreate;
export type ExternalEngineSystemUpdatePayload = SharedExternalEngineSystemUpdate;

export type ExternalEngineRegistration = SharedExternalEngineRegistration;
export type ExternalEngineRegistrationAuditEntry = SharedExternalEngineRegistrationAuditEntry;

export type ExternalEngineAuditAction = SharedExternalEngineRegistrationAuditAction;
export type ExternalEngineAuditParams = SharedExternalEngineRegistrationAuditQuery;

export type ExternalEngineDecommissionResponse = SharedExternalEngineDecommissionResponse;
export type ExternalEngineReactivateResponse = SharedExternalEngineReactivateResponse;
export type ExternalEngineReconcileResponse = SharedExternalEngineReconcileResponse;

export type EngineSetSelector = SharedEngineSetSelector;
export type EngineSetCreate = SharedEngineSetCreate;
export type EngineSetUpdate = SharedEngineSetUpdate;
export type EngineSetSummary = SharedEngineSetSummary;
export type EngineSetDetail = SharedEngineSetDetail;
export type EngineSetPreview = SharedEngineSetPreview;
export type EngineSetMaterializationResult = SharedEngineSetMaterializationResult;

export type ProjectEngineTargetMode = SharedProjectEngineTargetMode;
export type ProjectEngineTargetStatus = SharedProjectEngineTarget['status'];
export type ProjectEngineTargetSource = SharedProjectEngineTarget['source'];
export type ProjectEngineTargetApprovalStatus = SharedProjectEngineTarget['approvalStatus'];
export type ProjectEngineTarget = SharedProjectEngineTarget;
export type ProjectEngineTargetCreate = SharedProjectEngineTargetCreate;
export type ProjectEngineTargetUpdate = SharedProjectEngineTargetUpdate & { id: string };
export type ProjectEngineTargetSyncLegacyResponse = SharedProjectEngineTargetSyncLegacyResponse;

export type DeploymentEligibilityResult = SharedDeploymentEligibilityEvaluateResponse;

export type HumanIdentityEntitlementType = IdentityMappingResponse['entitlementType'];
export type IdentityEntitlementMapping = IdentityMappingResponse;

export type EffectiveAccessResult = EffectiveAccessEvaluateResponse;
export type RuntimeResourceKind = SharedRuntimeResource['resourceKind'];
export type RuntimeResource = SharedRuntimeResource;
export type RuntimeResourceSet = SharedRuntimeResourceSet;
export type RuntimeResourceSetMaterializationResult = SharedRuntimeResourceSetMaterializationResult;
export type RuntimeResourceReconciliationResult = SharedEngineMetadataReconciliationResult;

export type { IdentityProviderAuthenticationMode, IdentityProviderProtocol };
export type IdentityProvider = IdentityProviderResponse;
export type IdentityProviderExternalIdentityUnlinkResult = IdentityProviderExternalIdentityUnlinkResponse;
export type IdentityProviderMembershipReplayResult = IdentityProviderMembershipReplayResponse;
export type IdentityProviderMembershipPreviewResult = IdentityProviderReconciliationPreview;
export type IdentityProviderConnectionTestResult = IdentityProviderConnectionTestResponse;

export type PolicyCondition = SharedPolicyCondition;
/** The policy list endpoint intentionally omits persistence-only metadata. */
export type AuthzPolicy = SharedAuthzPolicyResponse;
export type AuthzPolicyCreate = SharedAuthzPolicyCreate;
export type AuthzPolicyUpdate = SharedAuthzPolicyUpdate;
export type AuthzCheckRequest = SharedAuthzCheckRequest;
export type AuthzCheckResponse = SharedAuthzCheckResponse;

export type AuthzAuditEntry = SharedAuthzAuditLogResponse;

export type SsoSyncRun = SharedIdentitySyncRun;
export type SsoSyncEvent = SharedIdentitySyncEvent;

export type SsoSyncRunParams = SharedSsoSyncRunsQuery;
export type SsoSyncEventParams = SharedSsoSyncEventsQuery;
export type SsoSyncDiagnosticsRunPayload = SharedSsoSyncDiagnosticsRunRequest;
export type SsoSyncDiagnosticsScanResult = SharedSsoSyncDiagnosticsScanResult;

export type BridgeDecisionPayload = SharedBridgeDecisionRequest;
export type BridgeDecisionResponse = SharedBridgeDecisionResponse;

// Query keys
export const authzQueryKeys = {
  identityProviders: ['platform-admin', 'authz', 'identity-providers'] as const,
  identityEntitlementMappings: ['platform-admin', 'authz', 'identity-entitlement-mappings'] as const,
  ssoSyncRuns: (params?: SsoSyncRunParams) => ['platform-admin', 'authz', 'sso-sync-runs', params] as const,
  ssoSyncEvents: (runId?: string, params?: SsoSyncEventParams) => ['platform-admin', 'authz', 'sso-sync-runs', runId, 'events', params] as const,
  myPermissions: ['platform-admin', 'authz', 'me', 'permissions'] as const,
  permissions: ['platform-admin', 'authz', 'permissions'] as const,
  roles: ['platform-admin', 'authz', 'roles'] as const,
  roleDetail: (id?: string) => ['platform-admin', 'authz', 'roles', id] as const,
  roleAssignments: (params?: Record<string, any>) => ['platform-admin', 'authz', 'role-assignments', params] as const,
  groups: (params?: Record<string, any>) => ['platform-admin', 'authz', 'groups', params] as const,
  groupMemberships: (params?: Record<string, any>) => ['platform-admin', 'authz', 'group-memberships', params] as const,
  apiClients: ['platform-admin', 'authz', 'api-clients'] as const,
  serviceAccounts: (params?: Record<string, any>) => ['platform-admin', 'authz', 'service-accounts', params] as const,
  externalEngineSystems: ['platform-admin', 'authz', 'external-engine-systems'] as const,
  externalEngines: ['platform-admin', 'authz', 'external-engines'] as const,
  externalEngineAudit: (id?: string, params?: ExternalEngineAuditParams) => ['platform-admin', 'authz', 'external-engines', id, 'audit', params] as const,
  engineSets: (params?: Record<string, any>) => ['platform-admin', 'authz', 'engine-sets', params] as const,
  engineSet: (id?: string) => ['platform-admin', 'authz', 'engine-sets', 'detail', id] as const,
  runtimeResources: (engineId?: string, options?: { resourceKind?: RuntimeResourceKind; includeInactive?: boolean }) => ['platform-admin', 'authz', 'runtime-resources', engineId, options] as const,
  runtimeResourceSets: (engineId?: string, options?: { includeArchived?: boolean }) => ['platform-admin', 'authz', 'runtime-resource-sets', engineId, options] as const,
  configBundleRuns: (limit = 25) => ['platform-admin', 'authz', 'config-bundles', 'runs', limit] as const,
  configBundleRun: (id?: string) => ['platform-admin', 'authz', 'config-bundles', 'runs', id] as const,
  configBundleIdentityReplayTasks: (runId?: string) => ['platform-admin', 'authz', 'config-bundles', 'runs', runId, 'identity-replay-tasks'] as const,
  configBundleRuntimeReconciliationTasks: (runId?: string) => ['platform-admin', 'authz', 'config-bundles', 'runs', runId, 'runtime-reconciliation-tasks'] as const,
  governanceOwnership: ['platform-admin', 'authz', 'config-bundles', 'governance-ownership'] as const,
  governanceOwnershipReceipts: (limit = 25) => ['platform-admin', 'authz', 'config-bundles', 'governance-ownership', 'receipts', limit] as const,
  projectEngineTargets: (params?: Record<string, any>) => ['platform-admin', 'authz', 'project-engine-targets', params] as const,
  projectEngineTarget: (id?: string) => ['platform-admin', 'authz', 'project-engine-targets', 'detail', id] as const,
  policies: ['platform-admin', 'authz', 'policies'] as const,
  auditLog: (params?: Record<string, any>) => ['platform-admin', 'authz', 'audit', params] as const,
};

export function useCurrentUserPermissions() {
  return useQuery({
    queryKey: authzQueryKeys.myPermissions,
    queryFn: async () => CurrentUserPermissionsSchema.parse(await apiClient.get<unknown>('/api/authz/me/permissions')),
  });
}

export function usePermissionCatalog(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: authzQueryKeys.permissions,
    queryFn: () => fetchList<PermissionCatalogEntry>('/api/authz/permissions'),
    enabled: options.enabled ?? true,
  });
}

export function useCreateCustomPermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCustomPermissionPayload) => apiClient.post<CustomPermissionCreateResponse>('/api/authz/permissions', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: authzQueryKeys.permissions }),
  });
}

export function useRbacRoles(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: authzQueryKeys.roles,
    queryFn: () => fetchList<RoleSummary>('/api/authz/roles'),
    enabled: options.enabled ?? true,
  });
}

export function useRoleDetail(id?: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: authzQueryKeys.roleDetail(id),
    queryFn: () => apiClient.get<RoleDetail>(`/api/authz/roles/${id}`),
    enabled: Boolean(id) && (options.enabled ?? true),
  });
}

export function useRoleDetails(ids: string[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: authzQueryKeys.roleDetail(id),
      queryFn: () => apiClient.get<RoleDetail>(`/api/authz/roles/${id}`),
      enabled: Boolean(id),
    })),
  });
}

export function useCreateCustomRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCustomRolePayload) => apiClient.post<AuthzCreatedIdResponse>('/api/authz/roles', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: authzQueryKeys.roles }),
  });
}

export function useUpdateCustomRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateCustomRolePayload) => apiClient.put<AuthzMutationSuccessResponse>(`/api/authz/roles/${id}`, data),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: authzQueryKeys.roles });
      qc.invalidateQueries({ queryKey: authzQueryKeys.roleDetail(variables.id) });
    },
  });
}

export function useArchiveCustomRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/authz/roles/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: authzQueryKeys.roles });
      qc.invalidateQueries({ queryKey: authzQueryKeys.roleAssignments() });
    },
  });
}

export function useEvaluateAccess() {
  return useMutation({
    mutationFn: (data: {
      userId: string;
      permission: string;
      resourceType?: AuthzResourceType;
      resourceId?: string;
      runtimeResource?: {
        engineId: string;
        resourceKind: 'process_definition' | 'decision_definition';
        resourceKey: string;
        runtimeTenantId?: string;
      };
    }) =>
      apiClient.post<EffectiveAccessResult>('/api/authz/evaluate', data),
  });
}

export function useRoleAssignments(params?: {
  principalType?: AuthzPrincipalType;
  principalId?: string;
  resourceType?: AuthzResourceType;
  resourceId?: string;
  scopeType?: AuthzResourceType;
  scopeId?: string;
}, options?: { enabled?: boolean }) {
  const searchParams = new URLSearchParams();
  if (params?.principalType) searchParams.set('principalType', params.principalType);
  if (params?.principalId) searchParams.set('principalId', params.principalId);
  if (params?.resourceType) searchParams.set('resourceType', params.resourceType);
  if (params?.resourceId) searchParams.set('resourceId', params.resourceId);
  if (params?.scopeType) searchParams.set('scopeType', params.scopeType);
  if (params?.scopeId) searchParams.set('scopeId', params.scopeId);

  const queryString = searchParams.toString();
  const url = `/api/authz/role-assignments${queryString ? `?${queryString}` : ''}`;

  return useQuery({
    queryKey: authzQueryKeys.roleAssignments(params),
    queryFn: () => fetchList<RoleAssignment>(url),
    enabled: options?.enabled ?? true,
  });
}

export function useAssignRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: RoleAssignmentCreate) =>
      apiClient.post<RoleAssignmentCreateResponse>('/api/authz/role-assignments', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'role-assignments'] }),
  });
}

export function useRemoveRoleAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/authz/role-assignments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'role-assignments'] }),
  });
}

export function useAuthzGroups(params?: { includeArchived?: boolean }, options: { enabled?: boolean } = {}) {
  const searchParams = new URLSearchParams();
  if (params?.includeArchived) searchParams.set('includeArchived', 'true');
  const queryString = searchParams.toString();
  const url = `/api/authz/groups${queryString ? `?${queryString}` : ''}`;
  return useQuery({
    queryKey: authzQueryKeys.groups(params),
    queryFn: () => fetchList<AuthzGroup>(url),
    enabled: options.enabled ?? true,
  });
}

export function useCreateAuthzGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: AuthzGroupCreate) =>
      apiClient.post<AuthzCreatedIdResponse>('/api/authz/groups', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'groups'] }),
  });
}

export function useUpdateAuthzGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: AuthzGroupUpdate & { id: string }) =>
      apiClient.put<AuthzMutationSuccessResponse>(`/api/authz/groups/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'groups'] }),
  });
}

export function useDeleteAuthzGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/authz/groups/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'groups'] }),
  });
}

export function useAuthzGroupMemberships(params?: { groupId?: string; userId?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.groupId) searchParams.set('groupId', params.groupId);
  if (params?.userId) searchParams.set('userId', params.userId);
  const queryString = searchParams.toString();
  const url = `/api/authz/group-memberships${queryString ? `?${queryString}` : ''}`;
  return useQuery({
    queryKey: authzQueryKeys.groupMemberships(params),
    queryFn: () => fetchList<AuthzGroupMembership>(url),
  });
}

export function useAddAuthzGroupMembership() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: AuthzGroupMembershipCreate) =>
      apiClient.post<AuthzCreatedIdResponse>('/api/authz/group-memberships', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-admin', 'authz'] }),
  });
}

export function useRemoveAuthzGroupMembership() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/authz/group-memberships/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-admin', 'authz'] }),
  });
}

export function useApiClients() {
  return useQuery({
    queryKey: authzQueryKeys.apiClients,
    queryFn: () => fetchList<ApiClient>('/api/authz/api-clients'),
  });
}

export function useCreateApiClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; scopes?: string[] }) => apiClient.post<ApiClientWithToken>('/api/authz/api-clients', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: authzQueryKeys.apiClients }),
  });
}

export function useRotateApiClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post<ApiClientWithToken>(`/api/authz/api-clients/${id}/rotate`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: authzQueryKeys.apiClients }),
  });
}

export function useRevokeApiClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/authz/api-clients/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: authzQueryKeys.apiClients }),
  });
}

export function useServiceAccounts(params?: { includeInactive?: boolean }) {
  const searchParams = new URLSearchParams();
  if (params?.includeInactive) searchParams.set('includeInactive', 'true');
  const queryString = searchParams.toString();
  return useQuery({
    queryKey: authzQueryKeys.serviceAccounts(params),
    queryFn: () => fetchList<ServiceAccount>(`/api/authz/service-accounts${queryString ? `?${queryString}` : ''}`),
  });
}

export function useCreateServiceAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string | null; scopes?: string[] }) =>
      apiClient.post<ServiceAccountWithToken>('/api/authz/service-accounts', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'service-accounts'] }),
  });
}

export function useRotateServiceAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post<ServiceAccountWithToken>(`/api/authz/service-accounts/${id}/rotate`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'service-accounts'] }),
  });
}

export function useRevokeServiceAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/authz/service-accounts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'service-accounts'] }),
  });
}

export function useExternalEngines() {
  return useQuery({
    queryKey: authzQueryKeys.externalEngines,
    queryFn: () => fetchList<ExternalEngineRegistration>('/api/authz/external-engines'),
  });
}

export function useExternalEngineSystems() {
  return useQuery({
    queryKey: authzQueryKeys.externalEngineSystems,
    queryFn: () => fetchList<ExternalEngineSystem>('/api/authz/external-engine-systems'),
  });
}

export function useCreateExternalEngineSystem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ExternalEngineSystemCreatePayload) =>
      apiClient.post<ExternalEngineSystem>('/api/authz/external-engine-systems', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: authzQueryKeys.externalEngineSystems }),
  });
}

export function useUpdateExternalEngineSystem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & ExternalEngineSystemUpdatePayload) =>
      apiClient.put<ExternalEngineSystem>(`/api/authz/external-engine-systems/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: authzQueryKeys.externalEngineSystems });
      qc.invalidateQueries({ queryKey: authzQueryKeys.externalEngines });
    },
  });
}

export function useArchiveExternalEngineSystem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/authz/external-engine-systems/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: authzQueryKeys.externalEngineSystems });
      qc.invalidateQueries({ queryKey: authzQueryKeys.externalEngines });
    },
  });
}

export function useExternalEngineAudit(id?: string, params?: ExternalEngineAuditParams) {
  const searchParams = new URLSearchParams();
  if (params?.action && params.action !== 'all') searchParams.set('action', params.action);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const queryString = searchParams.toString();
  return useQuery({
    queryKey: authzQueryKeys.externalEngineAudit(id, params),
    queryFn: () => fetchList<ExternalEngineRegistrationAuditEntry>(`/api/authz/external-engines/${id}/audit${queryString ? `?${queryString}` : ''}`),
    enabled: Boolean(id),
  });
}

export function useDecommissionExternalEngine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      apiClient.post<ExternalEngineDecommissionResponse>(`/api/authz/external-engines/${id}/decommission`, { reason }),
    onSuccess: (_result, { id }) => {
      qc.invalidateQueries({ queryKey: authzQueryKeys.externalEngines });
      qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'external-engines', id, 'audit'] });
      qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'engine-sets'] });
    },
  });
}

export function useReactivateExternalEngine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      apiClient.post<ExternalEngineReactivateResponse>(`/api/authz/external-engines/${id}/reactivate`, { reason }),
    onSuccess: (_result, { id }) => {
      qc.invalidateQueries({ queryKey: authzQueryKeys.externalEngines });
      qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'external-engines', id, 'audit'] });
      qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'engine-sets'] });
    },
  });
}

export function useReconcileExternalEngine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post<ExternalEngineReconcileResponse>(`/api/authz/external-engines/${id}/reconcile`, {}),
    onSuccess: (_result, id) => {
      qc.invalidateQueries({ queryKey: authzQueryKeys.externalEngines });
      qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'external-engines', id, 'audit'] });
      qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'engine-sets'] });
    },
  });
}

export function useEngineSets(params?: { includeArchived?: boolean }, options: { enabled?: boolean } = {}) {
  const searchParams = new URLSearchParams();
  if (params?.includeArchived) searchParams.set('includeArchived', 'true');
  const queryString = searchParams.toString();
  return useQuery({
    queryKey: authzQueryKeys.engineSets(params),
    queryFn: () => fetchList<EngineSetSummary>(`/api/authz/engine-sets${queryString ? `?${queryString}` : ''}`),
    enabled: options.enabled ?? true,
  });
}

export function useEngineSet(id?: string) {
  return useQuery({
    queryKey: authzQueryKeys.engineSet(id),
    queryFn: () => apiClient.get<EngineSetDetail>(`/api/authz/engine-sets/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateEngineSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: EngineSetCreate) =>
      apiClient.post<AuthzCreatedIdResponse>('/api/authz/engine-sets', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'engine-sets'] }),
  });
}

export function useUpdateEngineSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: EngineSetUpdate & { id: string }) =>
      apiClient.put<AuthzMutationSuccessResponse>(`/api/authz/engine-sets/${id}`, data),
    onSuccess: (_result, variables) => {
      qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'engine-sets'] });
      qc.invalidateQueries({ queryKey: authzQueryKeys.engineSet(variables.id) });
    },
  });
}

export function useArchiveEngineSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/authz/engine-sets/${id}`),
    onSuccess: (_result, id) => {
      qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'engine-sets'] });
      qc.invalidateQueries({ queryKey: authzQueryKeys.engineSet(id) });
    },
  });
}

export function useRuntimeResources(engineId?: string, options: { resourceKind?: RuntimeResourceKind; includeInactive?: boolean; enabled?: boolean } = {}) {
  const searchParams = new URLSearchParams();
  if (engineId) searchParams.set('engineId', engineId);
  if (options.resourceKind) searchParams.set('resourceKind', options.resourceKind);
  if (options.includeInactive) searchParams.set('includeInactive', 'true');
  const queryString = searchParams.toString();
  return useQuery({
    queryKey: authzQueryKeys.runtimeResources(engineId, options),
    queryFn: () => fetchList<RuntimeResource>(`/api/authz/runtime-resources?${queryString}`),
    enabled: (options.enabled ?? true) && Boolean(engineId),
  });
}

export function useRuntimeResourceSets(engineId?: string, options: { includeArchived?: boolean; enabled?: boolean } = {}) {
  const searchParams = new URLSearchParams();
  if (engineId) searchParams.set('engineId', engineId);
  if (options.includeArchived) searchParams.set('includeArchived', 'true');
  const queryString = searchParams.toString();
  return useQuery({
    queryKey: authzQueryKeys.runtimeResourceSets(engineId, options),
    queryFn: () => fetchList<RuntimeResourceSet>(`/api/authz/runtime-resource-sets${queryString ? `?${queryString}` : ''}`),
    enabled: options.enabled ?? true,
  });
}

export function useMaterializeRuntimeResourceSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post<RuntimeResourceSetMaterializationResult>(`/api/authz/runtime-resource-sets/${encodeURIComponent(id)}/materialize`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'runtime-resource-sets'] }),
  });
}

export function useReconcileRuntimeResources() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (engineId: string) => apiClient.post<RuntimeResourceReconciliationResult>(`/api/authz/runtime-resources/${encodeURIComponent(engineId)}/reconcile`, {}),
    onSuccess: (_result, engineId) => {
      qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'runtime-resources', engineId] });
      qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'runtime-resource-sets'] });
    },
  });
}

export function useConfigBundleRuns(options: { limit?: number; enabled?: boolean } = {}) {
  const limit = options.limit ?? 25;
  return useQuery({
    queryKey: authzQueryKeys.configBundleRuns(limit),
    queryFn: () => fetchList<ConfigBundleApplyRun>(`/api/authz/config-bundles/runs?limit=${limit}`),
    enabled: options.enabled ?? true,
  });
}

export function useConfigBundleRun(id?: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: authzQueryKeys.configBundleRun(id),
    queryFn: () => apiClient.get<ConfigBundleApplyRun>(`/api/authz/config-bundles/runs/${encodeURIComponent(id!)}`),
    enabled: (options.enabled ?? true) && Boolean(id),
  });
}

export function useConfigBundleIdentityReplayTasks(runId?: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: authzQueryKeys.configBundleIdentityReplayTasks(runId),
    queryFn: () => fetchList<ConfigBundleIdentityReplayTask>(`/api/authz/config-bundles/runs/${encodeURIComponent(runId!)}/identity-replay-tasks`),
    enabled: (options.enabled ?? true) && Boolean(runId),
  });
}

export function useConfigBundleRuntimeReconciliationTasks(runId?: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: authzQueryKeys.configBundleRuntimeReconciliationTasks(runId),
    queryFn: () => fetchList<ConfigBundleRuntimeReconciliationTask>(`/api/authz/config-bundles/runs/${encodeURIComponent(runId!)}/runtime-reconciliation-tasks`),
    enabled: (options.enabled ?? true) && Boolean(runId),
  });
}

export function useGovernanceOwnership(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: authzQueryKeys.governanceOwnership,
    queryFn: () => apiClient.get<GovernanceOwnershipState>('/api/authz/config-bundles/governance-ownership'),
    enabled: options.enabled ?? true,
  });
}

export function useGovernanceOwnershipReceipts(options: { limit?: number; enabled?: boolean } = {}) {
  const limit = options.limit ?? 10;
  return useQuery({
    queryKey: authzQueryKeys.governanceOwnershipReceipts(limit),
    queryFn: () => fetchList<GovernanceOwnershipReceipt>(`/api/authz/config-bundles/governance-ownership/receipts?limit=${limit}`),
    enabled: options.enabled ?? true,
  });
}

export function usePreviewEngineSetSelector() {
  return useMutation({
    mutationFn: (data: { selector: EngineSetSelector }) =>
      apiClient.post<EngineSetPreview>('/api/authz/engine-sets/preview', data),
  });
}

export function useMaterializeEngineSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post<EngineSetMaterializationResult>(`/api/authz/engine-sets/${id}/materialize`, {}),
    onSuccess: (_result, id) => {
      qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'engine-sets'] });
      qc.invalidateQueries({ queryKey: authzQueryKeys.engineSet(id) });
    },
  });
}

export function useProjectEngineTargets(params?: {
  projectId?: string;
  engineId?: string;
  status?: ProjectEngineTargetStatus | 'all';
  source?: ProjectEngineTargetSource;
}) {
  const searchParams = new URLSearchParams();
  if (params?.projectId) searchParams.set('projectId', params.projectId);
  if (params?.engineId) searchParams.set('engineId', params.engineId);
  if (params?.status) searchParams.set('status', params.status);
  if (params?.source) searchParams.set('source', params.source);
  const queryString = searchParams.toString();
  return useQuery({
    queryKey: authzQueryKeys.projectEngineTargets(params),
    queryFn: () => fetchList<ProjectEngineTarget>(`/api/authz/project-engine-targets${queryString ? `?${queryString}` : ''}`),
  });
}

export function useProjectEngineTarget(id?: string) {
  return useQuery({
    queryKey: authzQueryKeys.projectEngineTarget(id),
    queryFn: () => apiClient.get<ProjectEngineTarget>(`/api/authz/project-engine-targets/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateProjectEngineTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ProjectEngineTargetCreate) => apiClient.post<AuthzCreatedIdResponse>('/api/authz/project-engine-targets', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'project-engine-targets'] }),
  });
}

export function useUpdateProjectEngineTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: ProjectEngineTargetUpdate) => apiClient.put<AuthzMutationSuccessResponse>(`/api/authz/project-engine-targets/${id}`, data),
    onSuccess: (_result, variables) => {
      qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'project-engine-targets'] });
      qc.invalidateQueries({ queryKey: authzQueryKeys.projectEngineTarget(variables.id) });
    },
  });
}

export function useArchiveProjectEngineTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/authz/project-engine-targets/${id}`),
    onSuccess: (_result, id) => {
      qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'project-engine-targets'] });
      qc.invalidateQueries({ queryKey: authzQueryKeys.projectEngineTarget(id) });
    },
  });
}

export function useEvaluateDeploymentEligibility() {
  return useMutation({
    mutationFn: (data: { userId: string; projectId: string; engineId: string; mode?: ProjectEngineTargetMode }) =>
      apiClient.post<DeploymentEligibilityResult>('/api/authz/project-engine-targets/evaluate', data),
  });
}

export function useSyncLegacyProjectEngineTargets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { projectId: string }) =>
      apiClient.post<ProjectEngineTargetSyncLegacyResponse>('/api/authz/project-engine-targets/sync-legacy', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'project-engine-targets'] }),
  });
}

// ============================================================================
export function useEvaluateMissionControlStarbaseBridge() {
  return useMutation({
    mutationFn: (data: BridgeDecisionPayload) =>
      apiClient.post<BridgeDecisionResponse>('/api/mission-control/bridge/starbase-edit/evaluate', data),
  });
}

export function useEvaluateStarbaseMissionControlBridge() {
  return useMutation({
    mutationFn: (data: BridgeDecisionPayload) =>
      apiClient.post<BridgeDecisionResponse>('/api/starbase/bridge/mission-control/evaluate', data),
  });
}

export function useSsoSyncRuns(params: SsoSyncRunParams = { limit: 10 }, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: authzQueryKeys.ssoSyncRuns(params),
    queryFn: () => fetchList<SsoSyncRun>('/api/authz/sso-sync-runs', params),
    enabled: options.enabled ?? true,
  });
}

export function useSsoSyncEvents(
  runId?: string,
  params: SsoSyncEventParams = { limit: 50 },
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: authzQueryKeys.ssoSyncEvents(runId, params),
    queryFn: () => fetchList<SsoSyncEvent>(`/api/authz/sso-sync-runs/${runId}/events`, params),
    enabled: Boolean(runId) && (options.enabled ?? true),
  });
}

export function useRunSsoSyncDiagnostics() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: SsoSyncDiagnosticsRunPayload = { trigger: 'manual' }) =>
      apiClient.post<SsoSyncDiagnosticsScanResult>('/api/authz/sso-sync-runs/reconcile', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'sso-sync-runs'] });
    },
  });
}

export function useIdentityProviders(options: { enabled?: boolean } = {}) {
  const tenantScope = typeof window === 'undefined'
    ? 'root'
    : (window.location.pathname.match(/^\/t\/([^/]+)(?:\/|$)/)?.[1] || 'root');
  return useQuery({
    queryKey: [...authzQueryKeys.identityProviders, tenantScope],
    queryFn: () => fetchList<IdentityProvider>('/api/identity/providers'),
    enabled: options.enabled ?? true,
  });
}

export function useIdentityEntitlementMappings(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: authzQueryKeys.identityEntitlementMappings,
    queryFn: () => fetchList<IdentityEntitlementMapping>('/api/identity/mappings'),
    enabled: options.enabled ?? true,
  });
}

// Authorization Policy Hooks
// ============================================================================

export function useAuthzPolicies() {
  return useQuery({
    queryKey: authzQueryKeys.policies,
    queryFn: () => fetchList<AuthzPolicy>('/api/authz/policies'),
  });
}

export function useCreatePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: AuthzPolicyCreate) =>
      apiClient.post<AuthzCreatedIdResponse>('/api/authz/policies', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: authzQueryKeys.policies }),
  });
}

export function useUpdatePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: AuthzPolicyUpdate & { id: string }) =>
      apiClient.put<AuthzMutationSuccessResponse>(`/api/authz/policies/${id}`, data),
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
    mutationFn: (data: AuthzCheckRequest) =>
      apiClient.post<AuthzCheckResponse>('/api/authz/check', data),
  });
}

// ============================================================================
// Audit Log Hooks
// ============================================================================

export function useAuthzAuditLog(params?: SharedAuthzAuditQuery, options?: { enabled?: boolean }) {
  const searchParams = new URLSearchParams();
  if (params?.userId) searchParams.set('userId', params.userId);
  if (params?.action) searchParams.set('action', params.action);
  if (params?.resourceType) searchParams.set('resourceType', params.resourceType);
  if (params?.resourceId) searchParams.set('resourceId', params.resourceId);
  if (params?.decision) searchParams.set('decision', params.decision);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));

  const queryString = searchParams.toString();
  const url = `/api/authz/audit${queryString ? `?${queryString}` : ''}`;

  return useQuery({
    queryKey: authzQueryKeys.auditLog(params),
    queryFn: () => fetchList<AuthzAuditEntry>(url),
    enabled: options?.enabled ?? true,
  });
}
