/**
 * React Query hooks for Platform Authorization API
 */

import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query';
import type {
  AuthzPrincipalType as SharedAuthzPrincipalType,
  BridgeDecisionRequest as SharedBridgeDecisionRequest,
  BridgeDecisionResponse as SharedBridgeDecisionResponse,
  EngineAccessTransitionCleanupApplyResponse as SharedEngineAccessTransitionCleanupApplyResponse,
  EngineAccessTransitionCleanupCandidate as SharedEngineAccessTransitionCleanupCandidate,
  EngineAccessTransitionCleanupPreview as SharedEngineAccessTransitionCleanupPreview,
  AuthzGroup as SharedAuthzGroup,
  AuthzGroupMembership as SharedAuthzGroupMembership,
  AuthzGroupSource as SharedAuthzGroupSource,
  AuthzOwnershipMode as SharedAuthzOwnershipMode,
  AuthzAuditLogEntry as SharedAuthzAuditLogEntry,
  AuthzPolicy as SharedAuthzPolicy,
  AuthzResourceType as SharedAuthzResourceType,
  ApiClient as SharedApiClient,
  ApiClientWithToken as SharedApiClientWithToken,
  CurrentUserPermissions as SharedCurrentUserPermissions,
  CustomPermissionCreate as SharedCustomPermissionCreate,
  CustomRoleCreate as SharedCustomRoleCreate,
  CustomRoleUpdate as SharedCustomRoleUpdate,
  DeploymentEligibilityEvaluateResponse as SharedDeploymentEligibilityEvaluateResponse,
  EffectiveAccessEvaluateResponse,
  EngineSetDetail as SharedEngineSetDetail,
  EngineSetMaterializationResult as SharedEngineSetMaterializationResult,
  EngineSetPreview as SharedEngineSetPreview,
  EngineSetSelector as SharedEngineSetSelector,
  EngineSetSummary as SharedEngineSetSummary,
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
  ExternalEngineSystem as SharedExternalEngineSystem,
  ExternalEngineSystemCreate as SharedExternalEngineSystemCreate,
  ExternalEngineSystemUpdate as SharedExternalEngineSystemUpdate,
  IdentityMappingResponse,
  IdentityProviderConnectionTestResponse,
  IdentityProviderExternalIdentityUnlinkResponse,
  IdentityProviderMembershipReplayResponse,
  IdentityProviderMigrationReadinessResponse,
  IdentityProviderReconciliationPreview,
  IdentityProviderResponse,
  LegacyIdentityProviderCutoverResponse,
  LegacyIdentityProviderMigrationDraft as SharedLegacyIdentityProviderMigrationDraft,
  LegacySsoProviderResponse as SharedLegacySsoProvider,
  LegacyMappingCoverageItem as SharedLegacyMappingCoverageItem,
  LegacyMappingRetirementReadiness as SharedLegacyMappingRetirementReadiness,
  PermissionCatalogEntry as SharedPermissionCatalogEntry,
  ProjectEngineTarget as SharedProjectEngineTarget,
  ProjectEngineTargetCreate as SharedProjectEngineTargetCreate,
  ProjectEngineTargetUpdate as SharedProjectEngineTargetUpdate,
  PolicyCondition as SharedPolicyCondition,
  RoleAssignment as SharedRoleAssignment,
  RoleAssignmentSource as SharedRoleAssignmentSource,
  RoleDetail as SharedRoleDetail,
  RoleSummary as SharedRoleSummary,
  RuntimeResource as SharedRuntimeResource,
  RuntimeResourceSet as SharedRuntimeResourceSet,
  RuntimeResourceSetMaterializationResult as SharedRuntimeResourceSetMaterializationResult,
  ServiceAccount as SharedServiceAccount,
  ServiceAccountWithToken as SharedServiceAccountWithToken,
  SsoAssignmentMapping as SharedSsoAssignmentMapping,
  SsoAssignmentMappingTestResponse as SharedSsoAssignmentMappingTestResponse,
  SsoClaimOperator as SharedSsoClaimOperator,
  SsoClaimsMapping as SharedSsoClaimsMapping,
  SsoEngineAccessSnapshot as SharedSsoEngineAccessSnapshot,
  SsoEngineAccessSnapshotStatus as SharedSsoEngineAccessSnapshotStatus,
  SsoEngineAccessSnapshotQuery as SharedSsoEngineAccessSnapshotQuery,
  SsoGroupMapping as SharedSsoGroupMapping,
  SsoGroupMappingTestResponse as SharedSsoGroupMappingTestResponse,
  SsoMappingTestRequest as SharedSsoMappingTestRequest,
  SsoPlatformMappingTestResponse as SharedSsoPlatformMappingTestResponse,
  SsoSyncDiagnosticsRunRequest as SharedSsoSyncDiagnosticsRunRequest,
  SsoSyncDiagnosticsScanResult as SharedSsoSyncDiagnosticsScanResult,
  SsoSyncEventsQuery as SharedSsoSyncEventsQuery,
  SsoSyncRunsQuery as SharedSsoSyncRunsQuery,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';
import type { EngineMetadataReconciliationResult as SharedEngineMetadataReconciliationResult } from '@enterpriseglue/shared/schemas/platform-admin/deployment-receipt.js';
import type {
  ConfigBundleApplyReconciliation,
  ConfigBundleApplyResult,
  ConfigBundleApplyRun,
  ConfigBundleApplyRunChange,
  ConfigBundleBootstrapStatus,
  ConfigBundleIdentityReplayTask,
  ConfigBundleIdentitySnapshot,
  ConfigBundleRuntimeReconciliation,
  ConfigBundleRuntimeReconciliationTask,
} from '@enterpriseglue/shared/schemas/platform-admin/config-bundle.js';
import type {
  IdentityProviderAuthenticationMode,
  IdentityProviderType as IdentityProviderProtocol,
  IdentitySyncEvent as SharedIdentitySyncEvent,
  IdentitySyncRun as SharedIdentitySyncRun,
} from '@enterpriseglue/shared/schemas/platform-admin/identity.js';
import { apiClient } from '../../../shared/api/client';

export type {
  ConfigBundleApplyReconciliation,
  ConfigBundleApplyResult,
  ConfigBundleApplyRun,
  ConfigBundleApplyRunChange,
  ConfigBundleBootstrapStatus,
  ConfigBundleIdentityReplayTask,
  ConfigBundleIdentitySnapshot,
  ConfigBundleRuntimeReconciliation,
  ConfigBundleRuntimeReconciliationTask,
};

// Types
export type AuthzResourceType = SharedAuthzResourceType;
export type AuthzPrincipalType = SharedAuthzPrincipalType;
export type RoleAssignmentSource = SharedRoleAssignmentSource;
export type SsoClaimOperator = SharedSsoClaimOperator;
/** The legacy API emits `null` for an all-provider mapping; retain it only at this UI boundary. */
export type SsoClaimsMapping = Omit<SharedSsoClaimsMapping, 'providerId'> & {
  providerId: string | null;
  riskAcknowledged?: boolean;
};

export type PermissionCatalogEntry = SharedPermissionCatalogEntry;

export type CurrentUserPermissions = SharedCurrentUserPermissions;

export type RoleSummary = SharedRoleSummary;
export type RoleDetail = SharedRoleDetail;

export type CreateCustomRolePayload = SharedCustomRoleCreate;
export type CreateCustomPermissionPayload = SharedCustomPermissionCreate;
/** The API path owns the role id; the request body remains the shared schema. */
export type UpdateCustomRolePayload = SharedCustomRoleUpdate & { id: string };

export type RoleAssignment = SharedRoleAssignment;
export type AuthzGroupSource = SharedAuthzGroupSource;
export type AuthzOwnershipMode = SharedAuthzOwnershipMode;
export type AuthzGroup = SharedAuthzGroup;
export type AuthzGroupMembership = SharedAuthzGroupMembership;

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

export type ExternalEngineAuditAction =
  | 'all'
  | 'engine.external_registration.create'
  | 'engine.external_registration.update'
  | 'engine.external_registration.decommission'
  | 'engine.external_registration.reactivate'
  | 'engine.external_registration.reconcile';

export interface ExternalEngineAuditParams {
  action?: ExternalEngineAuditAction;
  limit?: number;
}

export type ExternalEngineDecommissionResponse = SharedExternalEngineDecommissionResponse;
export type ExternalEngineReactivateResponse = SharedExternalEngineReactivateResponse;
export type ExternalEngineReconcileResponse = SharedExternalEngineReconcileResponse;

export type EngineSetSelector = SharedEngineSetSelector;
export type EngineSetSummary = SharedEngineSetSummary;
export type EngineSetDetail = SharedEngineSetDetail;
export type EngineSetPreview = SharedEngineSetPreview;
export type EngineSetMaterializationResult = SharedEngineSetMaterializationResult;

export type ProjectEngineTargetMode = 'manual' | 'ci' | 'api' | 'import';
export type ProjectEngineTargetStatus = SharedProjectEngineTarget['status'];
export type ProjectEngineTargetSource = SharedProjectEngineTarget['source'];
export type ProjectEngineTargetApprovalStatus = SharedProjectEngineTarget['approvalStatus'];
export type ProjectEngineTarget = SharedProjectEngineTarget;
export type ProjectEngineTargetCreate = SharedProjectEngineTargetCreate;
export type ProjectEngineTargetUpdate = SharedProjectEngineTargetUpdate & { id: string };

export type DeploymentEligibilityResult = SharedDeploymentEligibilityEvaluateResponse;

/** UI-only acknowledgement retained while legacy mapping forms remain supported. */
export type SsoAssignmentMapping = SharedSsoAssignmentMapping & { riskAcknowledged?: boolean };
/** UI-only acknowledgement retained while legacy mapping forms remain supported. */
export type SsoGroupMapping = SharedSsoGroupMapping & { riskAcknowledged?: boolean };
export type SsoMappingTestRequest = SharedSsoMappingTestRequest;
export type SsoPlatformMappingTestResponse = SharedSsoPlatformMappingTestResponse;
export type SsoAssignmentMappingTestResponse = SharedSsoAssignmentMappingTestResponse;
export type SsoGroupMappingTestResponse = SharedSsoGroupMappingTestResponse;

export type HumanIdentityEntitlementType = IdentityMappingResponse['entitlementType'];
/** `scope` is retained solely to render and retire pre-migration rows. */
export type ListedIdentityEntitlementType = HumanIdentityEntitlementType | 'scope';

export type IdentityEntitlementMapping = Omit<IdentityMappingResponse, 'entitlementType'> & {
  entitlementType: ListedIdentityEntitlementType;
};

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
export type IdentityProviderMigrationReadiness = IdentityProviderMigrationReadinessResponse;
export type LegacyIdentityProviderCutoverResult = LegacyIdentityProviderCutoverResponse;
export type LegacyIdentityProviderMigrationDraft = SharedLegacyIdentityProviderMigrationDraft;
export type LegacySsoProvider = SharedLegacySsoProvider;
export type LegacyMappingCoverageItem = SharedLegacyMappingCoverageItem;
export type LegacyMappingRetirementReadiness = SharedLegacyMappingRetirementReadiness;

export type PolicyCondition = SharedPolicyCondition;
/** The policy list endpoint intentionally omits persistence-only metadata. */
export type AuthzPolicy = Omit<SharedAuthzPolicy, 'tenantId' | 'createdAt' | 'updatedAt' | 'createdById'>;

export type AuthzAuditEntry = Omit<SharedAuthzAuditLogEntry, 'tenantId'>;

export type SsoSyncRun = SharedIdentitySyncRun;
export type SsoSyncEvent = SharedIdentitySyncEvent;

export type SsoSyncRunParams = SharedSsoSyncRunsQuery;
export type SsoSyncEventParams = SharedSsoSyncEventsQuery;
export type SsoSyncDiagnosticsRunPayload = SharedSsoSyncDiagnosticsRunRequest;
export type SsoSyncDiagnosticsScanResult = SharedSsoSyncDiagnosticsScanResult;

export type SsoEngineAccessSnapshotStatus = SharedSsoEngineAccessSnapshotStatus;
export type SsoEngineAccessSnapshot = SharedSsoEngineAccessSnapshot;

export type SsoEngineAccessSnapshotParams = SharedSsoEngineAccessSnapshotQuery;

export type EngineAccessTransitionCleanupCandidate = SharedEngineAccessTransitionCleanupCandidate;

export type EngineAccessTransitionCleanupPreview = SharedEngineAccessTransitionCleanupPreview;
export type EngineAccessTransitionCleanupApplyResult = SharedEngineAccessTransitionCleanupApplyResponse;

export type BridgeDecisionPayload = SharedBridgeDecisionRequest;
export type BridgeDecisionResponse = SharedBridgeDecisionResponse;

// Query keys
export const authzQueryKeys = {
  ssoMappings: ['platform-admin', 'authz', 'sso-mappings'] as const,
  ssoAssignmentMappings: ['platform-admin', 'authz', 'sso-assignment-mappings'] as const,
  ssoEngineAccessSnapshots: (params?: SsoEngineAccessSnapshotParams) => ['platform-admin', 'authz', 'sso-engine-access-snapshots', params] as const,
  ssoEngineAccessSnapshotsForEngine: (engineId?: string) => ['platform-admin', 'authz', 'sso-engine-access-snapshots', 'engine', engineId] as const,
  ssoGroupMappings: ['platform-admin', 'authz', 'sso-group-mappings'] as const,
  identityProviders: ['platform-admin', 'authz', 'identity-providers'] as const,
  identityEntitlementMappings: ['platform-admin', 'authz', 'identity-entitlement-mappings'] as const,
  legacyMappingCoverage: ['platform-admin', 'authz', 'legacy-mapping-coverage'] as const,
  legacyMappingRetirementReadiness: ['platform-admin', 'authz', 'legacy-mapping-retirement-readiness'] as const,
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
  engineSet: (id?: string) => ['platform-admin', 'authz', 'engine-sets', id] as const,
  runtimeResources: (engineId?: string, options?: { resourceKind?: RuntimeResourceKind; includeInactive?: boolean }) => ['platform-admin', 'authz', 'runtime-resources', engineId, options] as const,
  runtimeResourceSets: (engineId?: string, options?: { includeArchived?: boolean }) => ['platform-admin', 'authz', 'runtime-resource-sets', engineId, options] as const,
  configBundleRuns: (limit = 25) => ['platform-admin', 'authz', 'config-bundles', 'runs', limit] as const,
  configBundleRun: (id?: string) => ['platform-admin', 'authz', 'config-bundles', 'runs', id] as const,
  configBundleIdentityReplayTasks: (runId?: string) => ['platform-admin', 'authz', 'config-bundles', 'runs', runId, 'identity-replay-tasks'] as const,
  configBundleRuntimeReconciliationTasks: (runId?: string) => ['platform-admin', 'authz', 'config-bundles', 'runs', runId, 'runtime-reconciliation-tasks'] as const,
  projectEngineTargets: (params?: Record<string, any>) => ['platform-admin', 'authz', 'project-engine-targets', params] as const,
  projectEngineTarget: (id?: string) => ['platform-admin', 'authz', 'project-engine-targets', id] as const,
  policies: ['platform-admin', 'authz', 'policies'] as const,
  auditLog: (params?: Record<string, any>) => ['platform-admin', 'authz', 'audit', params] as const,
};

export function useCurrentUserPermissions() {
  return useQuery({
    queryKey: authzQueryKeys.myPermissions,
    queryFn: () => apiClient.get<CurrentUserPermissions>('/api/authz/me/permissions'),
  });
}

export function usePermissionCatalog(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: authzQueryKeys.permissions,
    queryFn: () => apiClient.get<PermissionCatalogEntry[]>('/api/authz/permissions'),
    enabled: options.enabled ?? true,
  });
}

export function useCreateCustomPermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCustomPermissionPayload) => apiClient.post<{ id: string; key: string }>('/api/authz/permissions', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: authzQueryKeys.permissions }),
  });
}

export function useRbacRoles(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: authzQueryKeys.roles,
    queryFn: () => apiClient.get<RoleSummary[]>('/api/authz/roles'),
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
    mutationFn: (data: CreateCustomRolePayload) => apiClient.post<{ id: string }>('/api/authz/roles', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: authzQueryKeys.roles }),
  });
}

export function useUpdateCustomRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateCustomRolePayload) => apiClient.put<{ success: boolean }>(`/api/authz/roles/${id}`, data),
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
    queryFn: () => apiClient.get<RoleAssignment[]>(url),
    enabled: options?.enabled ?? true,
  });
}

export function useAssignRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      principalType: AuthzPrincipalType;
      principalId: string;
      roleId: string;
      resourceType?: AuthzResourceType;
      resourceId?: string | null;
      scopeType?: AuthzResourceType;
      scopeId?: string | null;
      expiresAt?: number | null;
    }) =>
      apiClient.post<{ id: string; warnings: string[] }>('/api/authz/role-assignments', data),
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
    queryFn: () => apiClient.get<AuthzGroup[]>(url),
    enabled: options.enabled ?? true,
  });
}

export function useCreateAuthzGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { key?: string; name: string; description?: string | null }) =>
      apiClient.post<{ id: string }>('/api/authz/groups', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'groups'] }),
  });
}

export function useUpdateAuthzGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; description?: string | null; isArchived?: boolean }) =>
      apiClient.put<{ success: boolean }>(`/api/authz/groups/${id}`, data),
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
    queryFn: () => apiClient.get<AuthzGroupMembership[]>(url),
  });
}

export function useAddAuthzGroupMembership() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { groupId: string; userId: string; expiresAt?: number | null }) =>
      apiClient.post<{ id: string }>('/api/authz/group-memberships', data),
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
    queryFn: () => apiClient.get<ApiClient[]>('/api/authz/api-clients'),
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
    queryFn: () => apiClient.get<ServiceAccount[]>(`/api/authz/service-accounts${queryString ? `?${queryString}` : ''}`),
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
    queryFn: () => apiClient.get<ExternalEngineRegistration[]>('/api/authz/external-engines'),
  });
}

export function useExternalEngineSystems() {
  return useQuery({
    queryKey: authzQueryKeys.externalEngineSystems,
    queryFn: () => apiClient.get<ExternalEngineSystem[]>('/api/authz/external-engine-systems'),
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
    queryFn: () => apiClient.get<ExternalEngineRegistrationAuditEntry[]>(`/api/authz/external-engines/${id}/audit${queryString ? `?${queryString}` : ''}`),
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
    queryFn: () => apiClient.get<EngineSetSummary[]>(`/api/authz/engine-sets${queryString ? `?${queryString}` : ''}`),
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
    mutationFn: (data: { key?: string; name: string; description?: string | null; selector: EngineSetSelector; riskAcknowledged?: boolean }) =>
      apiClient.post<{ id: string }>('/api/authz/engine-sets', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'engine-sets'] }),
  });
}

export function useUpdateEngineSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; description?: string | null; selector?: EngineSetSelector; isArchived?: boolean; riskAcknowledged?: boolean }) =>
      apiClient.put<{ success: boolean }>(`/api/authz/engine-sets/${id}`, data),
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
    queryFn: () => apiClient.get<RuntimeResource[]>(`/api/authz/runtime-resources?${queryString}`),
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
    queryFn: () => apiClient.get<RuntimeResourceSet[]>(`/api/authz/runtime-resource-sets${queryString ? `?${queryString}` : ''}`),
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
    queryFn: () => apiClient.get<ConfigBundleApplyRun[]>(`/api/authz/config-bundles/runs?limit=${limit}`),
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
    queryFn: () => apiClient.get<ConfigBundleIdentityReplayTask[]>(`/api/authz/config-bundles/runs/${encodeURIComponent(runId!)}/identity-replay-tasks`),
    enabled: (options.enabled ?? true) && Boolean(runId),
  });
}

export function useConfigBundleRuntimeReconciliationTasks(runId?: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: authzQueryKeys.configBundleRuntimeReconciliationTasks(runId),
    queryFn: () => apiClient.get<ConfigBundleRuntimeReconciliationTask[]>(`/api/authz/config-bundles/runs/${encodeURIComponent(runId!)}/runtime-reconciliation-tasks`),
    enabled: (options.enabled ?? true) && Boolean(runId),
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
    queryFn: () => apiClient.get<ProjectEngineTarget[]>(`/api/authz/project-engine-targets${queryString ? `?${queryString}` : ''}`),
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
    mutationFn: (data: ProjectEngineTargetCreate) => apiClient.post<{ id: string }>('/api/authz/project-engine-targets', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'project-engine-targets'] }),
  });
}

export function useUpdateProjectEngineTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: ProjectEngineTargetUpdate) => apiClient.put<{ success: boolean }>(`/api/authz/project-engine-targets/${id}`, data),
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
      apiClient.post<{ createdOrUpdated: number }>('/api/authz/project-engine-targets/sync-legacy', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'project-engine-targets'] }),
  });
}

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
    mutationFn: (data: SsoMappingTestRequest) =>
      apiClient.post<SsoPlatformMappingTestResponse>(
        '/api/authz/sso-mappings/test',
        data
      ),
  });
}

export function useSsoAssignmentMappings() {
  return useQuery({
    queryKey: authzQueryKeys.ssoAssignmentMappings,
    queryFn: () => apiClient.get<SsoAssignmentMapping[]>('/api/authz/sso-assignment-mappings'),
  });
}

export function useCreateSsoAssignmentMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<SsoAssignmentMapping, 'id' | 'targetScope' | 'createdAt' | 'updatedAt'>) =>
      apiClient.post<{ id: string }>('/api/authz/sso-assignment-mappings', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: authzQueryKeys.ssoAssignmentMappings }),
  });
}

export function useUpdateSsoAssignmentMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<SsoAssignmentMapping> & { id: string }) =>
      apiClient.put<void>(`/api/authz/sso-assignment-mappings/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: authzQueryKeys.ssoAssignmentMappings }),
  });
}

export function useDeleteSsoAssignmentMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/authz/sso-assignment-mappings/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: authzQueryKeys.ssoAssignmentMappings }),
  });
}

export function useTestSsoAssignmentMapping() {
  return useMutation({
    mutationFn: (data: SsoMappingTestRequest) =>
      apiClient.post<SsoAssignmentMappingTestResponse>('/api/authz/sso-assignment-mappings/test', data),
  });
}

export function useSsoEngineAccessSnapshots(
  params: SsoEngineAccessSnapshotParams = {},
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: authzQueryKeys.ssoEngineAccessSnapshots(params),
    queryFn: () => apiClient.get<SsoEngineAccessSnapshot[]>('/api/authz/sso-engine-access-snapshots', params),
    enabled: options.enabled ?? true,
  });
}

export function useSsoEngineAccessSnapshotsForEngine(engineId?: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: authzQueryKeys.ssoEngineAccessSnapshotsForEngine(engineId),
    queryFn: () => apiClient.get<SsoEngineAccessSnapshot[]>(`/api/authz/sso-engine-access-snapshots/${engineId}`),
    enabled: Boolean(engineId) && (options.enabled ?? true),
  });
}

export function usePreviewEngineAccessTransitionCleanup() {
  return useMutation({
    mutationFn: (engineId: string) =>
      apiClient.post<EngineAccessTransitionCleanupPreview>(`/api/engines/${engineId}/access/transition-cleanup-preview`, {}),
  });
}

export function useApplyEngineAccessTransitionCleanup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { engineId: string; assignmentIds: string[]; previewCorrelationId?: string }) =>
      apiClient.post<EngineAccessTransitionCleanupApplyResult>(
        `/api/engines/${data.engineId}/access/transition-cleanup`,
        {
          assignmentIds: data.assignmentIds,
          previewCorrelationId: data.previewCorrelationId,
        },
      ),
    onSuccess: (_result, variables) => {
      qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'role-assignments'] });
      qc.invalidateQueries({ queryKey: authzQueryKeys.ssoEngineAccessSnapshotsForEngine(variables.engineId) });
      qc.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'sso-engine-access-snapshots'] });
    },
  });
}

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
    queryFn: () => apiClient.get<SsoSyncRun[]>('/api/authz/sso-sync-runs', params),
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
    queryFn: () => apiClient.get<SsoSyncEvent[]>(`/api/authz/sso-sync-runs/${runId}/events`, params),
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

export function useSsoGroupMappings() {
  return useQuery({
    queryKey: authzQueryKeys.ssoGroupMappings,
    queryFn: () => apiClient.get<SsoGroupMapping[]>('/api/authz/sso-group-mappings'),
  });
}

export function useIdentityProviders(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: authzQueryKeys.identityProviders,
    queryFn: () => apiClient.get<IdentityProvider[]>('/api/identity/providers'),
    enabled: options.enabled ?? true,
  });
}

export function useIdentityEntitlementMappings(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: authzQueryKeys.identityEntitlementMappings,
    queryFn: () => apiClient.get<IdentityEntitlementMapping[]>('/api/identity/mappings'),
    enabled: options.enabled ?? true,
  });
}

export function useLegacyMappingCoverage(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: authzQueryKeys.legacyMappingCoverage,
    queryFn: () => apiClient.get<LegacyMappingCoverageItem[]>('/api/authz/legacy-mapping-coverage'),
    enabled: options.enabled ?? true,
  });
}

export function useLegacyMappingRetirementReadiness(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: authzQueryKeys.legacyMappingRetirementReadiness,
    queryFn: () => apiClient.get<LegacyMappingRetirementReadiness>('/api/authz/legacy-mapping-retirement-readiness'),
    enabled: options.enabled ?? true,
  });
}

export function useCreateSsoGroupMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<SsoGroupMapping, 'id' | 'targetGroupKey' | 'targetGroupName' | 'createdAt' | 'updatedAt'>) =>
      apiClient.post<{ id: string }>('/api/authz/sso-group-mappings', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: authzQueryKeys.ssoGroupMappings }),
  });
}

export function useUpdateSsoGroupMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<SsoGroupMapping> & { id: string }) =>
      apiClient.put<void>(`/api/authz/sso-group-mappings/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: authzQueryKeys.ssoGroupMappings }),
  });
}

export function useDeleteSsoGroupMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/authz/sso-group-mappings/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: authzQueryKeys.ssoGroupMappings }),
  });
}

export function useTestSsoGroupMapping() {
  return useMutation({
    mutationFn: (data: SsoMappingTestRequest) =>
      apiClient.post<SsoGroupMappingTestResponse>('/api/authz/sso-group-mappings/test', data),
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
}, options?: { enabled?: boolean }) {
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
    enabled: options?.enabled ?? true,
  });
}
