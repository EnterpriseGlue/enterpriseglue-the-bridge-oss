/**
 * React Query hooks for Platform Authorization API
 */

import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';

// Types
export type AuthzResourceType =
  | 'platform'
  | 'tenant'
  | 'project'
  | 'engine'
  | 'engine_set'
  | 'engine_runtime_resource'
  | 'engine_runtime_resource_set'
  | 'project_engine_target'
  | 'external_engine_system'
  | 'api_client'
  | 'sso_mapping'
  | 'sidecar'
  | 'extension';

export type AuthzPrincipalType = 'user' | 'group' | 'api_client' | 'service_account';
export type RoleAssignmentSource = 'legacy' | 'manual' | 'sso' | 'api' | 'system' | 'automation' | 'bootstrap' | 'config';
export type SsoClaimOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'contains_any'
  | 'not_contains_any'
  | 'contains_all'
  | 'not_contains_all'
  | 'matches_regex'
  | 'not_matches_regex'
  | 'exists'
  | 'not_exists';

export interface SsoClaimsMapping {
  id: string;
  providerId: string | null;
  claimType: 'group' | 'role' | 'email_domain' | 'custom';
  claimKey: string;
  claimValue: string;
  claimOperator?: SsoClaimOperator | null;
  targetRole: 'admin' | 'user';
  priority: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  riskAcknowledged?: boolean;
}

export interface PermissionCatalogEntry {
  key: string;
  scope: AuthzResourceType;
  category: string;
  label: string;
  description: string;
  kind?: 'system' | 'custom';
  isEditable?: boolean;
  isArchived?: boolean;
  createdById?: string | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface CurrentUserPermissions {
  userId: string;
  platform: string[];
  projects: Array<{ resourceId: string; permissions: string[] }>;
  engines: Array<{ resourceId: string; permissions: string[] }>;
  authorizationVersion?: string;
  generatedAt: number;
}

export interface RoleSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  scope: AuthzResourceType;
  kind: 'system' | 'custom';
  isEditable: boolean;
  isAssignable: boolean;
  isArchived: boolean;
  permissionCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface RoleDetail extends RoleSummary {
  permissions: string[];
}

export interface CreateCustomRolePayload {
  name: string;
  description?: string | null;
  scope: AuthzResourceType;
  permissionIds: string[];
}

export interface CreateCustomPermissionPayload {
  key: string;
  scope: AuthzResourceType;
  category: string;
  label: string;
  description?: string | null;
}

export interface UpdateCustomRolePayload {
  id: string;
  name?: string;
  description?: string | null;
  permissionIds?: string[];
  isArchived?: boolean;
}

export interface RoleAssignment {
  id: string;
  userId: string;
  principalType: AuthzPrincipalType;
  principalId: string;
  roleId: string;
  roleKey: string | null;
  roleName: string | null;
  roleScope: AuthzResourceType | null;
  resourceType: AuthzResourceType | null;
  resourceId: string | null;
  scopeType: AuthzResourceType | null;
  scopeId: string | null;
  source: RoleAssignmentSource;
  sourceMappingId: string | null;
  sourceRef: string | null;
  ownershipMode: AuthzOwnershipMode;
  sourceHash: string | null;
  lastAppliedAt: number | null;
  driftStatus: string | null;
  expiresAt: number | null;
  lastSeenAt: number | null;
  createdById: string | null;
  createdAt: number;
  updatedAt: number;
}

export type AuthzGroupSource = 'manual' | 'sso' | 'identity_provider' | 'api' | 'automation' | 'system' | 'config';
export type AuthzOwnershipMode = 'manual' | 'config_locked' | 'config_warn';

export interface AuthzGroup {
  id: string;
  tenantId?: string | null;
  key: string;
  name: string;
  description: string | null;
  source: AuthzGroupSource;
  sourceRef: string | null;
  ownershipMode: AuthzOwnershipMode;
  sourceHash: string | null;
  lastAppliedAt: number | null;
  driftStatus: string | null;
  isSystem: boolean;
  isArchived: boolean;
  createdById: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AuthzGroupMembership {
  id: string;
  tenantId?: string | null;
  groupId: string;
  groupKey: string | null;
  groupName: string | null;
  userId: string;
  source: AuthzGroupSource;
  sourceRef: string | null;
  expiresAt: number | null;
  createdById: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ApiClient {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  isActive: boolean;
  createdById: string | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ApiClientWithToken {
  client: ApiClient;
  token: string;
}

export interface ServiceAccount {
  id: string;
  name: string;
  tokenPrefix: string | null;
  scopes: string[];
  description: string | null;
  isActive: boolean;
  createdById: string | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ServiceAccountWithToken {
  account: ServiceAccount;
  token: string;
}

export type EngineManagementMode = 'manual' | 'external_managed' | 'hybrid';
export type EngineLifecycleStatus = 'active' | 'disabled' | 'stale' | 'decommissioned';
export type EngineCapabilityStatus = 'unknown' | 'in_sync' | 'mismatch';
export type EngineFieldOwnership = Record<string, 'manual' | 'external'>;
export interface ExternalEngineCapabilities {
  operations?: string[];
  supportLevel?: string | null;
  compatibilityProfile?: string | null;
  [key: string]: unknown;
}

export interface ExternalEngineCapabilityDiagnostics {
  status: EngineCapabilityStatus;
  expectedOperations: string[];
  reportedOperations: string[];
  missingOperations: string[];
  extraOperations: string[];
  expectedSupportLevel: string;
  reportedSupportLevel: string | null;
  expectedCompatibilityProfile: string;
  reportedCompatibilityProfile: string | null;
  issues: string[];
  recommendation: string;
}

export interface ExternalEngineMaterializationDiagnostics {
  engineSetCount: number;
  matched: number;
  created: number;
  updated: number;
  removed: number;
  errors: Array<{ engineSetId: string; error: string }>;
  status: 'ok' | 'failed';
  summary: string;
}

export interface ExternalEngineSystem {
  id: string;
  tenantId?: string | null;
  key: string;
  name: string;
  description: string | null;
  defaultManagementMode: EngineManagementMode;
  defaultFieldOwnership: EngineFieldOwnership;
  isActive: boolean;
  createdById: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ExternalEngineSystemPayload {
  key?: string;
  name?: string;
  description?: string | null;
  defaultManagementMode?: Exclude<EngineManagementMode, 'manual'>;
  defaultFieldOwnership?: EngineFieldOwnership;
  isActive?: boolean;
}

export interface ExternalEngineRegistration {
  id: string;
  registrationId?: string;
  name: string;
  baseUrl: string;
  type: string | null;
  externalId: string | null;
  labels: Record<string, string>;
  registrationSource: string | null;
  apiClientId?: string | null;
  externalSystemId?: string | null;
  externalSystemName?: string | null;
  managementMode?: EngineManagementMode | null;
  fieldOwnership?: EngineFieldOwnership;
  driftStatus?: string | null;
  lifecycleStatus?: EngineLifecycleStatus | null;
  lastExternalSyncAt?: number | null;
  capabilities?: ExternalEngineCapabilities | null;
  capabilityStatus?: EngineCapabilityStatus | null;
  capabilityDiagnostics?: ExternalEngineCapabilityDiagnostics;
  externalUpdatedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ExternalEngineRegistrationAuditEntry {
  id: string;
  userId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  details: Record<string, unknown> | null;
  createdAt: number;
}

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

export interface ExternalEngineLifecycleResponse {
  engineId: string;
  externalId: string | null;
  lifecycleStatus: EngineLifecycleStatus;
  driftStatus?: string | null;
  materializationResults?: unknown[];
  materializationDiagnostics?: ExternalEngineMaterializationDiagnostics;
}

export interface ExternalEngineReconcileResponse {
  engineId: string;
  externalId: string | null;
  lifecycleStatus: EngineLifecycleStatus;
  capabilityStatus: EngineCapabilityStatus;
  capabilityDiagnostics: ExternalEngineCapabilityDiagnostics;
  materializationResults: unknown[];
  materializationDiagnostics: ExternalEngineMaterializationDiagnostics;
}

export type EngineSetSelector =
  | { mode: 'all' }
  | { mode: 'engine_ids'; engineIds: string[] }
  | { mode: 'labels'; labels: Record<string, string>; labelMatch?: 'all' | 'any' };

export interface EngineSetMaterialization {
  id: string;
  tenantId?: string | null;
  engineSetId: string;
  engineId: string;
  engineName: string | null;
  selectorFingerprint: string;
  matchedBy: Record<string, unknown>;
  lineage: Record<string, unknown>;
  source: string;
  sourceRef: string | null;
  lastSeenAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface EngineSetSummary {
  id: string;
  tenantId?: string | null;
  key: string;
  name: string;
  description: string | null;
  selector: EngineSetSelector;
  selectorFingerprint: string;
  source: 'manual' | 'sso' | 'api' | 'external' | 'system' | 'automation' | 'config';
  sourceRef: string | null;
  ownershipMode: AuthzOwnershipMode;
  sourceHash: string | null;
  lastAppliedAt: number | null;
  driftStatus: string | null;
  isArchived: boolean;
  createdById: string | null;
  lastMaterializedAt: number | null;
  materializationStatus: string;
  materializationError: string | null;
  materializedEngineCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface EngineSetDetail extends EngineSetSummary {
  materializations: EngineSetMaterialization[];
}

export interface EngineSetPreview {
  selector: EngineSetSelector;
  selectorFingerprint: string;
  riskReasons: Array<'all_engines_selector' | 'any_label_match'>;
  warnings: string[];
  matchedEngines: Array<{
    engineId: string;
    engineName: string;
    labels: Record<string, string>;
    matchedBy: Record<string, unknown>;
  }>;
}

export interface EngineSetMaterializationResult {
  engineSetId: string;
  selectorFingerprint: string;
  matched: number;
  created: number;
  updated: number;
  removed: number;
  materializations: EngineSetMaterialization[];
}

export type ProjectEngineTargetMode = 'manual' | 'ci' | 'api' | 'import';
export type ProjectEngineTargetStatus = 'active' | 'disabled' | 'archived';
export type ProjectEngineTargetSource = 'manual' | 'legacy' | 'ci' | 'api' | 'import' | 'deployment_history' | 'external' | 'system' | 'automation' | 'config';
export type ProjectEngineTargetApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';

export interface ProjectEngineTarget {
  id: string;
  tenantId?: string | null;
  projectId: string;
  projectName: string | null;
  engineId: string;
  engineName: string | null;
  engineBaseUrl: string | null;
  environment: { id: string; name: string; color: string; manualDeployAllowed: boolean } | null;
  status: ProjectEngineTargetStatus;
  source: ProjectEngineTargetSource;
  sourceRef: string | null;
  ownershipMode: AuthzOwnershipMode;
  sourceHash: string | null;
  lastAppliedAt: number | null;
  driftStatus: string | null;
  externalSystemId: string | null;
  externalProjectId: string | null;
  externalEngineId: string | null;
  externalTargetId: string | null;
  allowManualDeploy: boolean;
  allowCiDeploy: boolean;
  allowApiDeploy: boolean;
  allowImport: boolean;
  createdById: string | null;
  approvedById: string | null;
  approvalStatus: ProjectEngineTargetApprovalStatus;
  approvedAt: number | null;
  policyTags: string[];
  diagnostics: Record<string, unknown> | null;
  lastSeenAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type ProjectEngineTargetCreate = {
  projectId: string;
  engineId: string;
  status?: ProjectEngineTargetStatus;
  source?: ProjectEngineTargetSource;
  sourceRef?: string | null;
  externalSystemId?: string | null;
  externalProjectId?: string | null;
  externalEngineId?: string | null;
  externalTargetId?: string | null;
  allowManualDeploy?: boolean;
  allowCiDeploy?: boolean;
  allowApiDeploy?: boolean;
  allowImport?: boolean;
  approvedById?: string | null;
  approvalStatus?: ProjectEngineTargetApprovalStatus;
  approvedAt?: number | null;
  policyTags?: string[];
  diagnostics?: Record<string, unknown> | null;
};

export type ProjectEngineTargetUpdate = Omit<Partial<ProjectEngineTargetCreate>, 'projectId' | 'engineId'> & {
  id: string;
};

export interface DeploymentEligibilityResult {
  allowed: boolean;
  decision: 'allow' | 'deny';
  mode: ProjectEngineTargetMode;
  projectId: string;
  engineId: string;
  checks: Array<{ id: string; allowed: boolean; reason: string; remediation?: string }>;
  reasons: string[];
}

export interface SsoAssignmentMapping {
  id: string;
  tenantId?: string | null;
  providerId: string | null;
  claimType: 'group' | 'role' | 'email_domain' | 'custom';
  claimKey: string;
  claimValue: string;
  claimOperator?: SsoClaimOperator | null;
  targetScope: 'engine';
  targetSelectorType: 'engine_id' | 'all_engines' | 'external_engine_id' | 'engine_label';
  targetEngineId: string | null;
  targetExternalEngineId: string | null;
  targetLabelKey: string | null;
  targetLabelValue: string | null;
  targetRoleId: string;
  syncMode: 'authoritative' | 'additive';
  priority: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  riskAcknowledged?: boolean;
}

export interface SsoGroupMapping {
  id: string;
  tenantId?: string | null;
  providerId: string | null;
  claimType: 'group' | 'role' | 'email_domain' | 'custom';
  claimKey: string;
  claimValue: string;
  claimOperator?: SsoClaimOperator | null;
  targetGroupId: string;
  targetGroupKey: string | null;
  targetGroupName: string | null;
  syncMode: 'authoritative' | 'additive';
  priority: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  riskAcknowledged?: boolean;
}

export interface IdentityEntitlementMapping {
  id: string;
  providerId: string;
  providerKey: string;
  targetGroupId: string;
  targetGroupKey: string;
  entitlementType: 'group' | 'role' | 'scope' | 'attribute';
  externalId: string | null;
  matchOperator: 'exact' | 'contains' | 'exists';
  syncMode: 'authoritative' | 'additive';
  isActive: boolean;
  configKey: string | null;
  sourceRef: string | null;
}

export interface EffectiveAccessResult {
  allowed: boolean;
  decision: 'allow' | 'deny';
  reason: string;
  policyId?: string;
  policyName?: string;
  baseAllowed: boolean;
  baseReason: string;
  resolvedRuntimeResource?: {
    id: string;
    engineId: string;
    resourceKind: 'process_definition' | 'decision_definition';
    resourceKey: string;
    runtimeTenantId: string;
  };
  sources: Array<{
    type: string;
    assignmentId?: string;
    roleId?: string;
    role?: string;
    principalType?: AuthzPrincipalType;
    principalId?: string;
    source?: string;
    sourceMappingId?: string | null;
    sourceRef?: string | null;
    scopeType?: AuthzResourceType | null;
    scopeId?: string | null;
    groupId?: string | null;
    groupKey?: string | null;
    groupName?: string | null;
    groupMembership?: {
      id: string;
      source: string;
      sourceRef: string | null;
      expiresAt: number | null;
    } | null;
    engineSetId?: string | null;
    engineSetKey?: string | null;
    engineSetName?: string | null;
    selectorFingerprint?: string | null;
    materializationId?: string | null;
    matchedEngineId?: string | null;
    engineRegistration?: {
      engineId: string;
      engineName: string | null;
      externalId: string | null;
      registrationId: string | null;
      registrationSource: string | null;
      externalSystemId: string | null;
      lifecycleStatus: string | null;
      apiClientId: string | null;
      lastExternalSyncAt: number | null;
      lastRegisteredAt: number | null;
      externalUpdatedAt: number | null;
    } | null;
    matchedBy?: Record<string, unknown> | null;
    lineage?: Record<string, unknown> | null;
    configBundle?: {
      bundleKey: string;
      sourceRef: string;
      objectType: 'role_assignment';
      objectId: string;
      sourceHash: string | null;
      lastAppliedAt: number | null;
      driftStatus: string | null;
      ownershipMode: string;
      applyRun: { id: string; canonicalHash: string; appliedAt: number } | null;
    };
    ssoMapping?: {
      id: string;
      providerId: string | null;
      claimType: string;
      claimKey: string;
      claimValue: string;
      claimOperator: string | null;
      targetSelectorType: string;
    } | null;
    ssoGroupMapping?: {
      id: string;
      providerId: string | null;
      claimType: string;
      claimKey: string;
      claimValue: string;
      claimOperator: string | null;
      targetGroupId: string;
      syncMode: string;
    } | null;
    identityEntitlementMapping?: {
      id: string;
      providerId: string;
      entitlementType: string;
      externalId: string | null;
      matchOperator: string;
      targetGroupId: string;
      syncMode: string;
    } | null;
    shadowedRuntimeAssignmentIds?: string[];
    permission?: string;
  }>;
}

export type RuntimeResourceKind = 'process_definition' | 'decision_definition';

export interface RuntimeResource {
  id: string;
  tenantId: string | null;
  engineId: string;
  resourceKind: RuntimeResourceKind;
  resourceKey: string;
  runtimeTenantId: string;
  engineResourceId: string | null;
  deploymentId: string | null;
  projectId: string | null;
  fileId: string | null;
  version: number | null;
  labelsJson: string;
  lineageJson: string;
  source: string;
  sourceRef: string | null;
  observedAt: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface RuntimeResourceSet {
  id: string;
  tenantId: string | null;
  key: string;
  name: string;
  description: string | null;
  engineId: string;
  resourceKind: RuntimeResourceKind;
  selectorJson: string;
  selectorFingerprint: string;
  runtimeTenantId: string | null;
  source: string;
  sourceRef: string | null;
  sourceHash: string | null;
  lastAppliedAt: number | null;
  driftStatus: string | null;
  isArchived: boolean;
  createdById: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface RuntimeResourceSetMaterializationResult {
  runtimeResourceSetId: string;
  matched: number;
  created: number;
  updated: number;
  removed: number;
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

export interface SsoSyncRun {
  id: string;
  tenantId: string | null;
  providerId: string | null;
  userId: string | null;
  trigger: 'login' | 'scheduled' | 'manual' | 'mapping_change' | 'engine_change';
  status: 'running' | 'success' | 'failed';
  startedAt: number;
  completedAt: number | null;
  groupMembershipsCreated: number;
  groupMembershipsUpdated: number;
  groupMembershipsRemoved: number;
  assignmentsCreated: number;
  assignmentsUpdated: number;
  assignmentsRemoved: number;
  errorCode: string | null;
  errorMessage: string | null;
  details: string;
}

export interface SsoSyncEvent {
  id: string;
  tenantId: string | null;
  providerId: string | null;
  runId: string;
  severity: 'info' | 'warning' | 'error';
  type: string;
  userId: string | null;
  mappingType: string | null;
  mappingId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  message: string;
  details: string;
  createdAt: number;
}

export interface SsoSyncRunParams {
  providerId?: string;
  userId?: string;
  status?: SsoSyncRun['status'];
  trigger?: SsoSyncRun['trigger'];
  limit?: number;
}

export interface SsoSyncEventParams {
  providerId?: string;
  severity?: SsoSyncEvent['severity'];
  limit?: number;
}

export interface SsoSyncDiagnosticsRunPayload {
  providerId?: string;
  trigger?: Extract<SsoSyncRun['trigger'], 'manual' | 'scheduled' | 'mapping_change' | 'engine_change'>;
  includeProviderChecks?: boolean;
  includeSnapshotReplay?: boolean;
  refreshProviderClaims?: boolean;
  includeCleanup?: boolean;
}

export interface SsoSyncDiagnosticsScanResult {
  runId: string | null;
  scannedGroupMappings: number;
  scannedAssignmentMappings: number;
  scannedGroupMemberships: number;
  scannedAssignments: number;
  warnings: number;
  errors: number;
  providerIdentityCheck?: Record<string, unknown>;
  snapshotReconciliation?: Record<string, unknown>;
  cleanup?: Record<string, unknown>;
}

export type SsoEngineAccessSnapshotStatus =
  | 'active'
  | 'stale'
  | 'removed_by_sso'
  | 'removed_by_admin'
  | 'mapping_disabled'
  | 'provider_identity_missing'
  | 'provider_group_missing'
  | 'engine_no_longer_matches_selector';

export interface SsoEngineAccessSnapshot {
  id: string;
  tenantId: string | null;
  providerId: string | null;
  mappingId: string;
  principalType: string;
  principalId: string;
  engineId: string;
  providerSubjectIds: string[];
  providerGroupIds: string[];
  providerAppRoleIds: string[];
  currentRoleIds: string[];
  previousRoleIds: string[];
  status: SsoEngineAccessSnapshotStatus;
  cleanupReason: string | null;
  lastSeenAt: number;
  lastSyncedAt: number;
  removedAt: number | null;
  details: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface SsoEngineAccessSnapshotParams {
  providerId?: string;
  mappingId?: string;
  principalType?: string;
  principalId?: string;
  engineId?: string;
  status?: SsoEngineAccessSnapshotStatus;
  limit?: number;
}

export interface EngineAccessTransitionCleanupCandidate {
  manualAssignmentId: string;
  ssoAssignmentId: string;
  principalType: string;
  principalId: string;
  engineId: string;
  manualRoleId: string;
  ssoRoleId: string;
  sourceMappingId: string | null;
  lastSnapshotStatus: SsoEngineAccessSnapshotStatus | null;
  recommendedAction: 'remove_manual_duplicate' | 'review_manual_conflict';
}

export interface EngineAccessTransitionCleanupPreview {
  previewCorrelationId: string;
  engineId: string;
  candidates: EngineAccessTransitionCleanupCandidate[];
}

export interface EngineAccessTransitionCleanupApplyResult {
  previewCorrelationId: string;
  engineId: string;
  removedAssignmentIds: string[];
  removedCount: number;
}

export interface BridgeDecisionPayload {
  engineId?: string;
  projectId?: string;
  fileId?: string;
  targetId?: string;
  definitionId?: string;
  definitionKey?: string;
  decisionDefinitionId?: string;
  decisionDefinitionKey?: string;
  kind?: 'process' | 'decision' | 'bpmn' | 'dmn';
  [key: string]: unknown;
}

export interface BridgeDecisionResponse {
  allowed: boolean;
  reasonCode: string;
  reason: string;
  missingActions: string[];
  projectId: string | null;
  fileId: string | null;
  engineId: string | null;
  targetId: string | null;
  lineage: Record<string, unknown>;
  diagnostics?: {
    effectiveAccessUrl?: string;
    label?: string;
  };
}

// Query keys
export const authzQueryKeys = {
  ssoMappings: ['platform-admin', 'authz', 'sso-mappings'] as const,
  ssoAssignmentMappings: ['platform-admin', 'authz', 'sso-assignment-mappings'] as const,
  ssoEngineAccessSnapshots: (params?: SsoEngineAccessSnapshotParams) => ['platform-admin', 'authz', 'sso-engine-access-snapshots', params] as const,
  ssoEngineAccessSnapshotsForEngine: (engineId?: string) => ['platform-admin', 'authz', 'sso-engine-access-snapshots', 'engine', engineId] as const,
  ssoGroupMappings: ['platform-admin', 'authz', 'sso-group-mappings'] as const,
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
  engineSet: (id?: string) => ['platform-admin', 'authz', 'engine-sets', id] as const,
  runtimeResources: (engineId?: string, options?: { resourceKind?: RuntimeResourceKind; includeInactive?: boolean }) => ['platform-admin', 'authz', 'runtime-resources', engineId, options] as const,
  runtimeResourceSets: (engineId?: string, options?: { includeArchived?: boolean }) => ['platform-admin', 'authz', 'runtime-resource-sets', engineId, options] as const,
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

export function usePermissionCatalog() {
  return useQuery({
    queryKey: authzQueryKeys.permissions,
    queryFn: () => apiClient.get<PermissionCatalogEntry[]>('/api/authz/permissions'),
  });
}

export function useCreateCustomPermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCustomPermissionPayload) => apiClient.post<{ id: string; key: string }>('/api/authz/permissions', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: authzQueryKeys.permissions }),
  });
}

export function useRbacRoles() {
  return useQuery({
    queryKey: authzQueryKeys.roles,
    queryFn: () => apiClient.get<RoleSummary[]>('/api/authz/roles'),
  });
}

export function useRoleDetail(id?: string) {
  return useQuery({
    queryKey: authzQueryKeys.roleDetail(id),
    queryFn: () => apiClient.get<RoleDetail>(`/api/authz/roles/${id}`),
    enabled: Boolean(id),
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

export function useAuthzGroups(params?: { includeArchived?: boolean }) {
  const searchParams = new URLSearchParams();
  if (params?.includeArchived) searchParams.set('includeArchived', 'true');
  const queryString = searchParams.toString();
  const url = `/api/authz/groups${queryString ? `?${queryString}` : ''}`;
  return useQuery({
    queryKey: authzQueryKeys.groups(params),
    queryFn: () => apiClient.get<AuthzGroup[]>(url),
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
    mutationFn: (data: Required<Pick<ExternalEngineSystemPayload, 'name'>> & ExternalEngineSystemPayload) =>
      apiClient.post<ExternalEngineSystem>('/api/authz/external-engine-systems', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: authzQueryKeys.externalEngineSystems }),
  });
}

export function useUpdateExternalEngineSystem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & ExternalEngineSystemPayload) =>
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
      apiClient.post<ExternalEngineLifecycleResponse & { decommissioned: boolean }>(`/api/authz/external-engines/${id}/decommission`, { reason }),
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
      apiClient.post<ExternalEngineLifecycleResponse & { reactivated: boolean }>(`/api/authz/external-engines/${id}/reactivate`, { reason }),
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

export function useEngineSets(params?: { includeArchived?: boolean }) {
  const searchParams = new URLSearchParams();
  if (params?.includeArchived) searchParams.set('includeArchived', 'true');
  const queryString = searchParams.toString();
  return useQuery({
    queryKey: authzQueryKeys.engineSets(params),
    queryFn: () => apiClient.get<EngineSetSummary[]>(`/api/authz/engine-sets${queryString ? `?${queryString}` : ''}`),
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
    mutationFn: (data: { claims: Record<string, any>; providerId?: string }) =>
      apiClient.post<{ resolvedRole: string; matchedMappings: Array<{ id: string; name: string; targetRole: string }> }>(
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
    mutationFn: (data: { claims: Record<string, any>; providerId?: string }) =>
      apiClient.post<{
        matchedMappings: Array<SsoAssignmentMapping & { targetResourceId: string | null; targetResourceIds: Array<string | null> }>;
        assignments: Array<{ roleId: string; resourceType: 'engine'; resourceId: string | null; mappingId: string }>;
      }>('/api/authz/sso-assignment-mappings/test', data),
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

export function useIdentityEntitlementMappings() {
  return useQuery({
    queryKey: authzQueryKeys.identityEntitlementMappings,
    queryFn: () => apiClient.get<IdentityEntitlementMapping[]>('/api/identity/mappings'),
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
    mutationFn: (data: { claims: Record<string, any>; providerId?: string }) =>
      apiClient.post<{
        matchedMappings: SsoGroupMapping[];
        memberships: Array<{ groupId: string; mappingId: string }>;
      }>('/api/authz/sso-group-mappings/test', data),
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
