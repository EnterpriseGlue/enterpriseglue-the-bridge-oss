import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Button,
  Checkbox,
  DataTable,
  DataTableSkeleton,
  Dropdown,
  InlineNotification,
  Modal,
  NumberInput,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
  Tabs,
  Tag,
  TextArea,
  TextInput,
  Toggle,
} from '@carbon/react';
import { Add, Security, TrashCan } from '@carbon/icons-react';
import { PageLayout, PageHeader, PAGE_GRADIENTS } from '../../../shared/components/PageLayout';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import { apiClient } from '../../../shared/api/client';
import { UnauthorizedEmptyState, useActionDecision } from '../../../shared/auth/guards';
import { getPermissionRiskForKey } from '../../../shared/auth/permissionRisk';
import { usePlatformSyncSettings } from '../hooks/usePlatformSyncSettings';
import type { UiAuthzDecision } from '@enterpriseglue/shared/authz/permission-actions.js';
import {
  useArchiveCustomRole,
  useArchiveExternalEngineSystem,
  useArchiveProjectEngineTarget,
  useAssignRole,
  useAuthzPolicies,
  useApiClients,
  useAddAuthzGroupMembership,
  useAuthzGroupMemberships,
  useAuthzGroups,
  useAuthzAuditLog,
  useCreateApiClient,
  useCreateAuthzGroup,
  useCreateCustomPermission,
  useCreateCustomRole,
  useCreateEngineSet,
  useCreateExternalEngineSystem,
  useCreatePolicy,
  useCreateProjectEngineTarget,
  useCreateServiceAccount,
  useCreateSsoGroupMapping,
  useCreateSsoMapping,
  useCreateSsoAssignmentMapping,
  useDeleteSsoGroupMapping,
  useDeleteSsoMapping,
  useDeletePolicy,
  useDecommissionExternalEngine,
  useDeleteSsoAssignmentMapping,
  useDeleteAuthzGroup,
  useEngineSet,
  useEngineSets,
  useEvaluateDeploymentEligibility,
  useEvaluateAccess,
  useExternalEngineSystems,
  useExternalEngineAudit,
  useExternalEngines,
  useArchiveEngineSet,
  usePermissionCatalog,
  useMaterializeEngineSet,
  usePreviewEngineSetSelector,
  useProjectEngineTargets,
  useRoleDetails,
  useRbacRoles,
  useReactivateExternalEngine,
  useReconcileExternalEngine,
  useRevokeApiClient,
  useRevokeServiceAccount,
  useRotateApiClient,
  useRotateServiceAccount,
  useRunSsoSyncDiagnostics,
  useApplyEngineAccessTransitionCleanup,
  usePreviewEngineAccessTransitionCleanup,
  useSsoEngineAccessSnapshots,
  useRemoveAuthzGroupMembership,
  useRemoveRoleAssignment,
  useRoleAssignments,
  useRoleDetail,
  useServiceAccounts,
  useSsoAssignmentMappings,
  useSsoClaimsMappings,
  useSsoGroupMappings,
  useSsoSyncEvents,
  useSsoSyncRuns,
  useTestSsoGroupMapping,
  useTestSsoMapping,
  useTestSsoAssignmentMapping,
  useUpdateCustomRole,
  useUpdateAuthzGroup,
  useUpdateEngineSet,
  useUpdateExternalEngineSystem,
  useUpdatePolicy,
  useUpdateProjectEngineTarget,
  useUpdateSsoGroupMapping,
  useUpdateSsoMapping,
  useUpdateSsoAssignmentMapping,
  useSyncLegacyProjectEngineTargets,
  type PermissionCatalogEntry,
  type ApiClient,
  type AuthzPolicy,
  type DeploymentEligibilityResult,
  type AuthzGroup,
  type AuthzGroupMembership,
  type AuthzAuditEntry,
  type ExternalEngineRegistration,
  type ExternalEngineAuditAction,
  type ExternalEngineCapabilityDiagnostics,
  type ExternalEngineRegistrationAuditEntry,
  type ExternalEngineReconcileResponse,
  type ExternalEngineSystem,
  type ExternalEngineSystemPayload,
  type EffectiveAccessResult,
  type EngineSetDetail,
  type EngineSetSelector,
  type EngineSetSummary,
  type EngineFieldOwnership,
  type EngineManagementMode,
  type ProjectEngineTarget,
  type ProjectEngineTargetMode,
  type ProjectEngineTargetSource,
  type ProjectEngineTargetStatus,
  type PolicyCondition,
  type RoleAssignment,
  type RoleDetail,
  type RoleSummary,
  type ServiceAccount,
  type SsoClaimsMapping,
  type SsoGroupMapping,
  type SsoAssignmentMapping,
  type SsoClaimOperator,
  type SsoEngineAccessSnapshot,
  type SsoSyncDiagnosticsScanResult,
  type SsoSyncEvent,
  type SsoSyncRun,
  type AuthzResourceType,
} from '../hooks/useAuthzApi';

type CoreAssignmentResourceType = 'platform' | 'project' | 'engine' | 'engine_runtime_resource' | 'engine_runtime_resource_set' | 'external_engine_system';
type AssignmentPrincipalType = 'user' | 'group' | 'api_client' | 'service_account';
type EffectiveAccessSource = EffectiveAccessResult['sources'][number];
type PrincipalSummaryStatus = 'active' | 'archived' | 'revoked' | 'unknown';

interface PrincipalSummary {
  key: string;
  type: AssignmentPrincipalType;
  id: string;
  label: string;
  detail: string;
  directAssignmentCount: number;
  inheritedAssignmentCount: number;
  relationshipCount: number;
  status: PrincipalSummaryStatus;
}

interface ResourceSummary {
  key: string;
  type: AuthzResourceType;
  id: string;
  label: string;
  detail: string;
  assignmentCount: number;
  userAssignmentCount: number;
  groupAssignmentCount: number;
  machineAssignmentCount: number;
  status: string;
}

interface RuntimeResourceInventoryRow {
  id: string;
  engineId: string;
  resourceKind: 'process_definition' | 'decision_definition';
  resourceKey: string;
  runtimeTenantId: string;
  projectId: string | null;
  source: string;
  observedAt: number;
  isActive: boolean;
}

interface RuntimeResourceEngineOption {
  id: string;
  name: string;
}

const CLAIM_TYPES = [
  { id: 'group', label: 'Group' },
  { id: 'role', label: 'Role' },
  { id: 'email_domain', label: 'Email Domain' },
  { id: 'custom', label: 'Custom Claim' },
];

const CLAIM_OPERATORS: Array<{ id: SsoClaimOperator | ''; label: string }> = [
  { id: '', label: 'Wildcard compatibility' },
  { id: 'equals', label: 'Equals' },
  { id: 'not_equals', label: 'Does not equal' },
  { id: 'contains', label: 'Contains' },
  { id: 'not_contains', label: 'Does not contain' },
  { id: 'contains_any', label: 'Contains any' },
  { id: 'not_contains_any', label: 'Does not contain any' },
  { id: 'contains_all', label: 'Contains all' },
  { id: 'not_contains_all', label: 'Does not contain all' },
  { id: 'matches_regex', label: 'Matches regex' },
  { id: 'not_matches_regex', label: 'Does not match regex' },
  { id: 'exists', label: 'Exists' },
  { id: 'not_exists', label: 'Does not exist' },
];

const TARGET_SELECTORS = [
  { id: 'engine_id', label: 'Engine ID' },
  { id: 'all_engines', label: 'All engines' },
  { id: 'external_engine_id', label: 'External engine ID' },
  { id: 'engine_label', label: 'Engine label' },
];

const SYSTEM_SSO_TARGET_ROLES = [
  { id: 'system.engine.operator', label: 'Engine Operator' },
  { id: 'system.engine.deployer', label: 'Engine Deployer' },
];

const SYSTEM_SSO_GOVERNANCE_TARGET_ROLES = [
  { id: 'system.engine.owner', label: 'Engine Owner' },
  { id: 'system.engine.delegate', label: 'Engine Delegate' },
];

const SSO_PLATFORM_TARGET_ROLES = [
  { id: 'admin', label: 'Platform Admin' },
  { id: 'user', label: 'Standard User' },
];

const SYNC_MODES = [
  { id: 'authoritative', label: 'Authoritative' },
  { id: 'additive', label: 'Additive' },
];

function unavailableReason(decision: UiAuthzDecision, fallback: string): string | undefined {
  return decision.allowed ? undefined : decision.reason || fallback;
}

const rolesHeaders = [
  { key: 'name', header: 'Role' },
  { key: 'scope', header: 'Scope' },
  { key: 'kind', header: 'Kind' },
  { key: 'permissions', header: 'Permissions' },
  { key: 'assignable', header: 'Assignable' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: '' },
];

export type RoleScopeFilter = 'all' | RoleSummary['scope'];

const ROLE_SCOPE_FILTERS: Array<{ id: RoleScopeFilter; label: string }> = [
  { id: 'all', label: 'All scopes' },
  { id: 'platform', label: 'Platform' },
  { id: 'project', label: 'Project' },
  { id: 'engine', label: 'Engine' },
  { id: 'external_engine_system', label: 'External system' },
];

const permissionsHeaders = [
  { key: 'label', header: 'Permission' },
  { key: 'key', header: 'Key' },
  { key: 'scope', header: 'Scope' },
  { key: 'kind', header: 'Type' },
  { key: 'category', header: 'Category' },
  { key: 'implications', header: 'Dependencies' },
  { key: 'risk', header: 'Warning' },
];

export type PermissionQuickFilter = 'all' | 'view' | 'editor' | 'operator' | 'deployment';

const PERMISSION_QUICK_FILTERS: Array<{ id: PermissionQuickFilter; label: string }> = [
  { id: 'all', label: 'All permissions' },
  { id: 'view', label: 'View only' },
  { id: 'editor', label: 'Editor' },
  { id: 'operator', label: 'Operator' },
  { id: 'deployment', label: 'Deployment' },
];

const ssoAssignmentHeaders = [
  { key: 'claim', header: 'Claim' },
  { key: 'target', header: 'Target' },
  { key: 'role', header: 'Role' },
  { key: 'mode', header: 'Sync' },
  { key: 'status', header: 'Status' },
  { key: 'warning', header: 'Warning' },
  { key: 'actions', header: '' },
];

const ssoPlatformMappingHeaders = [
  { key: 'provider', header: 'Provider' },
  { key: 'claim', header: 'Claim' },
  { key: 'targetRole', header: 'Target role' },
  { key: 'priority', header: 'Priority' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: '' },
];

const ssoGroupMappingHeaders = [
  { key: 'provider', header: 'Provider' },
  { key: 'claim', header: 'Claim' },
  { key: 'targetGroup', header: 'Target group' },
  { key: 'mode', header: 'Sync' },
  { key: 'priority', header: 'Priority' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: '' },
];

const ssoSyncRunHeaders = [
  { key: 'status', header: 'Status' },
  { key: 'provider', header: 'Provider' },
  { key: 'user', header: 'User' },
  { key: 'trigger', header: 'Trigger' },
  { key: 'changes', header: 'Changes' },
  { key: 'started', header: 'Started' },
  { key: 'duration', header: 'Duration' },
  { key: 'error', header: 'Error' },
  { key: 'actions', header: '' },
];

const ssoSyncEventHeaders = [
  { key: 'severity', header: 'Severity' },
  { key: 'type', header: 'Type' },
  { key: 'message', header: 'Message' },
  { key: 'resource', header: 'Resource' },
  { key: 'mapping', header: 'Mapping' },
  { key: 'created', header: 'Created' },
  { key: 'details', header: 'Details' },
];

const ssoEngineAccessSnapshotHeaders = [
  { key: 'principal', header: 'Principal' },
  { key: 'engine', header: 'Engine' },
  { key: 'roles', header: 'Current roles' },
  { key: 'status', header: 'Status' },
  { key: 'mapping', header: 'Mapping' },
  { key: 'lastSync', header: 'Last sync' },
  { key: 'lineage', header: 'Lineage' },
];

interface SsoPlatformMappingTestResult {
  resolvedRole: string;
  matchedMappings: Array<{ id: string; name: string; targetRole: string }>;
}

interface SsoGroupMappingTestResult {
  matchedMappings: SsoGroupMapping[];
  memberships: Array<{ groupId: string; mappingId: string }>;
}

interface SsoAssignmentTestResult {
  matchedMappings: Array<SsoAssignmentMapping & { targetResourceId: string | null; targetResourceIds: Array<string | null> }>;
  assignments: Array<{ roleId: string; resourceType: 'engine'; resourceId: string | null; mappingId: string }>;
}

interface SsoAssignmentDiagnostics {
  activeMappings: number;
  inactiveMappings: number;
  authoritativeMappings: number;
  additiveMappings: number;
  allEngineSelectors: number;
  targetWarnings: Array<{ mapping: SsoAssignmentMapping; warning: string }>;
  staleAssignments: RoleAssignment[];
  ssoAssignmentCount: number;
  targetSummaries: Array<{ mapping: SsoAssignmentMapping; summary: string; warning: string | null }>;
}

const roleAssignmentHeaders = [
  { key: 'principal', header: 'Principal' },
  { key: 'role', header: 'Role' },
  { key: 'resource', header: 'Resource' },
  { key: 'source', header: 'Source' },
  { key: 'actions', header: '' },
];

const principalOverviewHeaders = [
  { key: 'principal', header: 'Principal' },
  { key: 'type', header: 'Type' },
  { key: 'directAssignments', header: 'Direct' },
  { key: 'inheritedAssignments', header: 'Inherited' },
  { key: 'relationships', header: 'Relationships' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: '' },
];

const principalAssignmentHeaders = [
  { key: 'grantType', header: 'Grant' },
  { key: 'role', header: 'Role' },
  { key: 'scope', header: 'Scope' },
  { key: 'source', header: 'Source' },
  { key: 'lineage', header: 'Lineage' },
  { key: 'audit', header: 'Audit' },
  { key: 'expires', header: 'Expires' },
];

const principalRelationshipHeaders = [
  { key: 'name', header: 'Name' },
  { key: 'type', header: 'Type' },
  { key: 'source', header: 'Source' },
  { key: 'lineage', header: 'Lineage' },
  { key: 'audit', header: 'Audit' },
  { key: 'expires', header: 'Expires' },
];

const resourceOverviewHeaders = [
  { key: 'resource', header: 'Resource' },
  { key: 'type', header: 'Type' },
  { key: 'assignments', header: 'Assignments' },
  { key: 'users', header: 'Users' },
  { key: 'groups', header: 'Groups' },
  { key: 'machines', header: 'Machines' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: '' },
];

const resourceAssignmentHeaders = [
  { key: 'principal', header: 'Principal' },
  { key: 'principalType', header: 'Principal type' },
  { key: 'role', header: 'Role' },
  { key: 'source', header: 'Source' },
  { key: 'lineage', header: 'Lineage' },
  { key: 'audit', header: 'Audit' },
  { key: 'expires', header: 'Expires' },
];

const resourceRelationshipHeaders = [
  { key: 'name', header: 'Name' },
  { key: 'type', header: 'Type' },
  { key: 'status', header: 'Status' },
  { key: 'source', header: 'Source' },
  { key: 'details', header: 'Details' },
];

const effectiveAccessSourceHeaders = [
  { key: 'type', header: 'Source' },
  { key: 'grant', header: 'Grant' },
  { key: 'principal', header: 'Principal' },
  { key: 'scope', header: 'Scope' },
  { key: 'lineage', header: 'Lineage' },
  { key: 'audit', header: 'Audit' },
];

const authzGroupHeaders = [
  { key: 'name', header: 'Group' },
  { key: 'key', header: 'Key' },
  { key: 'source', header: 'Source' },
  { key: 'members', header: 'Members' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: '' },
];

const authzGroupMembershipHeaders = [
  { key: 'userId', header: 'User ID' },
  { key: 'source', header: 'Source' },
  { key: 'expires', header: 'Expires' },
  { key: 'created', header: 'Created' },
  { key: 'actions', header: '' },
];

const apiClientHeaders = [
  { key: 'name', header: 'Client' },
  { key: 'prefix', header: 'Token prefix' },
  { key: 'scopes', header: 'Scopes' },
  { key: 'created', header: 'Created' },
  { key: 'lastUsed', header: 'Last used' },
  { key: 'status', header: 'Status' },
  { key: 'audit', header: 'Audit' },
  { key: 'actions', header: '' },
];

const serviceAccountHeaders = [
  { key: 'name', header: 'Service account' },
  { key: 'prefix', header: 'Token prefix' },
  { key: 'scopes', header: 'Scopes' },
  { key: 'description', header: 'Description' },
  { key: 'created', header: 'Created' },
  { key: 'lastUsed', header: 'Last used' },
  { key: 'status', header: 'Status' },
  { key: 'audit', header: 'Audit' },
  { key: 'actions', header: '' },
];

const externalEngineHeaders = [
  { key: 'name', header: 'Engine' },
  { key: 'externalId', header: 'External ID' },
  { key: 'system', header: 'System' },
  { key: 'mode', header: 'Mode' },
  { key: 'lifecycle', header: 'Lifecycle' },
  { key: 'drift', header: 'Drift' },
  { key: 'capability', header: 'Capabilities' },
  { key: 'diagnostics', header: 'Diagnostics' },
  { key: 'ownership', header: 'Ownership' },
  { key: 'labels', header: 'Labels' },
  { key: 'source', header: 'Source' },
  { key: 'lastSync', header: 'Last sync' },
  { key: 'actions', header: '' },
];

const externalEngineSystemHeaders = [
  { key: 'name', header: 'System' },
  { key: 'key', header: 'Key' },
  { key: 'mode', header: 'Default mode' },
  { key: 'ownership', header: 'Default ownership' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: '' },
];

const externalEngineAuditHeaders = [
  { key: 'action', header: 'Action' },
  { key: 'actor', header: 'Actor' },
  { key: 'details', header: 'Details' },
  { key: 'created', header: 'Created' },
];

const engineSetHeaders = [
  { key: 'name', header: 'Engine Set' },
  { key: 'key', header: 'Key' },
  { key: 'selector', header: 'Selector' },
  { key: 'engines', header: 'Engines' },
  { key: 'source', header: 'Source' },
  { key: 'status', header: 'Status' },
  { key: 'materialized', header: 'Materialized' },
  { key: 'actions', header: '' },
];

const engineSetMaterializationHeaders = [
  { key: 'engine', header: 'Engine' },
  { key: 'source', header: 'Source' },
  { key: 'matched', header: 'Matched by' },
  { key: 'seen', header: 'Last seen' },
];

const engineSetAssignmentUsageHeaders = [
  { key: 'principal', header: 'Principal' },
  { key: 'role', header: 'Role' },
  { key: 'source', header: 'Source' },
  { key: 'created', header: 'Created' },
];

const engineSetAuditPreviewHeaders = [
  { key: 'timestamp', header: 'Timestamp' },
  { key: 'decision', header: 'Decision' },
  { key: 'action', header: 'Action' },
  { key: 'user', header: 'User' },
  { key: 'reason', header: 'Reason' },
];

const projectEngineTargetHeaders = [
  { key: 'project', header: 'Project' },
  { key: 'engine', header: 'Engine' },
  { key: 'environment', header: 'Environment' },
  { key: 'status', header: 'Status' },
  { key: 'source', header: 'Source' },
  { key: 'modes', header: 'Modes' },
  { key: 'approval', header: 'Approval' },
  { key: 'external', header: 'External refs' },
  { key: 'diagnostics', header: 'Diagnostics' },
  { key: 'actions', header: '' },
];

const authzPolicyHeaders = [
  { key: 'name', header: 'Policy' },
  { key: 'effect', header: 'Effect' },
  { key: 'resourceType', header: 'Resource' },
  { key: 'action', header: 'Action' },
  { key: 'priority', header: 'Priority' },
  { key: 'conditions', header: 'Conditions' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: '' },
];

const policyInspectionHeaders = [
  { key: 'policy', header: 'Policy' },
  { key: 'effect', header: 'Effect' },
  { key: 'scope', header: 'Scope' },
  { key: 'action', header: 'Action' },
  { key: 'conditions', header: 'Conditions' },
  { key: 'priority', header: 'Priority' },
  { key: 'reason', header: 'Why shown' },
];

const authzAuditHeaders = [
  { key: 'timestamp', header: 'Timestamp' },
  { key: 'decision', header: 'Decision' },
  { key: 'action', header: 'Action' },
  { key: 'user', header: 'User' },
  { key: 'resource', header: 'Resource' },
  { key: 'reason', header: 'Reason' },
  { key: 'policy', header: 'Policy' },
  { key: 'context', header: 'Context' },
  { key: 'network', header: 'Network' },
];

type AuthzAuditDecisionFilter = 'all' | 'allow' | 'deny';
type AccessControlTabId =
  | 'roles'
  | 'permissions'
  | 'assignments'
  | 'by_principal'
  | 'by_resource'
  | 'groups'
  | 'effective_access'
  | 'sso_mappings'
  | 'sso_engine_assignments'
  | 'engine_sets'
  | 'runtime_resources'
  | 'project_targets'
  | 'policies'
  | 'audit'
  | 'external_registration';

const AUTHZ_AUDIT_DECISION_FILTERS: Array<{ id: AuthzAuditDecisionFilter; label: string }> = [
  { id: 'all', label: 'All decisions' },
  { id: 'allow', label: 'Allowed only' },
  { id: 'deny', label: 'Denied only' },
];

const ACCESS_CONTROL_TAB_LABELS: Record<AccessControlTabId, string> = {
  roles: 'Roles',
  permissions: 'Permissions',
  assignments: 'Assignments',
  by_principal: 'By Principal',
  by_resource: 'By Resource',
  groups: 'Groups',
  effective_access: 'Effective Access',
  sso_mappings: 'SSO Mappings',
  sso_engine_assignments: 'SSO Engine Assignments',
  engine_sets: 'Engine Sets',
  runtime_resources: 'Runtime Resources',
  project_targets: 'Project Targets',
  policies: 'Policies',
  audit: 'Audit',
  external_registration: 'External Registration',
};

const AUTHZ_AUDIT_LIMITS = [
  { id: 25, label: '25 events' },
  { id: 50, label: '50 events' },
  { id: 100, label: '100 events' },
  { id: 250, label: '250 events' },
];

interface AuthzAuditFilterState {
  userId: string;
  resourceType: string;
  resourceId: string;
  decision: AuthzAuditDecisionFilter;
  limit: number;
}

const DEFAULT_AUTHZ_AUDIT_FILTER: AuthzAuditFilterState = {
  userId: '',
  resourceType: '',
  resourceId: '',
  decision: 'all',
  limit: 50,
};

const EXTERNAL_ENGINE_AUDIT_FILTERS: Array<{ id: ExternalEngineAuditAction; label: string }> = [
  { id: 'all', label: 'All registration events' },
  { id: 'engine.external_registration.create', label: 'Created' },
  { id: 'engine.external_registration.update', label: 'Updated' },
  { id: 'engine.external_registration.decommission', label: 'Decommissioned' },
  { id: 'engine.external_registration.reactivate', label: 'Reactivated' },
  { id: 'engine.external_registration.reconcile', label: 'Reconciled' },
];

const MACHINE_ASSIGNABLE_SYSTEM_ROLE_IDS = new Set([
  'system.api.engine_registrar',
  'system.api.external_engine_system_registrar',
  'system.project.deployer',
  'system.engine.operator',
  'system.engine.deployer',
]);

const API_CLIENT_SCOPE_OPTIONS = [
  { id: 'config:bundle:manage', label: 'Configuration bundles' },
  { id: 'engine:register', label: 'Engine registration' },
  { id: 'deployment:execute', label: 'Deployment execution' },
];

const SERVICE_ACCOUNT_SCOPE_OPTIONS = [
  { id: 'deployment:execute', label: 'Deployment execution' },
];

const EXTERNAL_SYSTEM_MODE_OPTIONS: Array<{ id: Exclude<EngineManagementMode, 'manual'>; label: string }> = [
  { id: 'external_managed', label: 'External managed' },
  { id: 'hybrid', label: 'Hybrid' },
];

const EXTERNAL_SYSTEM_OWNERSHIP_FIELDS: Array<{ id: keyof EngineFieldOwnership; label: string }> = [
  { id: 'connection', label: 'Connection' },
  { id: 'auth', label: 'Authentication' },
  { id: 'display', label: 'Display' },
];

const DEFAULT_EXTERNAL_SYSTEM_OWNERSHIP: EngineFieldOwnership = {
  connection: 'external',
  auth: 'external',
  display: 'manual',
};

const DEFAULT_EXTERNAL_SYSTEM_FORM = {
  key: '',
  name: '',
  description: '',
  defaultManagementMode: 'external_managed' as Exclude<EngineManagementMode, 'manual'>,
  defaultFieldOwnership: DEFAULT_EXTERNAL_SYSTEM_OWNERSHIP,
};

type EngineSetSelectorMode = EngineSetSelector['mode'];

interface EngineSetFormState {
  key: string;
  name: string;
  description: string;
  selectorMode: EngineSetSelectorMode;
  engineIds: string;
  labelKey: string;
  labelValue: string;
  labelMatch: 'all' | 'any';
}

const DEFAULT_ENGINE_SET_FORM: EngineSetFormState = {
  key: '',
  name: '',
  description: '',
  selectorMode: 'labels',
  engineIds: '',
  labelKey: '',
  labelValue: '',
  labelMatch: 'all',
};

interface ProjectEngineTargetFormState {
  id: string | null;
  projectId: string;
  engineId: string;
  status: ProjectEngineTargetStatus;
  allowManualDeploy: boolean;
  allowCiDeploy: boolean;
  allowApiDeploy: boolean;
  allowImport: boolean;
  sourceRef: string;
  externalSystemId: string;
  externalProjectId: string;
  externalEngineId: string;
  externalTargetId: string;
  policyTags: string;
}

const DEFAULT_PROJECT_ENGINE_TARGET_FORM: ProjectEngineTargetFormState = {
  id: null,
  projectId: '',
  engineId: '',
  status: 'active',
  allowManualDeploy: true,
  allowCiDeploy: false,
  allowApiDeploy: false,
  allowImport: false,
  sourceRef: '',
  externalSystemId: '',
  externalProjectId: '',
  externalEngineId: '',
  externalTargetId: '',
  policyTags: '',
};

const PROJECT_ENGINE_TARGET_STATUSES: Array<{ id: ProjectEngineTargetStatus; label: string }> = [
  { id: 'active', label: 'Active' },
  { id: 'disabled', label: 'Disabled' },
  { id: 'archived', label: 'Archived' },
];

const PROJECT_ENGINE_TARGET_MODES: Array<{ id: ProjectEngineTargetMode; label: string }> = [
  { id: 'manual', label: 'Manual' },
  { id: 'ci', label: 'CI' },
  { id: 'api', label: 'API' },
  { id: 'import', label: 'Import' },
];

const SOURCE_OWNED_PROJECT_TARGET_SOURCES = new Set<ProjectEngineTargetSource>(['ci', 'api', 'external', 'system', 'automation', 'config']);

const POLICY_EFFECTS: Array<{ id: AuthzPolicy['effect']; label: string }> = [
  { id: 'allow', label: 'Allow' },
  { id: 'deny', label: 'Deny' },
];

const POLICY_RESOURCE_TYPES: Array<{ id: string; label: string }> = [
  { id: '', label: 'All resources' },
  { id: 'platform', label: 'Platform' },
  { id: 'project', label: 'Project' },
  { id: 'engine', label: 'Engine' },
  { id: 'engine_set', label: 'Engine Set' },
  { id: 'project_engine_target', label: 'Project-engine target' },
  { id: 'api_client', label: 'API client' },
  { id: 'sso_mapping', label: 'SSO mapping' },
];

interface AuthzPolicyFormState {
  name: string;
  description: string;
  effect: AuthzPolicy['effect'];
  priority: number;
  resourceType: string;
  action: string;
}

const DEFAULT_AUTHZ_POLICY_FORM: AuthzPolicyFormState = {
  name: '',
  description: '',
  effect: 'deny',
  priority: 100,
  resourceType: '',
  action: '',
};

interface AuthzGroupFormState {
  key: string;
  name: string;
  description: string;
}

const DEFAULT_AUTHZ_GROUP_FORM: AuthzGroupFormState = {
  key: '',
  name: '',
  description: '',
};

interface SsoPlatformMappingFormState {
  providerId: string;
  claimType: SsoClaimsMapping['claimType'];
  claimKey: string;
  claimValue: string;
  claimOperator: SsoClaimOperator | '';
  targetRole: SsoClaimsMapping['targetRole'];
  priority: number;
  isActive: boolean;
}

const DEFAULT_SSO_PLATFORM_MAPPING_FORM: SsoPlatformMappingFormState = {
  providerId: '',
  claimType: 'group',
  claimKey: 'groups',
  claimValue: '',
  claimOperator: '',
  targetRole: 'user',
  priority: 0,
  isActive: true,
};

interface SsoGroupMappingFormState {
  providerId: string;
  claimType: SsoGroupMapping['claimType'];
  claimKey: string;
  claimValue: string;
  claimOperator: SsoClaimOperator | '';
  targetGroupId: string;
  syncMode: SsoGroupMapping['syncMode'];
  priority: number;
  isActive: boolean;
}

const DEFAULT_SSO_GROUP_MAPPING_FORM: SsoGroupMappingFormState = {
  providerId: '',
  claimType: 'group',
  claimKey: 'groups',
  claimValue: '',
  claimOperator: '',
  targetGroupId: '',
  syncMode: 'authoritative',
  priority: 0,
  isActive: true,
};

function DataTableHeaderCell({
  header,
  getHeaderProps,
}: {
  header: any;
  getHeaderProps: (args: { header: any }) => Record<string, any>;
}) {
  const { key, ...headerProps } = getHeaderProps({ header });
  return <TableHeader key={key || dataTableHeaderKey(header)} {...headerProps}>{header.header}</TableHeader>;
}

function dataTableHeaderKey(header: any): React.Key {
  return String(header.key || header.header || 'header');
}

function DataTableDataRow({
  row,
  getRowProps,
  children,
}: {
  row: any;
  getRowProps: (args: { row: any }) => Record<string, any>;
  children: React.ReactNode;
}) {
  const { key, ...rowProps } = getRowProps({ row });
  return <TableRow key={key || row.id} {...rowProps}>{children}</TableRow>;
}

function scopeTag(scope: string) {
  if (scope === 'platform') return <Tag type="purple">Platform</Tag>;
  if (scope === 'project') return <Tag type="blue">Project</Tag>;
  if (scope === 'external_engine_system') return <Tag type="cyan">External system</Tag>;
  return <Tag type="teal">Engine</Tag>;
}

function roleLabel(roleId: string, roles: RoleSummary[] = []) {
  return roles.find((role) => role.id === roleId)?.name || SYSTEM_SSO_TARGET_ROLES.find((role) => role.id === roleId)?.label || roleId;
}

function selectorLabel(mapping: SsoAssignmentMapping) {
  if (mapping.targetSelectorType === 'all_engines') return 'All engines';
  if (mapping.targetSelectorType === 'external_engine_id') return mapping.targetExternalEngineId || '';
  if (mapping.targetSelectorType === 'engine_label') return `${mapping.targetLabelKey || ''}=${mapping.targetLabelValue || ''}`;
  return mapping.targetEngineId || '';
}

function ssoClaimDefaultKey(claimType: SsoClaimsMapping['claimType']) {
  if (claimType === 'group') return 'groups';
  if (claimType === 'role') return 'roles';
  if (claimType === 'email_domain') return 'email';
  return '';
}

function ssoClaimOperatorRequiresValue(operator?: SsoClaimOperator | null) {
  return operator !== 'exists' && operator !== 'not_exists';
}

function ssoClaimOperatorIsRegex(operator?: SsoClaimOperator | null) {
  return operator === 'matches_regex' || operator === 'not_matches_regex';
}

function ssoClaimOperatorLabel(operator?: SsoClaimOperator | null) {
  return CLAIM_OPERATORS.find((item) => item.id === (operator || ''))?.label || operator || 'Wildcard compatibility';
}

function ssoClaimLabel(mapping: Pick<SsoClaimsMapping, 'claimType' | 'claimKey' | 'claimValue' | 'claimOperator'>) {
  const operator = ssoClaimOperatorLabel(mapping.claimOperator);
  const value = mapping.claimValue || '(no value)';
  return `${mapping.claimType}:${mapping.claimKey} ${operator} ${value}`;
}

function providerLabel(providerId: string | null | undefined) {
  return providerId || 'Any provider';
}

function platformRoleLabel(role: SsoClaimsMapping['targetRole'] | string) {
  return SSO_PLATFORM_TARGET_ROLES.find((item) => item.id === role)?.label || role;
}

function formatLabels(labels: Record<string, string>) {
  const entries = Object.entries(labels);
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(', ') : '-';
}

function formatFieldOwnership(ownership?: Record<string, 'manual' | 'external'>) {
  const entries = Object.entries(ownership || {});
  if (!entries.length) return '-';
  const external = entries.filter(([, owner]) => owner === 'external').map(([key]) => key).join(', ');
  const manual = entries.filter(([, owner]) => owner === 'manual').map(([key]) => key).join(', ');
  return [
    external ? `External: ${external}` : '',
    manual ? `Manual: ${manual}` : '',
  ].filter(Boolean).join(' | ') || '-';
}

function formatStatusLabel(value: string | null | undefined) {
  if (!value) return '-';
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getLifecycleTagType(value: string | null | undefined) {
  if (value === 'active') return 'green';
  if (value === 'disabled') return 'gray';
  if (value === 'stale') return 'magenta';
  if (value === 'decommissioned') return 'red';
  return 'gray';
}

function getDriftTagType(value: string | null | undefined) {
  if (value === 'in_sync') return 'green';
  if (value === 'manual_override') return 'magenta';
  if (value === 'decommissioned') return 'red';
  return 'gray';
}

function getCapabilityTagType(value: string | null | undefined) {
  if (value === 'in_sync') return 'green';
  if (value === 'mismatch') return 'red';
  return 'gray';
}

function formatCapabilityDiagnostics(diagnostics?: ExternalEngineCapabilityDiagnostics | null) {
  if (!diagnostics) return '-';
  if (diagnostics.status === 'in_sync') return 'All expected operations reported';
  if (diagnostics.reportedOperations.length === 0) return 'No operation capabilities reported';
  if (diagnostics.missingOperations.length > 0) return `Missing: ${diagnostics.missingOperations.join(', ')}`;
  if (diagnostics.extraOperations.length > 0) return `Extra: ${diagnostics.extraOperations.join(', ')}`;
  return diagnostics.issues[0] || diagnostics.recommendation || '-';
}

function formatReconcileSummary(result: ExternalEngineReconcileResponse) {
  const capability = formatCapabilityDiagnostics(result.capabilityDiagnostics);
  const materialization = result.materializationDiagnostics?.summary || 'Engine Sets checked';
  return `${capability}. ${materialization}.`;
}

function formatEngineSetSelector(selector: EngineSetSelector) {
  if (selector.mode === 'all') return 'All active engines';
  if (selector.mode === 'engine_ids') return `Engine IDs: ${selector.engineIds.join(', ') || '-'}`;
  const labels = Object.entries(selector.labels || {})
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
  return `Labels (${selector.labelMatch || 'all'}): ${labels || '-'}`;
}

function formatEngineSetMatchedBy(matchedBy: Record<string, unknown>) {
  const entries = Object.entries(matchedBy || {});
  return entries.length ? entries.map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`).join(', ') : '-';
}

function formatEffectiveAccessGrant(source: EffectiveAccessSource) {
  if (source.roleId) return source.roleId;
  if (source.role) return source.role;
  if (source.permission) return source.permission;
  return '-';
}

function formatEffectiveAccessPrincipal(source: EffectiveAccessSource) {
  if (source.principalType === 'group' && (source.groupName || source.groupKey || source.groupId)) {
    return `group:${source.groupName || source.groupKey || source.groupId}`;
  }
  if (!source.principalType && !source.principalId) return '-';
  return `${source.principalType || 'principal'}:${source.principalId || '-'}`;
}

function formatEffectiveAccessScope(source: EffectiveAccessSource) {
  if (source.engineSetId) {
    const engineSetLabel = source.engineSetName || source.engineSetKey || source.engineSetId;
    return `Engine Set: ${engineSetLabel}`;
  }
  if (source.scopeType || source.scopeId) {
    return `${source.scopeType || 'scope'}:${source.scopeId || 'all'}`;
  }
  return '-';
}

function formatSsoMappingLineage(source: EffectiveAccessSource) {
  const mapping = source.ssoMapping;
  if (!mapping) return null;
  const operator = mapping.claimOperator || 'matches';
  return `SSO mapping: ${mapping.claimType} ${mapping.claimKey} ${operator} ${mapping.claimValue}`;
}

function formatSsoGroupMappingLineage(source: EffectiveAccessSource) {
  const mapping = source.ssoGroupMapping;
  if (!mapping) return null;
  const operator = mapping.claimOperator || 'matches';
  return `SSO group: ${mapping.claimType} ${mapping.claimKey} ${operator} ${mapping.claimValue}`;
}

function formatIdentityEntitlementMappingLineage(source: EffectiveAccessSource) {
  const mapping = source.identityEntitlementMapping;
  if (!mapping) return null;
  const value = mapping.matchOperator === 'exists' ? 'any value' : mapping.externalId || '-';
  return `Identity mapping: ${mapping.entitlementType} ${mapping.matchOperator} ${value}`;
}

function formatEngineRegistrationLineage(source: EffectiveAccessSource) {
  const registration = source.engineRegistration;
  if (!registration) return null;
  const parts = [
    registration.registrationSource || 'manual',
    registration.externalId ? `externalId=${registration.externalId}` : null,
    registration.externalSystemId ? `system=${registration.externalSystemId}` : null,
    registration.lifecycleStatus ? `lifecycle=${registration.lifecycleStatus}` : null,
  ].filter((part): part is string => Boolean(part));
  return `Engine registration: ${parts.join(' ') || registration.engineId}`;
}

function formatEffectiveAccessLineage(source: EffectiveAccessSource) {
  const parts = [
    source.source ? `Assignment source: ${source.source}` : null,
    source.groupMembership ? `Group membership: ${source.groupMembership.source}` : null,
    formatIdentityEntitlementMappingLineage(source),
    formatSsoGroupMappingLineage(source),
    formatSsoMappingLineage(source),
    source.selectorFingerprint ? `Selector: ${source.selectorFingerprint}` : null,
    formatEngineRegistrationLineage(source),
    source.matchedBy ? `Matched by: ${formatEngineSetMatchedBy(source.matchedBy)}` : null,
    source.lineage ? `Lineage: ${formatEngineSetMatchedBy(source.lineage)}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' | ') : '-';
}

function engineSetFormFromSummary(engineSet: EngineSetSummary): EngineSetFormState {
  const selector = engineSet.selector;
  if (selector.mode === 'engine_ids') {
    return {
      key: engineSet.key,
      name: engineSet.name,
      description: engineSet.description || '',
      selectorMode: 'engine_ids',
      engineIds: selector.engineIds.join(', '),
      labelKey: '',
      labelValue: '',
      labelMatch: 'all',
    };
  }
  if (selector.mode === 'all') {
    return {
      key: engineSet.key,
      name: engineSet.name,
      description: engineSet.description || '',
      selectorMode: 'all',
      engineIds: '',
      labelKey: '',
      labelValue: '',
      labelMatch: 'all',
    };
  }
  const [labelKey = '', labelValue = ''] = Object.entries(selector.labels || {})[0] || [];
  return {
    key: engineSet.key,
    name: engineSet.name,
    description: engineSet.description || '',
    selectorMode: 'labels',
    engineIds: '',
    labelKey,
    labelValue,
    labelMatch: selector.labelMatch || 'all',
  };
}

export function buildEngineSetSelector(form: EngineSetFormState): EngineSetSelector {
  if (form.selectorMode === 'all') return { mode: 'all' };
  if (form.selectorMode === 'engine_ids') {
    return {
      mode: 'engine_ids',
      engineIds: form.engineIds.split(',').map((item) => item.trim()).filter(Boolean),
    };
  }
  return {
    mode: 'labels',
    labels: form.labelKey.trim() && form.labelValue.trim() ? { [form.labelKey.trim()]: form.labelValue.trim() } : {},
    labelMatch: form.labelMatch,
  };
}

function getEngineSetSelectorRiskReasons(selector: EngineSetSelector) {
  const riskReasons: Array<'all_engines_selector' | 'any_label_match'> = [];
  if (selector.mode === 'all') {
    riskReasons.push('all_engines_selector');
  }
  if (selector.mode === 'labels' && selector.labelMatch === 'any') {
    riskReasons.push('any_label_match');
  }
  return riskReasons;
}

function engineSetSelectorRiskDescription(reason: 'all_engines_selector' | 'any_label_match') {
  if (reason === 'all_engines_selector') {
    return 'This Engine Set can include every active engine visible to this tenant.';
  }
  return 'This Engine Set can include engines that match only one configured label.';
}

function isSourceOwnedProjectTarget(target: ProjectEngineTarget) {
  return SOURCE_OWNED_PROJECT_TARGET_SOURCES.has(target.source) && !(target.source === 'config' && target.ownershipMode === 'config_warn');
}

function isSourceOwnedEngineSet(engineSet: EngineSetSummary) {
  return engineSet.source !== 'manual' && !(engineSet.source === 'config' && engineSet.ownershipMode === 'config_warn');
}

function engineSetSourceOwnershipReason(engineSet: EngineSetSummary) {
  const owner = engineSet.source.replace(/_/g, ' ');
  return `Managed by ${owner}${engineSet.sourceRef ? ` (${engineSet.sourceRef})` : ''}`;
}

function formatProjectEngineTargetModes(target: ProjectEngineTarget) {
  return [
    target.allowManualDeploy ? 'Manual' : '',
    target.allowCiDeploy ? 'CI' : '',
    target.allowApiDeploy ? 'API' : '',
    target.allowImport ? 'Import' : '',
  ].filter(Boolean).join(', ') || '-';
}

function formatProjectEngineTargetExternalRefs(target: ProjectEngineTarget) {
  const refs = [
    target.externalSystemId ? `system=${target.externalSystemId}` : '',
    target.externalProjectId ? `project=${target.externalProjectId}` : '',
    target.externalEngineId ? `engine=${target.externalEngineId}` : '',
    target.externalTargetId ? `target=${target.externalTargetId}` : '',
  ].filter(Boolean);
  return refs.length ? refs.join(', ') : '-';
}

function formatProjectEngineTargetDiagnostics(target: ProjectEngineTarget) {
  const parts = [
    target.policyTags.length ? `Policies: ${target.policyTags.join(', ')}` : '',
    target.diagnostics ? formatDetails(target.diagnostics) : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' | ') : '-';
}

function formatPolicyConditions(conditions: PolicyCondition) {
  const keys = Object.keys(conditions || {});
  return keys.length ? keys.join(', ') : 'None';
}

function formatPolicyInspectionScope(policy: AuthzPolicy) {
  return policy.resourceType || 'All resources';
}

function formatPolicyInspectionAction(policy: AuthzPolicy) {
  return policy.action || 'All actions';
}

function sortPoliciesForInspection(a: AuthzPolicy, b: AuthzPolicy) {
  if (a.effect !== b.effect) return a.effect === 'deny' ? -1 : 1;
  return b.priority - a.priority || a.name.localeCompare(b.name);
}

function buildPolicyInspectionRows(policies: AuthzPolicy[], reasonFor: (policy: AuthzPolicy) => string) {
  return policies
    .filter((policy) => policy.isActive)
    .slice()
    .sort(sortPoliciesForInspection)
    .map((policy) => ({
      id: policy.id,
      policy: policy.name,
      effect: policy.effect,
      scope: formatPolicyInspectionScope(policy),
      action: formatPolicyInspectionAction(policy),
      conditions: formatPolicyConditions(policy.conditions),
      priority: policy.priority,
      reason: reasonFor(policy),
    }));
}

function getPolicyInspectionRowsForAssignments(policies: AuthzPolicy[], assignments: RoleAssignment[]) {
  const scopedResourceTypes = new Set(assignments.map((assignment) => getAssignmentResourceType(assignment)));
  const matchingPolicies = policies.filter((policy) =>
    !policy.resourceType || scopedResourceTypes.has(policy.resourceType as AuthzResourceType)
  );
  return buildPolicyInspectionRows(matchingPolicies, (policy) =>
    policy.resourceType
      ? `Matches ${policy.resourceType} scope from this principal's effective role assignments.`
      : 'Global policy can affect any effective grant for this principal.'
  );
}

function getPolicyInspectionRowsForResource(policies: AuthzPolicy[], resource: ResourceSummary | null) {
  if (!resource) return [];
  const matchingPolicies = policies.filter((policy) => !policy.resourceType || policy.resourceType === resource.type);
  return buildPolicyInspectionRows(matchingPolicies, (policy) =>
    policy.resourceType
      ? `Matches selected ${authzResourceTypeLabel(resource.type)} resource type.`
      : 'Global policy can affect this resource.'
  );
}

function getPolicyConditionsJson(policy: AuthzPolicy | null) {
  return JSON.stringify(policy?.conditions || {}, null, 2);
}

function isEditableGroup(group: AuthzGroup) {
  return !group.isSystem && (group.source === 'manual' || (group.source === 'config' && group.ownershipMode === 'config_warn'));
}

function projectEngineTargetFormFromTarget(target: ProjectEngineTarget): ProjectEngineTargetFormState {
  return {
    id: target.id,
    projectId: target.projectId,
    engineId: target.engineId,
    status: target.status,
    allowManualDeploy: target.allowManualDeploy,
    allowCiDeploy: target.allowCiDeploy,
    allowApiDeploy: target.allowApiDeploy,
    allowImport: target.allowImport,
    sourceRef: target.sourceRef || '',
    externalSystemId: target.externalSystemId || '',
    externalProjectId: target.externalProjectId || '',
    externalEngineId: target.externalEngineId || '',
    externalTargetId: target.externalTargetId || '',
    policyTags: target.policyTags.join(', '),
  };
}

function projectEngineTargetPayloadFromForm(form: ProjectEngineTargetFormState) {
  return {
    projectId: form.projectId.trim(),
    engineId: form.engineId.trim(),
    status: form.status,
    source: 'manual' as const,
    sourceRef: form.sourceRef.trim() || null,
    externalSystemId: form.externalSystemId.trim() || null,
    externalProjectId: form.externalProjectId.trim() || null,
    externalEngineId: form.externalEngineId.trim() || null,
    externalTargetId: form.externalTargetId.trim() || null,
    allowManualDeploy: form.allowManualDeploy,
    allowCiDeploy: form.allowCiDeploy,
    allowApiDeploy: form.allowApiDeploy,
    allowImport: form.allowImport,
    policyTags: form.policyTags.split(',').map((item) => item.trim()).filter(Boolean),
  };
}

function formatDeploymentEligibility(result: DeploymentEligibilityResult) {
  if (result.allowed) return 'Allowed';
  return result.reasons.length ? result.reasons.join('; ') : 'Denied';
}

function formatDetails(details: Record<string, unknown> | null) {
  if (!details) return '-';
  const entries = Object.entries(details);
  return entries.length ? entries.map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`).join(', ') : '-';
}

function formatTimestamp(value: number | null | undefined) {
  return value ? new Date(value).toLocaleString() : '-';
}

function getSsoSyncStatusTagType(status: SsoSyncRun['status']) {
  if (status === 'success') return 'green';
  if (status === 'failed') return 'red';
  return 'blue';
}

function getSsoSyncSeverityTagType(severity: SsoSyncEvent['severity']) {
  if (severity === 'error') return 'red';
  if (severity === 'warning') return 'magenta';
  return 'gray';
}

function getSsoEngineSnapshotStatusTagType(status: SsoEngineAccessSnapshot['status']) {
  if (status === 'active') return 'green';
  if (status === 'stale') return 'magenta';
  if (status === 'provider_identity_missing' || status === 'provider_group_missing' || status === 'engine_no_longer_matches_selector') return 'red';
  if (status === 'removed_by_sso' || status === 'removed_by_admin' || status === 'mapping_disabled') return 'purple';
  return 'gray';
}

function formatSsoSyncCounts(run: SsoSyncRun) {
  const groupChanges = run.groupMembershipsCreated + run.groupMembershipsUpdated + run.groupMembershipsRemoved;
  const assignmentChanges = run.assignmentsCreated + run.assignmentsUpdated + run.assignmentsRemoved;
  return `Groups ${groupChanges}; assignments ${assignmentChanges}`;
}

function formatSsoSyncDuration(run: SsoSyncRun) {
  if (!run.completedAt) return run.status === 'running' ? 'Running' : '-';
  const durationMs = Math.max(run.completedAt - run.startedAt, 0);
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

function formatSsoSyncDetails(details: string | null | undefined) {
  if (!details || details === '{}') return '-';
  try {
    const parsed = JSON.parse(details);
    if (!parsed || typeof parsed !== 'object') return String(parsed);
    return formatDetails(parsed as Record<string, unknown>);
  } catch {
    return details.length > 160 ? `${details.slice(0, 157)}...` : details;
  }
}

function formatSsoSyncResource(event: SsoSyncEvent) {
  if (!event.resourceType) return '-';
  return `${event.resourceType}:${event.resourceId || '*'}`;
}

function formatSsoSyncMapping(event: SsoSyncEvent) {
  const parts = [event.mappingType || '', event.mappingId || ''].filter(Boolean);
  return parts.length ? parts.join(':') : '-';
}

function formatAuditResource(entry: AuthzAuditEntry) {
  if (!entry.resourceType) return 'Platform';
  return `${entry.resourceType}:${entry.resourceId || '*'}`;
}

function formatAuditNetwork(entry: AuthzAuditEntry) {
  const parts = [entry.ipAddress || '', entry.userAgent || ''].filter(Boolean);
  return parts.length ? parts.join(' | ') : '-';
}

function formatAuditContext(context: string | null | undefined) {
  if (!context) return '-';
  try {
    const parsed = JSON.parse(context);
    if (!parsed || typeof parsed !== 'object') return String(parsed);
    const keys = Object.keys(parsed);
    if (keys.length === 0) return '{}';
    return keys.slice(0, 5).join(', ') + (keys.length > 5 ? ` +${keys.length - 5} more` : '');
  } catch {
    return context.length > 120 ? `${context.slice(0, 117)}...` : context;
  }
}

function formatAssignmentPrincipal(
  assignment: RoleAssignment,
  apiClients: ApiClient[],
  groups: AuthzGroup[],
  serviceAccounts: ServiceAccount[],
) {
  const principalType = assignment.principalType || 'user';
  const principalId = assignment.principalId || assignment.userId;
  if (principalType === 'api_client') {
    const client = apiClients.find((item) => item.id === principalId);
    return `API client: ${client?.name || principalId}`;
  }
  if (principalType === 'group') {
    const group = groups.find((item) => item.id === principalId);
    return `Group: ${group?.name || principalId}`;
  }
  if (principalType === 'service_account') {
    const account = serviceAccounts.find((item) => item.id === principalId);
    return `Service account: ${account?.name || principalId}`;
  }
  return principalId;
}

function formatAssignmentResource(assignment: RoleAssignment, externalSystems: ExternalEngineSystem[]) {
  if (assignment.resourceType === 'platform') return 'Platform';
  if (assignment.resourceType === 'external_engine_system') {
    const system = externalSystems.find((item) => item.id === assignment.resourceId);
    return `External system: ${system?.name || assignment.resourceId || ''}`;
  }
  return `${assignment.resourceType || ''}:${assignment.resourceId || ''}`;
}

function principalKey(type: AssignmentPrincipalType, id: string) {
  return `${type}:${id}`;
}

function getAssignmentPrincipalType(assignment: RoleAssignment): AssignmentPrincipalType {
  return (assignment.principalType || 'user') as AssignmentPrincipalType;
}

function getAssignmentPrincipalId(assignment: RoleAssignment) {
  return assignment.principalId || assignment.userId;
}

function principalTypeLabel(type: AssignmentPrincipalType) {
  if (type === 'api_client') return 'API client';
  if (type === 'service_account') return 'Service account';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function getPrincipalLabel(
  type: AssignmentPrincipalType,
  id: string,
  groups: AuthzGroup[],
  apiClients: ApiClient[],
  serviceAccounts: ServiceAccount[],
) {
  if (type === 'group') return groups.find((group) => group.id === id)?.name || id;
  if (type === 'api_client') return apiClients.find((client) => client.id === id)?.name || id;
  if (type === 'service_account') return serviceAccounts.find((account) => account.id === id)?.name || id;
  return id;
}

function getPrincipalDetail(
  type: AssignmentPrincipalType,
  id: string,
  groups: AuthzGroup[],
  apiClients: ApiClient[],
  serviceAccounts: ServiceAccount[],
) {
  if (type === 'group') {
    const group = groups.find((item) => item.id === id);
    return group?.key ? `Group key: ${group.key}` : 'Authorization group';
  }
  if (type === 'api_client') {
    const client = apiClients.find((item) => item.id === id);
    return client?.tokenPrefix ? `Token prefix: ${client.tokenPrefix}` : 'API client';
  }
  if (type === 'service_account') {
    const account = serviceAccounts.find((item) => item.id === id);
    return account?.tokenPrefix ? `Token prefix: ${account.tokenPrefix}` : 'Service account';
  }
  return 'User principal';
}

function getPrincipalStatus(
  type: AssignmentPrincipalType,
  id: string,
  groups: AuthzGroup[],
  apiClients: ApiClient[],
  serviceAccounts: ServiceAccount[],
): PrincipalSummaryStatus {
  if (type === 'group') return groups.find((group) => group.id === id)?.isArchived ? 'archived' : 'active';
  if (type === 'api_client') return apiClients.find((client) => client.id === id)?.isActive ? 'active' : 'revoked';
  if (type === 'service_account') return serviceAccounts.find((account) => account.id === id)?.isActive ? 'active' : 'revoked';
  return 'unknown';
}

function isMembershipEffective(membership: AuthzGroupMembership, now = Date.now()) {
  return !membership.expiresAt || membership.expiresAt > now;
}

function roleAssignmentPrincipalMatches(assignment: RoleAssignment, type: AssignmentPrincipalType, id: string) {
  return getAssignmentPrincipalType(assignment) === type && getAssignmentPrincipalId(assignment) === id;
}

function sortPrincipals(a: PrincipalSummary, b: PrincipalSummary) {
  const typeOrder: Record<AssignmentPrincipalType, number> = {
    user: 0,
    group: 1,
    api_client: 2,
    service_account: 3,
  };
  const typeDiff = typeOrder[a.type] - typeOrder[b.type];
  if (typeDiff !== 0) return typeDiff;
  return a.label.localeCompare(b.label);
}

export function buildPrincipalSummaries(
  assignments: RoleAssignment[],
  groups: AuthzGroup[],
  memberships: AuthzGroupMembership[],
  apiClients: ApiClient[],
  serviceAccounts: ServiceAccount[],
): PrincipalSummary[] {
  const summaries = new Map<string, PrincipalSummary>();
  const ensurePrincipal = (type: AssignmentPrincipalType, id: string) => {
    if (!id) return null;
    const key = principalKey(type, id);
    const existing = summaries.get(key);
    if (existing) return existing;
    const summary: PrincipalSummary = {
      key,
      type,
      id,
      label: getPrincipalLabel(type, id, groups, apiClients, serviceAccounts),
      detail: getPrincipalDetail(type, id, groups, apiClients, serviceAccounts),
      directAssignmentCount: 0,
      inheritedAssignmentCount: 0,
      relationshipCount: 0,
      status: getPrincipalStatus(type, id, groups, apiClients, serviceAccounts),
    };
    summaries.set(key, summary);
    return summary;
  };

  groups.forEach((group) => ensurePrincipal('group', group.id));
  apiClients.forEach((client) => ensurePrincipal('api_client', client.id));
  serviceAccounts.forEach((account) => ensurePrincipal('service_account', account.id));
  memberships.forEach((membership) => {
    ensurePrincipal('user', membership.userId);
    ensurePrincipal('group', membership.groupId);
  });
  assignments.forEach((assignment) => ensurePrincipal(getAssignmentPrincipalType(assignment), getAssignmentPrincipalId(assignment)));

  summaries.forEach((summary) => {
    summary.directAssignmentCount = assignments.filter((assignment) => roleAssignmentPrincipalMatches(assignment, summary.type, summary.id)).length;
    if (summary.type === 'user') {
      const groupIds = new Set(memberships.filter((membership) => membership.userId === summary.id && isMembershipEffective(membership)).map((membership) => membership.groupId));
      summary.inheritedAssignmentCount = assignments.filter((assignment) => getAssignmentPrincipalType(assignment) === 'group' && groupIds.has(getAssignmentPrincipalId(assignment))).length;
      summary.relationshipCount = memberships.filter((membership) => membership.userId === summary.id).length;
    } else if (summary.type === 'group') {
      summary.relationshipCount = memberships.filter((membership) => membership.groupId === summary.id).length;
    } else if (summary.type === 'api_client') {
      summary.relationshipCount = apiClients.find((client) => client.id === summary.id)?.scopes.length || 0;
    } else {
      summary.relationshipCount = serviceAccounts.find((account) => account.id === summary.id)?.scopes.length || 0;
    }
  });

  return Array.from(summaries.values()).sort(sortPrincipals);
}

function resourceKey(type: AuthzResourceType, id: string | null | undefined) {
  return `${type}:${id || ''}`;
}

function getAssignmentResourceType(assignment: RoleAssignment): AuthzResourceType {
  return (assignment.scopeType || assignment.resourceType || 'platform') as AuthzResourceType;
}

function getAssignmentResourceId(assignment: RoleAssignment) {
  return assignment.scopeId || assignment.resourceId || '';
}

function authzResourceTypeLabel(type: AuthzResourceType) {
  if (type === 'engine_set') return 'Engine Set';
  if (type === 'project_engine_target') return 'Project target';
  if (type === 'external_engine_system') return 'External system';
  if (type === 'api_client') return 'API client';
  if (type === 'sso_mapping') return 'SSO mapping';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function getResourceLabel(
  type: AuthzResourceType,
  id: string,
  externalSystems: ExternalEngineSystem[],
  engineSets: EngineSetSummary[],
  externalEngines: ExternalEngineRegistration[],
  projectTargets: ProjectEngineTarget[],
) {
  if (type === 'platform') return 'Platform';
  if (type === 'external_engine_system') return externalSystems.find((system) => system.id === id)?.name || id;
  if (type === 'engine_set') return engineSets.find((engineSet) => engineSet.id === id)?.name || id;
  if (type === 'engine') return externalEngines.find((engine) => engine.id === id)?.name || id;
  if (type === 'project_engine_target') {
    const target = projectTargets.find((item) => item.id === id);
    return target ? `${target.projectName || target.projectId} -> ${target.engineName || target.engineId}` : id;
  }
  if (type === 'project') return projectTargets.find((target) => target.projectId === id)?.projectName || id;
  return id;
}

function getResourceDetail(
  type: AuthzResourceType,
  id: string,
  externalSystems: ExternalEngineSystem[],
  engineSets: EngineSetSummary[],
  externalEngines: ExternalEngineRegistration[],
  projectTargets: ProjectEngineTarget[],
) {
  if (type === 'platform') return 'Global platform scope';
  if (type === 'external_engine_system') {
    const system = externalSystems.find((item) => item.id === id);
    return system?.key ? `External system key: ${system.key}` : 'External engine system';
  }
  if (type === 'engine_set') {
    const engineSet = engineSets.find((item) => item.id === id);
    return engineSet ? `${engineSet.materializedEngineCount} materialized engine${engineSet.materializedEngineCount === 1 ? '' : 's'}` : 'Engine Set';
  }
  if (type === 'engine') {
    const engine = externalEngines.find((item) => item.id === id);
    return engine?.externalId ? `External ID: ${engine.externalId}` : 'Engine';
  }
  if (type === 'project_engine_target') {
    const target = projectTargets.find((item) => item.id === id);
    return target ? `${target.projectId} -> ${target.engineId}` : 'Project-engine target';
  }
  if (type === 'project') return 'Project';
  return authzResourceTypeLabel(type);
}

function getResourceStatus(
  type: AuthzResourceType,
  id: string,
  externalSystems: ExternalEngineSystem[],
  engineSets: EngineSetSummary[],
  externalEngines: ExternalEngineRegistration[],
  projectTargets: ProjectEngineTarget[],
) {
  if (type === 'platform') return 'active';
  if (type === 'external_engine_system') return externalSystems.find((system) => system.id === id)?.isActive ? 'active' : 'archived';
  if (type === 'engine_set') return engineSets.find((engineSet) => engineSet.id === id)?.isArchived ? 'archived' : 'active';
  if (type === 'engine') return externalEngines.find((engine) => engine.id === id)?.lifecycleStatus || 'unknown';
  if (type === 'project_engine_target') return projectTargets.find((target) => target.id === id)?.status || 'unknown';
  return 'unknown';
}

function sortResources(a: ResourceSummary, b: ResourceSummary) {
  const typeOrder: Partial<Record<AuthzResourceType, number>> = {
    platform: 0,
    project: 1,
    engine: 2,
    engine_set: 3,
    project_engine_target: 4,
    external_engine_system: 5,
  };
  const typeDiff = (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99);
  if (typeDiff !== 0) return typeDiff;
  return a.label.localeCompare(b.label);
}

export function buildResourceSummaries(
  assignments: RoleAssignment[],
  externalSystems: ExternalEngineSystem[],
  engineSets: EngineSetSummary[],
  externalEngines: ExternalEngineRegistration[],
  projectTargets: ProjectEngineTarget[],
): ResourceSummary[] {
  const summaries = new Map<string, ResourceSummary>();
  const ensureResource = (type: AuthzResourceType, id: string | null | undefined) => {
    const key = resourceKey(type, id);
    const existing = summaries.get(key);
    if (existing) return existing;
    const resourceId = id || '';
    const summary: ResourceSummary = {
      key,
      type,
      id: resourceId,
      label: getResourceLabel(type, resourceId, externalSystems, engineSets, externalEngines, projectTargets),
      detail: getResourceDetail(type, resourceId, externalSystems, engineSets, externalEngines, projectTargets),
      assignmentCount: 0,
      userAssignmentCount: 0,
      groupAssignmentCount: 0,
      machineAssignmentCount: 0,
      status: getResourceStatus(type, resourceId, externalSystems, engineSets, externalEngines, projectTargets),
    };
    summaries.set(key, summary);
    return summary;
  };

  externalSystems.forEach((system) => ensureResource('external_engine_system', system.id));
  engineSets.forEach((engineSet) => ensureResource('engine_set', engineSet.id));
  externalEngines.forEach((engine) => ensureResource('engine', engine.id));
  projectTargets.forEach((target) => {
    ensureResource('project_engine_target', target.id);
    ensureResource('project', target.projectId);
    ensureResource('engine', target.engineId);
  });
  assignments.forEach((assignment) => ensureResource(getAssignmentResourceType(assignment), getAssignmentResourceId(assignment)));

  summaries.forEach((summary) => {
    const resourceAssignments = assignments.filter((assignment) =>
      getAssignmentResourceType(assignment) === summary.type && getAssignmentResourceId(assignment) === summary.id
    );
    summary.assignmentCount = resourceAssignments.length;
    summary.userAssignmentCount = resourceAssignments.filter((assignment) => getAssignmentPrincipalType(assignment) === 'user').length;
    summary.groupAssignmentCount = resourceAssignments.filter((assignment) => getAssignmentPrincipalType(assignment) === 'group').length;
    summary.machineAssignmentCount = resourceAssignments.filter((assignment) => {
      const type = getAssignmentPrincipalType(assignment);
      return type === 'api_client' || type === 'service_account';
    }).length;
  });

  return Array.from(summaries.values()).sort(sortResources);
}

function assignmentResourceMatches(assignment: RoleAssignment, resource: ResourceSummary) {
  return getAssignmentResourceType(assignment) === resource.type && getAssignmentResourceId(assignment) === resource.id;
}

function formatResourceStatusTag(status: string) {
  if (status === 'active') return <Tag type="green">Active</Tag>;
  if (status === 'disabled' || status === 'stale') return <Tag type="magenta">{formatStatusLabel(status)}</Tag>;
  if (status === 'decommissioned' || status === 'archived') return <Tag type="gray">{formatStatusLabel(status)}</Tag>;
  return <Tag type="cool-gray">{formatStatusLabel(status)}</Tag>;
}

function formatPrincipalStatus(status: PrincipalSummaryStatus) {
  if (status === 'active') return <Tag type="green">Active</Tag>;
  if (status === 'archived') return <Tag type="gray">Archived</Tag>;
  if (status === 'revoked') return <Tag type="red">Revoked</Tag>;
  return <Tag type="cool-gray">Unknown</Tag>;
}

function sourceRefMappingId(sourceRef: string | null | undefined) {
  if (!sourceRef) return null;
  return sourceRef.includes(':') ? sourceRef.split(':').pop() || sourceRef : sourceRef;
}

function authzSourceTagType(source: unknown): 'blue' | 'purple' | 'gray' {
  if (source === 'manual') return 'blue';
  if (source === 'config') return 'purple';
  return 'gray';
}

function formatAuthzSource(source: unknown): string {
  return source === 'config' ? 'Managed by config' : String(source || '-');
}

function findSsoAssignmentMappingForAssignment(assignment: RoleAssignment, mappings: SsoAssignmentMapping[]) {
  const mappingId = assignment.sourceMappingId || sourceRefMappingId(assignment.sourceRef);
  return mappingId ? mappings.find((mapping) => mapping.id === mappingId) || null : null;
}

function findSsoGroupMappingForMembership(membership: AuthzGroupMembership, mappings: SsoGroupMapping[]) {
  const mappingId = sourceRefMappingId(membership.sourceRef);
  if (mappingId) {
    const exact = mappings.find((mapping) => mapping.id === mappingId);
    if (exact) return exact;
  }
  if (membership.source !== 'sso') return null;
  return mappings.find((mapping) => mapping.isActive && mapping.targetGroupId === membership.groupId) || null;
}

function formatSsoAssignmentMappingForInspection(mapping: SsoAssignmentMapping, roles: RoleSummary[]) {
  return `SSO engine mapping: ${ssoClaimLabel(mapping)} -> ${selectorLabel(mapping) || 'target'} as ${roleLabel(mapping.targetRoleId, roles)} (${mapping.syncMode})`;
}

function formatSsoGroupMappingForInspection(mapping: SsoGroupMapping) {
  return `SSO group mapping: ${ssoClaimLabel(mapping)} -> ${mapping.targetGroupName || mapping.targetGroupKey || mapping.targetGroupId} (${mapping.syncMode})`;
}

function joinLineageParts(parts: Array<string | null | undefined>) {
  const filtered = parts.filter((part): part is string => Boolean(part && part !== '-'));
  return filtered.length ? filtered.join('; ') : '-';
}

function parseAuditEntryContext(entry: AuthzAuditEntry): Record<string, unknown> {
  if (!entry.context) return {};
  try {
    const parsed = JSON.parse(entry.context);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function auditContextString(entry: AuthzAuditEntry) {
  return entry.context || '';
}

function auditEntryReferences(entry: AuthzAuditEntry, values: Array<string | null | undefined>) {
  const searchable = auditContextString(entry);
  const context = parseAuditEntryContext(entry);
  return values.filter(Boolean).some((value) => {
    const normalized = String(value);
    return entry.resourceId === normalized ||
      Object.values(context).some((contextValue) => String(contextValue) === normalized) ||
      searchable.includes(normalized);
  });
}

function auditActionLooksMutating(action: string) {
  return /\.(create|update|delete|remove|archive|enable|disable|sync|cleanup|reconcile|acknowledge|rotate|revoke)\b/.test(action);
}

function findAssignmentAuditEntries(
  assignment: RoleAssignment,
  entries: AuthzAuditEntry[],
  mapping?: SsoAssignmentMapping | null,
) {
  const ids = [assignment.id, assignment.sourceMappingId, assignment.sourceRef, mapping?.id].filter(Boolean);
  return entries.filter((entry) => {
    if (!auditActionLooksMutating(entry.action)) return false;
    if (entry.resourceType === 'role_assignment' && auditEntryReferences(entry, [assignment.id])) return true;
    if (mapping && entry.resourceType === 'sso_assignment_mapping' && auditEntryReferences(entry, [mapping.id])) return true;
    return auditEntryReferences(entry, ids);
  });
}

function findMembershipAuditEntries(
  membership: AuthzGroupMembership,
  entries: AuthzAuditEntry[],
  mapping?: SsoGroupMapping | null,
) {
  const ids = [membership.id, membership.sourceRef, mapping?.id, membership.groupId, membership.userId].filter(Boolean);
  return entries.filter((entry) => {
    if (!auditActionLooksMutating(entry.action)) return false;
    if (entry.resourceType === 'authz_group_membership' && auditEntryReferences(entry, [membership.id])) return true;
    if (mapping && entry.resourceType === 'sso_group_mapping' && auditEntryReferences(entry, [mapping.id])) return true;
    return auditEntryReferences(entry, ids);
  });
}

function findMachineIdentityAuditEntries(
  principalType: 'api_client' | 'service_account',
  principalId: string,
  entries: AuthzAuditEntry[],
) {
  return entries.filter((entry) => {
    if (!auditActionLooksMutating(entry.action)) return false;
    if (entry.resourceType === principalType && auditEntryReferences(entry, [principalId])) return true;
    if (entry.resourceType === 'role_assignment' && auditEntryReferences(entry, [principalId])) return true;
    return auditEntryReferences(entry, [principalId, `${principalType}:${principalId}`]);
  });
}

function findEffectiveAccessSourceAuditEntries(source: EffectiveAccessSource, entries: AuthzAuditEntry[]) {
  const ids = [
    source.assignmentId,
    source.sourceMappingId,
    source.sourceRef,
    source.groupMembership?.id,
    source.groupMembership?.sourceRef,
    source.ssoMapping?.id,
    source.ssoGroupMapping?.id,
    source.identityEntitlementMapping?.id,
    source.engineSetId,
    source.materializationId,
    source.engineRegistration?.registrationId,
    source.engineRegistration?.engineId,
    source.matchedEngineId,
    source.principalId,
    source.roleId,
    source.scopeId,
  ].filter(Boolean);
  return entries.filter((entry) => {
    if (!auditActionLooksMutating(entry.action)) return false;
    if (source.assignmentId && entry.resourceType === 'role_assignment' && auditEntryReferences(entry, [source.assignmentId])) return true;
    if (source.groupMembership?.id && entry.resourceType === 'authz_group_membership' && auditEntryReferences(entry, [source.groupMembership.id])) return true;
    if (source.ssoMapping?.id && entry.resourceType === 'sso_assignment_mapping' && auditEntryReferences(entry, [source.ssoMapping.id])) return true;
    if (source.ssoGroupMapping?.id && entry.resourceType === 'sso_group_mapping' && auditEntryReferences(entry, [source.ssoGroupMapping.id])) return true;
    if (source.identityEntitlementMapping?.id && entry.resourceType === 'identity_entitlement_mapping' && auditEntryReferences(entry, [source.identityEntitlementMapping.id])) return true;
    if (source.engineSetId && entry.resourceType === 'engine_set' && auditEntryReferences(entry, [source.engineSetId])) return true;
    return auditEntryReferences(entry, ids);
  });
}

function formatMachineDiagnosticCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getMachineIdentityRoleAssignments(assignments: RoleAssignment[]) {
  return assignments.filter((assignment) => {
    const type = getAssignmentPrincipalType(assignment);
    return type === 'api_client' || type === 'service_account';
  });
}

function countMachineIdentitiesWithAuditReferences(
  clients: ApiClient[],
  serviceAccounts: ServiceAccount[],
  entries: AuthzAuditEntry[],
) {
  const apiClientCount = clients.filter((client) =>
    findMachineIdentityAuditEntries('api_client', client.id, entries).length > 0
  ).length;
  const serviceAccountCount = serviceAccounts.filter((account) =>
    findMachineIdentityAuditEntries('service_account', account.id, entries).length > 0
  ).length;
  return apiClientCount + serviceAccountCount;
}

function formatAuditReferences(entries: AuthzAuditEntry[]) {
  const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp).slice(0, 2);
  if (sorted.length === 0) return '-';
  return sorted
    .map((entry) => `${entry.action} @ ${formatTimestamp(entry.timestamp)}`)
    .join('; ');
}

function AuditReferenceLinks({
  entries,
  onOpen,
}: {
  entries: AuthzAuditEntry[];
  onOpen?: (entry: AuthzAuditEntry) => void;
}) {
  const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp).slice(0, 2);
  if (sorted.length === 0) return <>-</>;
  if (!onOpen) return <>{formatAuditReferences(sorted)}</>;
  return (
    <div style={{ display: 'grid', justifyItems: 'start', gap: 'var(--spacing-1)' }}>
      {sorted.map((entry) => {
        const label = `${entry.action} @ ${formatTimestamp(entry.timestamp)}`;
        return (
          <Button
            key={entry.id}
            kind="ghost"
            size="sm"
            aria-label={`Open audit event ${label}`}
            onClick={() => onOpen(entry)}
          >
            {label}
          </Button>
        );
      })}
    </div>
  );
}

function formatAssignmentLineage(
  assignment: RoleAssignment,
  roles: RoleSummary[] = [],
  ssoAssignmentMappings: SsoAssignmentMapping[] = [],
) {
  const mapping = findSsoAssignmentMappingForAssignment(assignment, ssoAssignmentMappings);
  const parts = [
    mapping ? formatSsoAssignmentMappingForInspection(mapping, roles) : '',
    assignment.sourceMappingId ? `mapping=${assignment.sourceMappingId}` : '',
    assignment.sourceRef ? `ref=${assignment.sourceRef}` : '',
    assignment.createdById ? `createdBy=${assignment.createdById}` : '',
    assignment.lastSeenAt ? `lastSeen=${formatTimestamp(assignment.lastSeenAt)}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join('; ') : '-';
}

function formatMembershipLineage(membership: AuthzGroupMembership, ssoGroupMappings: SsoGroupMapping[] = []) {
  const mapping = findSsoGroupMappingForMembership(membership, ssoGroupMappings);
  const parts = [
    mapping ? formatSsoGroupMappingForInspection(mapping) : '',
    membership.sourceRef ? `ref=${membership.sourceRef}` : '',
    membership.createdById ? `createdBy=${membership.createdById}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join('; ') : '-';
}

function assignmentScopeMatches(assignment: RoleAssignment, resourceType: AuthzResourceType, resourceId: string) {
  const scopeType = assignment.scopeType || assignment.resourceType;
  const scopeId = assignment.scopeId || assignment.resourceId;
  return scopeType === resourceType && scopeId === resourceId;
}

export function filterRoles(roles: RoleSummary[], searchQuery: string, scopeFilter: RoleScopeFilter) {
  const query = searchQuery.trim().toLowerCase();

  return roles.filter((role) => {
    const matchesScope = scopeFilter === 'all' || role.scope === scopeFilter;
    const searchable = [
      role.name,
      role.key,
      role.description || '',
      role.scope,
      role.kind,
    ].join(' ').toLowerCase();

    return matchesScope && (!query || searchable.includes(query));
  });
}

export function getAssignableRolesForPrincipal(
  roles: RoleSummary[],
  resourceType: CoreAssignmentResourceType,
  principalType: AssignmentPrincipalType,
) {
  const roleScope = resourceType === 'engine_runtime_resource' || resourceType === 'engine_runtime_resource_set'
    ? 'engine'
    : resourceType;
  return roles.filter((role) => {
    if (role.scope !== roleScope || !role.isAssignable || role.isArchived) return false;
    if (principalType !== 'api_client' && principalType !== 'service_account') return true;
    if (role.id === 'system.api.engine_registrar' && principalType !== 'api_client') return false;
    if (role.id === 'system.api.external_engine_system_registrar' && principalType !== 'api_client') return false;
    return role.kind === 'system' && MACHINE_ASSIGNABLE_SYSTEM_ROLE_IDS.has(role.id);
  });
}

export function getPermissionRisk(permission: PermissionCatalogEntry) {
  return getPermissionRiskForKey(permission.key);
}

export function getPermissionImplications(permission: PermissionCatalogEntry) {
  const key = permission.key;
  const implications: string[] = [];

  if (key.startsWith('project:files:') && key !== 'project:files:view') {
    implications.push('project:files:view');
  }
  if (key.startsWith('project:members:') && key !== 'project:members:view') {
    implications.push('project:members:view');
  }
  if (key === 'project:versions:create' || key === 'project:versions:restore') {
    implications.push('project:files:view');
  }
  if (key.startsWith('engine:members:') && key !== 'engine:members:view') {
    implications.push('engine:members:view');
  }
  if (key.startsWith('engine:instance:') && key !== 'engine:instance:view') {
    implications.push('engine:instance:view');
  }
  if (key.startsWith('engine:process:')) {
    implications.push('engine:instance:view');
  }
  if (key === 'engine:deploy') {
    implications.push('engine:deploy:view');
  }

  return Array.from(new Set(implications));
}

function permissionMatchesQuickFilter(permission: PermissionCatalogEntry, filter: PermissionQuickFilter) {
  const key = permission.key;
  if (filter === 'all') return true;
  if (filter === 'view') return key.endsWith(':view') || key.includes(':view') || key === 'platform:audit:view';
  if (filter === 'editor') {
    return key.includes(':create') || key.includes(':edit') || key.includes(':update') || key.includes(':restore') || key.includes(':push') || key.includes(':pull') || key.includes(':connect');
  }
  if (filter === 'operator') {
    return key.startsWith('engine:process:') || key.startsWith('engine:instance:') || key === 'engine:activate' || key === 'engine:variables:edit';
  }
  return key.includes(':deploy') || key === 'project:deploy' || key === 'engine:deploy' || key === 'engine:deploy:view';
}

export function filterPermissions(permissions: PermissionCatalogEntry[], quickFilter: PermissionQuickFilter) {
  return permissions.filter((permission) => permissionMatchesQuickFilter(permission, quickFilter));
}

export function getSsoAssignmentMappingWarning(mapping: SsoAssignmentMapping, externalEngines: ExternalEngineRegistration[]) {
  if (!mapping.isActive) return null;

  if (mapping.targetSelectorType === 'external_engine_id') {
    const target = mapping.targetExternalEngineId;
    if (target && !externalEngines.some((engine) => engine.externalId === target)) {
      return 'Missing external engine';
    }
  }

  if (mapping.targetSelectorType === 'engine_label') {
    const labelKey = mapping.targetLabelKey;
    const labelValue = mapping.targetLabelValue;
    if (labelKey && labelValue && !externalEngines.some((engine) => engine.labels[labelKey] === labelValue)) {
      return 'Missing label match';
    }
  }

  return null;
}

export function findStaleSsoAssignments(assignments: RoleAssignment[], mappings: SsoAssignmentMapping[]) {
  const mappingIds = new Set(mappings.map((mapping) => mapping.id));
  return assignments.filter((assignment) =>
    assignment.source === 'sso' && assignment.sourceMappingId && !mappingIds.has(assignment.sourceMappingId)
  );
}

function formatTargetCount(count: number) {
  return `${count} registered target${count === 1 ? '' : 's'}`;
}

export function getSsoAssignmentTargetSummary(mapping: SsoAssignmentMapping, externalEngines: ExternalEngineRegistration[]) {
  const warning = getSsoAssignmentMappingWarning(mapping, externalEngines);
  if (warning) return warning;

  if (mapping.targetSelectorType === 'all_engines') {
    return formatTargetCount(externalEngines.filter((engine) => engine.lifecycleStatus !== 'decommissioned').length);
  }
  if (mapping.targetSelectorType === 'external_engine_id') {
    const count = externalEngines.filter((engine) => engine.externalId === mapping.targetExternalEngineId).length;
    return formatTargetCount(count);
  }
  if (mapping.targetSelectorType === 'engine_label') {
    const count = externalEngines.filter((engine) => {
      const key = mapping.targetLabelKey || '';
      return Boolean(key) && engine.labels[key] === mapping.targetLabelValue;
    }).length;
    return formatTargetCount(count);
  }
  if (externalEngines.some((engine) => engine.id === mapping.targetEngineId)) return formatTargetCount(1);
  return 'Exact engine id; backend validates target';
}

export function getSsoAssignmentDiagnostics(
  mappings: SsoAssignmentMapping[],
  assignments: RoleAssignment[],
  externalEngines: ExternalEngineRegistration[],
): SsoAssignmentDiagnostics {
  const targetWarnings = mappings
    .map((mapping) => ({ mapping, warning: getSsoAssignmentMappingWarning(mapping, externalEngines) }))
    .filter((item): item is { mapping: SsoAssignmentMapping; warning: string } => Boolean(item.warning));

  return {
    activeMappings: mappings.filter((mapping) => mapping.isActive).length,
    inactiveMappings: mappings.filter((mapping) => !mapping.isActive).length,
    authoritativeMappings: mappings.filter((mapping) => mapping.syncMode === 'authoritative').length,
    additiveMappings: mappings.filter((mapping) => mapping.syncMode === 'additive').length,
    allEngineSelectors: mappings.filter((mapping) => mapping.isActive && mapping.targetSelectorType === 'all_engines').length,
    targetWarnings,
    staleAssignments: findStaleSsoAssignments(assignments, mappings),
    ssoAssignmentCount: assignments.filter((assignment) => assignment.source === 'sso').length,
    targetSummaries: mappings.map((mapping) => ({
      mapping,
      summary: getSsoAssignmentTargetSummary(mapping, externalEngines),
      warning: getSsoAssignmentMappingWarning(mapping, externalEngines),
    })),
  };
}

export function getSsoTargetRoleOptions(
  roles: RoleSummary[],
  options: { includeEngineOwner?: boolean; includeEngineDelegate?: boolean } = {},
) {
  const customEngineRoles = roles
    .filter((role) => role.kind === 'custom' && role.scope === 'engine' && role.isAssignable && !role.isArchived)
    .map((role) => ({ id: role.id, label: role.name }));
  const governanceRoles = SYSTEM_SSO_GOVERNANCE_TARGET_ROLES.filter((role) =>
    (role.id === 'system.engine.owner' && options.includeEngineOwner) ||
    (role.id === 'system.engine.delegate' && options.includeEngineDelegate)
  );
  return [...SYSTEM_SSO_TARGET_ROLES, ...governanceRoles, ...customEngineRoles];
}

function RolesTable({
  roles,
  loading,
  onCreate,
  onEdit,
  onDuplicate,
  onArchive,
  canManage,
}: {
  roles: RoleSummary[];
  loading: boolean;
  onCreate: () => void;
  onEdit: (role: RoleSummary) => void;
  onDuplicate: (role: RoleSummary) => void;
  onArchive: (role: RoleSummary) => void;
  canManage: boolean;
}) {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [scopeFilter, setScopeFilter] = React.useState<RoleScopeFilter>('all');
  const filteredRoles = React.useMemo(
    () => filterRoles(roles, searchQuery, scopeFilter),
    [roles, searchQuery, scopeFilter],
  );
  const selectedScopeFilter = ROLE_SCOPE_FILTERS.find((item) => item.id === scopeFilter) || ROLE_SCOPE_FILTERS[0];

  if (loading) return <DataTableSkeleton headers={rolesHeaders} rowCount={6} />;

  return (
    <TableContainer>
      <DataTable
        rows={filteredRoles.map((role) => ({
          id: role.id,
          name: role.name,
          scope: role.scope,
          kind: role.kind,
          permissions: role.permissionCount,
          assignable: role.isAssignable,
          status: role.isArchived,
          actions: '',
        }))}
        headers={rolesHeaders}
      >
        {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
          <>
            <TableToolbar>
              <TableToolbarContent>
                <TableToolbarSearch
                  persistent
                  onChange={(e: any) => setSearchQuery(e.target.value)}
                  value={searchQuery}
                  placeholder="Search roles"
                />
                <Dropdown
                  id="roles-scope-filter"
                  titleText="Scope"
                  label="Scope"
                  items={ROLE_SCOPE_FILTERS}
                  selectedItem={selectedScopeFilter}
                  itemToString={(item) => item?.label || ''}
                  onChange={({ selectedItem }) => setScopeFilter(selectedItem?.id || 'all')}
                />
                <Button kind="primary" renderIcon={Add} onClick={onCreate} disabled={!canManage} title={canManage ? undefined : 'Missing permission platform:authz:roles:manage'}>
                  Create Role
                </Button>
              </TableToolbarContent>
            </TableToolbar>
            <Table {...getTableProps()} size="md">
              <TableHead>
                <TableRow>
                    {headers.map((header) => (
                      <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                    ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={headers.length}>No roles match the current filters.</TableCell>
                  </TableRow>
                ) : rows.map((row) => {
                  const role = filteredRoles.find((item) => item.id === row.id);
                  return (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                      {row.cells.map((cell) => {
                        if (cell.info.header === 'scope') return <TableCell key={cell.id}>{scopeTag(String(cell.value))}</TableCell>;
                        if (cell.info.header === 'kind') return <TableCell key={cell.id}><Tag type="gray">{String(cell.value)}</Tag></TableCell>;
                        if (cell.info.header === 'assignable') return <TableCell key={cell.id}>{cell.value ? 'Yes' : 'No'}</TableCell>;
                        if (cell.info.header === 'status') return <TableCell key={cell.id}><Tag type={cell.value ? 'gray' : 'green'}>{cell.value ? 'Archived' : 'Active'}</Tag></TableCell>;
                        if (cell.info.header === 'actions') {
                          return (
                            <TableCell key={cell.id}>
                              {role?.kind === 'system' && (
                                <Button kind="ghost" size="sm" disabled={!canManage} title={canManage ? undefined : 'Missing permission platform:authz:roles:manage'} onClick={() => onDuplicate(role)}>Duplicate</Button>
                              )}
                              {role?.kind === 'custom' && (
                                <>
                                  <Button kind="ghost" size="sm" disabled={!canManage} title={canManage ? undefined : 'Missing permission platform:authz:roles:manage'} onClick={() => onEdit(role)}>Edit</Button>
                                  <Button kind="ghost" size="sm" disabled={role.isArchived || !canManage} title={canManage ? undefined : 'Missing permission platform:authz:roles:manage'} onClick={() => onArchive(role)}>Archive</Button>
                                </>
                              )}
                            </TableCell>
                          );
                        }
                        return <TableCell key={cell.id}>{cell.value}</TableCell>;
                      })}
                    </DataTableDataRow>
                  );
                })}
              </TableBody>
            </Table>
          </>
        )}
      </DataTable>
    </TableContainer>
  );
}

function PermissionsTable({
  permissions,
  loading,
  onCreate,
  canManage,
}: {
  permissions: PermissionCatalogEntry[];
  loading: boolean;
  onCreate: () => void;
  canManage: boolean;
}) {
  const [quickFilter, setQuickFilter] = React.useState<PermissionQuickFilter>('all');
  const filteredPermissions = React.useMemo(
    () => filterPermissions(permissions, quickFilter),
    [permissions, quickFilter],
  );
  const selectedQuickFilter = PERMISSION_QUICK_FILTERS.find((item) => item.id === quickFilter) || PERMISSION_QUICK_FILTERS[0];

  if (loading) return <DataTableSkeleton headers={permissionsHeaders} rowCount={8} />;

  return (
    <TableContainer>
      <DataTable
        rows={filteredPermissions.map((permission) => ({
          id: permission.key,
          label: permission.label,
          key: permission.key,
          scope: permission.scope,
          category: permission.category,
          kind: permission.kind || 'system',
          implications: getPermissionImplications(permission).join(', '),
          risk: getPermissionRisk(permission)?.label || '',
        }))}
        headers={permissionsHeaders}
      >
        {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
          <>
            <TableToolbar>
              <TableToolbarContent>
                <Dropdown
                  id="permissions-quick-filter"
                  titleText="Quick filter"
                  label="Quick filter"
                  items={PERMISSION_QUICK_FILTERS}
                  selectedItem={selectedQuickFilter}
                  itemToString={(item) => item?.label || ''}
                  onChange={({ selectedItem }) => setQuickFilter(selectedItem?.id || 'all')}
                />
                <Button kind="primary" renderIcon={Add} onClick={onCreate} disabled={!canManage} title={canManage ? undefined : 'Missing permission platform:authz:roles:manage'}>
                  Add Permission
                </Button>
              </TableToolbarContent>
            </TableToolbar>
            <Table {...getTableProps()} size="md">
              <TableHead>
                <TableRow>
                  {headers.map((header) => (
                    <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={headers.length}>No permissions match the current filter.</TableCell>
                  </TableRow>
                ) : rows.map((row) => {
                  const permission = filteredPermissions.find((item) => item.key === row.id);
                  const risk = permission ? getPermissionRisk(permission) : null;
                  const implications = permission ? getPermissionImplications(permission) : [];

                  return (
                    <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                      {row.cells.map((cell) => {
                        if (cell.info.header === 'scope') return <TableCell key={cell.id}>{scopeTag(String(cell.value))}</TableCell>;
                        if (cell.info.header === 'kind') {
                          return <TableCell key={cell.id}><Tag type={cell.value === 'custom' ? 'green' : 'gray'}>{String(cell.value)}</Tag></TableCell>;
                        }
                        if (cell.info.header === 'risk') {
                          return (
                            <TableCell key={cell.id}>
                              {risk ? <Tag type="red" title={risk.description}>{risk.label}</Tag> : '-'}
                            </TableCell>
                          );
                        }
                        if (cell.info.header === 'implications') {
                          return (
                            <TableCell key={cell.id}>
                              {implications.length ? implications.map((item) => <Tag key={item} type="cool-gray">{item}</Tag>) : '-'}
                            </TableCell>
                          );
                        }
                        return <TableCell key={cell.id}>{cell.value}</TableCell>;
                      })}
                    </DataTableDataRow>
                  );
                })}
              </TableBody>
            </Table>
          </>
        )}
      </DataTable>
    </TableContainer>
  );
}

function RolePermissionMatrix({
  roles,
  permissions,
  loading,
  canManage,
  savingRoleId,
  onEditRole,
  onDuplicateRole,
  onUpdateRolePermissions,
}: {
  roles: RoleSummary[];
  permissions: PermissionCatalogEntry[];
  loading: boolean;
  canManage: boolean;
  savingRoleId: string | null;
  onEditRole: (role: RoleSummary) => void;
  onDuplicateRole: (role: RoleSummary) => void;
  onUpdateRolePermissions: (role: RoleSummary, permissionIds: string[]) => Promise<void>;
}) {
  const [scopeFilter, setScopeFilter] = React.useState<RoleScopeFilter>('engine');
  const selectedScopeFilter = ROLE_SCOPE_FILTERS.find((item) => item.id === scopeFilter) || ROLE_SCOPE_FILTERS[0];
  const visibleRoles = React.useMemo(
    () => roles
      .filter((role) => !role.isArchived)
      .filter((role) => scopeFilter === 'all' || role.scope === scopeFilter),
    [roles, scopeFilter],
  );
  const visiblePermissions = React.useMemo(
    () => permissions
      .filter((permission) => !permission.isArchived)
      .filter((permission) => scopeFilter === 'all' || permission.scope === scopeFilter),
    [permissions, scopeFilter],
  );
  const roleDetailQueries = useRoleDetails(visibleRoles.map((role) => role.id));
  const roleDetailsById = React.useMemo(() => {
    const details = new Map<string, RoleDetail>();
    roleDetailQueries.forEach((query) => {
      if (query.data) details.set(query.data.id, query.data);
    });
    return details;
  }, [roleDetailQueries]);
  const groupedPermissions = React.useMemo(() => {
    const groups = new Map<string, { id: string; label: string; scope: AuthzResourceType; permissions: PermissionCatalogEntry[] }>();
    visiblePermissions.forEach((permission) => {
      const category = permission.category || 'General';
      const id = `${permission.scope}:${category}`;
      const existing = groups.get(id);
      if (existing) {
        existing.permissions.push(permission);
        return;
      }
      groups.set(id, {
        id,
        label: category,
        scope: permission.scope,
        permissions: [permission],
      });
    });
    return Array.from(groups.values()).map((group) => ({
      ...group,
      permissions: group.permissions.sort((left, right) => left.label.localeCompare(right.label)),
    }));
  }, [visiblePermissions]);

  const isRoleEditableInMatrix = (role: RoleSummary) => (
    canManage && role.kind === 'custom' && role.isEditable && !role.isArchived && savingRoleId !== role.id
  );

  const getRolePermissionSet = (role: RoleSummary) => new Set(roleDetailsById.get(role.id)?.permissions || []);

  const updateRolePermission = async (role: RoleSummary, permission: PermissionCatalogEntry, checked: boolean) => {
    const current = getRolePermissionSet(role);
    const next = checked
      ? Array.from(new Set([...current, permission.key]))
      : Array.from(current).filter((permissionId) => permissionId !== permission.key);
    await onUpdateRolePermissions(role, next);
  };

  const updateRolePermissionGroup = async (
    role: RoleSummary,
    groupPermissions: PermissionCatalogEntry[],
    checked: boolean,
  ) => {
    const current = getRolePermissionSet(role);
    const groupPermissionIds = groupPermissions.map((permission) => permission.key);
    const next = checked
      ? Array.from(new Set([...current, ...groupPermissionIds]))
      : Array.from(current).filter((permissionId) => !groupPermissionIds.includes(permissionId));
    await onUpdateRolePermissions(role, next);
  };

  if (loading) {
    return <DataTableSkeleton headers={[{ key: 'permission', header: 'Permission' }]} rowCount={8} />;
  }

  return (
    <TableContainer
      title="Role Permission Matrix"
      description="Compare roles across fine-grained permissions. Default system roles are locked; duplicate one to customize permissions. Custom roles can be edited inline."
    >
      <TableToolbar>
        <TableToolbarContent>
          <Dropdown
            id="role-permission-matrix-scope"
            titleText="Scope"
            label="Scope"
            items={ROLE_SCOPE_FILTERS}
            selectedItem={selectedScopeFilter}
            itemToString={(item) => item?.label || ''}
            onChange={({ selectedItem }) => setScopeFilter(selectedItem?.id || 'engine')}
          />
        </TableToolbarContent>
      </TableToolbar>
      {visibleRoles.length === 0 || visiblePermissions.length === 0 ? (
        <InlineNotification
          kind="info"
          title="No matrix data"
          subtitle="Create roles and permissions for this scope to compare access in a matrix."
          lowContrast
        />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
          {visibleRoles.some((role) => role.kind === 'system') && (
            <InlineNotification
              kind="info"
              title="Default roles are locked"
              subtitle="Duplicate a default role to create an editable custom role, then assign that custom role to users, groups, projects, engines, or Engine Sets."
              lowContrast
              hideCloseButton
            />
          )}
          <div style={{ overflow: 'auto', border: '1px solid var(--cds-border-subtle)', maxHeight: 620 }}>
            <Table size="sm" useZebraStyles={false}>
            <TableHead>
              <TableRow>
                <TableHeader style={{ minWidth: 300, position: 'sticky', left: 0, zIndex: 2, background: 'var(--cds-layer)' }}>
                  Permission
                </TableHeader>
                {visibleRoles.map((role) => (
                  <TableHeader key={role.id} style={{ minWidth: 180, verticalAlign: 'top' }}>
                    <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
                      <span>{role.name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
                        <Tag type={role.kind === 'custom' ? 'green' : 'gray'}>{role.kind}</Tag>
                        {scopeTag(role.scope)}
                      </div>
                      {role.kind === 'custom' ? (
                        <Button kind="ghost" size="sm" disabled={!canManage} title={canManage ? undefined : 'Missing permission platform:authz:roles:manage'} onClick={() => onEditRole(role)}>
                          Edit
                        </Button>
                      ) : (
                        <Button kind="ghost" size="sm" disabled={!canManage} title={canManage ? 'Create an editable custom role from this default role' : 'Missing permission platform:authz:roles:manage'} onClick={() => onDuplicateRole(role)}>
                          Duplicate
                        </Button>
                      )}
                    </div>
                  </TableHeader>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {groupedPermissions.map((group) => (
                <React.Fragment key={group.id}>
                  <TableRow>
                    <TableCell style={{ position: 'sticky', left: 0, zIndex: 1, background: 'var(--cds-layer-accent)', fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
                        <span>{group.label}</span>
                        {scopeTag(group.scope)}
                      </div>
                    </TableCell>
                    {visibleRoles.map((role) => {
                      const permissionSet = getRolePermissionSet(role);
                      const selectedCount = group.permissions.filter((permission) => permissionSet.has(permission.key)).length;
                      const checked = selectedCount === group.permissions.length;
                      const indeterminate = selectedCount > 0 && selectedCount < group.permissions.length;
                      const roleEditable = isRoleEditableInMatrix(role);
                      const missingRiskyPermission = group.permissions.some((permission) => !permissionSet.has(permission.key) && getPermissionRisk(permission));
                      const disabled = !roleEditable || !roleDetailsById.has(role.id) || (missingRiskyPermission && !checked);
                      return (
                        <TableCell key={`${group.id}:${role.id}`} style={{ background: 'var(--cds-layer-accent)' }}>
                          <Checkbox
                            id={`role-matrix-group-${group.id}-${role.id}`}
                            labelText=""
                            hideLabel
                            checked={checked}
                            indeterminate={indeterminate}
                            disabled={disabled}
                            title={role.kind === 'system'
                              ? 'Default system roles are locked. Duplicate this role to customize permissions.'
                              : missingRiskyPermission && !checked
                                ? 'Use the role editor to add sensitive permissions with acknowledgement'
                                : undefined}
                            onChange={(_event, { checked: nextChecked }) => updateRolePermissionGroup(role, group.permissions, Boolean(nextChecked))}
                          />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                  {group.permissions.map((permission) => {
                    const risk = getPermissionRisk(permission);
                    return (
                      <TableRow key={permission.key}>
                        <TableCell style={{ position: 'sticky', left: 0, zIndex: 1, background: 'var(--cds-layer)' }}>
                          <div style={{ display: 'grid', gap: 'var(--spacing-1)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
                              <span>{permission.label}</span>
                              {permission.kind === 'custom' && <Tag type="green">custom</Tag>}
                              {risk && <Tag type="red" title={risk.description}>{risk.label}</Tag>}
                            </div>
                            <span style={{ color: 'var(--cds-text-secondary)', fontSize: '12px' }}>{permission.key}</span>
                          </div>
                        </TableCell>
                        {visibleRoles.map((role) => {
                          const permissionSet = getRolePermissionSet(role);
                          const checked = permissionSet.has(permission.key);
                          const roleEditable = isRoleEditableInMatrix(role);
                          const disabled = !roleEditable || !roleDetailsById.has(role.id) || (!checked && Boolean(risk));
                          return (
                            <TableCell key={`${permission.key}:${role.id}`}>
                              <Checkbox
                                id={`role-matrix-permission-${permission.key}-${role.id}`}
                                labelText=""
                                hideLabel
                                checked={checked}
                                disabled={disabled}
                                title={role.kind === 'system'
                                  ? 'Default system roles are locked. Duplicate this role to customize permissions.'
                                  : !checked && risk
                                    ? 'Use the role editor to add sensitive permissions with acknowledgement'
                                    : undefined}
                                onChange={(_event, { checked: nextChecked }) => updateRolePermission(role, permission, Boolean(nextChecked))}
                              />
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  })}
                </React.Fragment>
              ))}
            </TableBody>
            </Table>
          </div>
        </div>
      )}
    </TableContainer>
  );
}

function EffectiveAccess({
  permissions,
  auditEntries,
  onOpenAuditReference,
}: {
  permissions: PermissionCatalogEntry[];
  auditEntries: AuthzAuditEntry[];
  onOpenAuditReference?: (entry: AuthzAuditEntry) => void;
}) {
  const evaluateM = useEvaluateAccess();
  const [userId, setUserId] = React.useState('');
  const [resourceType, setResourceType] = React.useState<CoreAssignmentResourceType>('platform');
  const [resourceId, setResourceId] = React.useState('');
  const [permission, setPermission] = React.useState<string>('');
  const selectedPermission = permissions.find((item) => item.key === permission) || null;
  const sourceRows = React.useMemo(() => (evaluateM.data?.sources || []).map((source, index) => {
    const auditReferenceEntries = findEffectiveAccessSourceAuditEntries(source, auditEntries);
    return {
      id: `${source.type}-${source.assignmentId || source.roleId || source.permission || index}`,
      type: source.type,
      grant: formatEffectiveAccessGrant(source),
      principal: formatEffectiveAccessPrincipal(source),
      scope: formatEffectiveAccessScope(source),
      lineage: formatEffectiveAccessLineage(source),
      audit: formatAuditReferences(auditReferenceEntries),
      auditEntries: auditReferenceEntries,
    };
  }), [auditEntries, evaluateM.data]);

  const evaluate = async () => {
    await evaluateM.mutateAsync({
      userId,
      permission,
      resourceType,
      resourceId: resourceType === 'platform' ? undefined : resourceId,
    });
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-4)' }}>
        <TextInput id="effective-user-id" labelText="User ID" value={userId} onChange={(event) => setUserId(event.target.value)} />
        <Dropdown
          id="effective-resource-type"
          titleText="Resource type"
          label="Select resource type"
          items={[
            { id: 'platform', label: 'Platform' },
            { id: 'project', label: 'Project' },
            { id: 'engine', label: 'Engine' },
          ]}
          itemToString={(item) => item?.label || ''}
          selectedItem={{ id: resourceType, label: resourceType }}
          onChange={({ selectedItem }) => setResourceType((selectedItem?.id || 'platform') as 'platform' | 'project' | 'engine')}
        />
        <TextInput
          id="effective-resource-id"
          labelText="Resource ID"
          disabled={resourceType === 'platform'}
          value={resourceId}
          onChange={(event) => setResourceId(event.target.value)}
        />
        <Dropdown
          id="effective-permission"
          titleText="Permission"
          label="Select permission"
          items={permissions}
          itemToString={(item) => item ? `${item.label} (${item.key})` : ''}
          selectedItem={selectedPermission}
          onChange={({ selectedItem }) => setPermission(selectedItem?.key || '')}
        />
      </div>
      <div>
        <Button disabled={!userId || !permission || (resourceType !== 'platform' && !resourceId) || evaluateM.isPending} onClick={evaluate}>
          Evaluate
        </Button>
      </div>
      {evaluateM.isError && (
        <InlineNotification kind="error" title={parseApiError(evaluateM.error, 'Unable to evaluate access').message} lowContrast />
      )}
      {evaluateM.data && (
        <InlineNotification
          kind={evaluateM.data.allowed ? 'success' : 'warning'}
          title={evaluateM.data.allowed ? 'Access allowed' : 'Access denied'}
          subtitle={`${evaluateM.data.reason} (${evaluateM.data.sources.length} source${evaluateM.data.sources.length === 1 ? '' : 's'})`}
          lowContrast
        />
      )}
      {evaluateM.data && sourceRows.length > 0 && (
        <DataTable rows={sourceRows} headers={effectiveAccessSourceHeaders}>
          {({ rows, headers, getHeaderProps, getRowProps }) => (
            <TableContainer title="Authorization sources">
              <Table size="sm">
                <TableHead>
                  <TableRow>
                    {headers.map((header) => (
                      <TableHeader {...getHeaderProps({ header })} key={header.key}>
                        {header.header}
                      </TableHeader>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => {
                    const sourceRow = sourceRows.find((item) => item.id === row.id);
                    return (
                      <TableRow {...getRowProps({ row })} key={row.id}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'audit') {
                            return (
                              <TableCell key={cell.id}>
                                <AuditReferenceLinks entries={sourceRow?.auditEntries || []} onOpen={onOpenAuditReference} />
                              </TableCell>
                            );
                          }
                          return <TableCell key={cell.id}>{cell.value}</TableCell>;
                        })}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DataTable>
      )}
    </div>
  );
}

function RoleAssignmentsPanel({
  roles,
  assignments,
  apiClients,
  groups,
  serviceAccounts,
  externalSystems,
  runtimeEngines,
  loading,
  onAssign,
  onRemove,
  pending,
  canCreate,
  canDelete,
}: {
  roles: RoleSummary[];
  assignments: RoleAssignment[];
  apiClients: ApiClient[];
  groups: AuthzGroup[];
  serviceAccounts: ServiceAccount[];
  externalSystems: ExternalEngineSystem[];
  runtimeEngines: RuntimeResourceEngineOption[];
  loading: boolean;
  onAssign: (form: {
    principalType: AssignmentPrincipalType;
    principalId: string;
    roleId: string;
    resourceType: CoreAssignmentResourceType;
    resourceId: string;
  }) => void;
  onRemove: (assignmentId: string) => void;
  pending: boolean;
  canCreate: boolean;
  canDelete: boolean;
}) {
  const [form, setForm] = React.useState({
    principalType: 'user' as AssignmentPrincipalType,
    principalId: '',
    resourceType: 'engine' as CoreAssignmentResourceType,
    resourceId: '',
    runtimeEngineId: '',
    roleId: '',
  });
  const activeApiClients = apiClients.filter((client) => client.isActive);
  const activeGroups = groups.filter((group) => !group.isArchived);
  const activeServiceAccounts = serviceAccounts.filter((account) => account.isActive);
  const activeExternalSystems = externalSystems.filter((system) => system.isActive);
  const selectedApiClient = activeApiClients.find((client) => client.id === form.principalId) || null;
  const selectedGroup = activeGroups.find((group) => group.id === form.principalId) || null;
  const selectedServiceAccount = activeServiceAccounts.find((account) => account.id === form.principalId) || null;
  const selectedExternalSystem = activeExternalSystems.find((system) => system.id === form.resourceId) || null;
  const selectedRuntimeEngine = runtimeEngines.find((engine) => engine.id === form.runtimeEngineId) || null;
  const runtimeResourcesQ = useQuery({
    queryKey: ['assignment-runtime-resources', form.runtimeEngineId],
    enabled: form.resourceType === 'engine_runtime_resource' && Boolean(form.runtimeEngineId),
    queryFn: () => apiClient.get<RuntimeResourceInventoryRow[]>(`/api/authz/runtime-resources?engineId=${encodeURIComponent(form.runtimeEngineId)}`),
  });
  const runtimeSetsQ = useQuery({
    queryKey: ['assignment-runtime-resource-sets', form.runtimeEngineId],
    enabled: form.resourceType === 'engine_runtime_resource_set' && Boolean(form.runtimeEngineId),
    queryFn: () => apiClient.get<Array<{ id: string; key: string; name: string; resourceKind: string }>>(`/api/authz/runtime-resource-sets?engineId=${encodeURIComponent(form.runtimeEngineId)}`),
  });
  const selectedRuntimeResource = (runtimeResourcesQ.data || []).find((resource) => resource.id === form.resourceId) || null;
  const selectedRuntimeSet = (runtimeSetsQ.data || []).find((set) => set.id === form.resourceId) || null;
  const resourceTypeItems = form.principalType === 'api_client'
    ? [
      { id: 'platform', label: 'Platform' },
      { id: 'external_engine_system', label: 'External system' },
      { id: 'project', label: 'Project' },
      { id: 'engine', label: 'Engine' },
    ]
    : form.principalType === 'service_account'
    ? [
      { id: 'project', label: 'Project' },
      { id: 'engine', label: 'Engine' },
    ]
    : [
      { id: 'platform', label: 'Platform' },
      { id: 'project', label: 'Project' },
      { id: 'engine', label: 'Engine' },
      { id: 'engine_runtime_resource', label: 'Runtime resource' },
      { id: 'engine_runtime_resource_set', label: 'Runtime resource set' },
    ];
  const assignableRoles = React.useMemo(
    () => getAssignableRolesForPrincipal(roles, form.resourceType, form.principalType),
    [roles, form.resourceType, form.principalType],
  );
  const selectedRole = assignableRoles.find((role) => role.id === form.roleId) || null;

  React.useEffect(() => {
    if (form.roleId && !assignableRoles.some((role) => role.id === form.roleId)) {
      setForm((current) => ({ ...current, roleId: '' }));
    }
  }, [assignableRoles, form.roleId]);

  const canAssign = Boolean(
    form.principalId &&
    form.roleId &&
    (form.resourceType === 'platform' || form.resourceId) &&
    !pending
  );

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-4)' }}>
        <Dropdown
          id="assignment-principal-type"
          titleText="Principal"
          label="Select principal"
          items={[
            { id: 'user', label: 'User' },
            { id: 'group', label: 'Group' },
            { id: 'api_client', label: 'API client' },
            { id: 'service_account', label: 'Service account' },
          ]}
          itemToString={(item) => item?.label || ''}
          selectedItem={{
            id: form.principalType,
            label: form.principalType === 'api_client'
              ? 'API client'
              : form.principalType === 'service_account'
                ? 'Service account'
                : form.principalType === 'group'
                  ? 'Group'
                  : 'User',
          }}
          onChange={({ selectedItem }) => {
            const principalType = (selectedItem?.id || 'user') as AssignmentPrincipalType;
            setForm((current) => ({
              ...current,
              principalType,
              principalId: '',
              resourceType: principalType === 'service_account' && (current.resourceType === 'platform' || current.resourceType === 'external_engine_system') ? 'engine' : current.resourceType,
              resourceId: principalType !== 'api_client' && current.resourceType === 'external_engine_system' ? '' : current.resourceId,
              roleId: '',
            }));
          }}
        />
        {form.principalType === 'api_client' ? (
          <Dropdown
            id="assignment-api-client"
            titleText="API client"
            label="Select API client"
            items={activeApiClients}
            itemToString={(item) => item?.name || ''}
            selectedItem={selectedApiClient}
            onChange={({ selectedItem }) => setForm((current) => ({ ...current, principalId: selectedItem?.id || '' }))}
          />
        ) : form.principalType === 'group' ? (
          <Dropdown
            id="assignment-group"
            titleText="Group"
            label="Select group"
            items={activeGroups}
            itemToString={(item) => item?.name || ''}
            selectedItem={selectedGroup}
            onChange={({ selectedItem }) => setForm((current) => ({ ...current, principalId: selectedItem?.id || '' }))}
          />
        ) : form.principalType === 'service_account' ? (
          <Dropdown
            id="assignment-service-account"
            titleText="Service account"
            label="Select service account"
            items={activeServiceAccounts}
            itemToString={(item) => item?.name || ''}
            selectedItem={selectedServiceAccount}
            onChange={({ selectedItem }) => setForm((current) => ({ ...current, principalId: selectedItem?.id || '' }))}
          />
        ) : (
          <TextInput
            id="assignment-user-id"
            labelText="User ID"
            value={form.principalId}
            onChange={(event) => setForm((current) => ({ ...current, principalId: event.target.value }))}
          />
        )}
        <Dropdown
          id="assignment-resource-type"
          titleText="Scope"
          label="Select scope"
          items={resourceTypeItems}
          itemToString={(item) => item?.label || ''}
          selectedItem={resourceTypeItems.find((item) => item.id === form.resourceType) || { id: form.resourceType, label: form.resourceType }}
          onChange={({ selectedItem }) => {
            const resourceType = (selectedItem?.id || 'engine') as CoreAssignmentResourceType;
            setForm((current) => ({ ...current, resourceType, resourceId: resourceType === 'platform' ? '' : current.resourceId, runtimeEngineId: resourceType === 'engine_runtime_resource' || resourceType === 'engine_runtime_resource_set' ? current.runtimeEngineId : '', roleId: '' }));
          }}
        />
        {form.resourceType === 'engine_runtime_resource' || form.resourceType === 'engine_runtime_resource_set' ? <>
          <Dropdown
            id="assignment-runtime-engine"
            titleText="Engine"
            label="Select an engine"
            items={runtimeEngines}
            itemToString={(item) => item?.name || ''}
            selectedItem={selectedRuntimeEngine}
            onChange={({ selectedItem }) => setForm((current) => ({ ...current, runtimeEngineId: selectedItem?.id || '', resourceId: '' }))}
          />
          {form.resourceType === 'engine_runtime_resource' ? (
            <Dropdown
              id="assignment-runtime-resource"
              titleText="Runtime resource"
              label={runtimeResourcesQ.isLoading ? 'Loading runtime resources' : 'Select a runtime resource'}
              items={runtimeResourcesQ.data || []}
              itemToString={(item) => item ? `${item.resourceKey} (${item.resourceKind === 'process_definition' ? 'process' : 'decision'})` : ''}
              selectedItem={selectedRuntimeResource}
              disabled={!form.runtimeEngineId || runtimeResourcesQ.isLoading}
              onChange={({ selectedItem }) => setForm((current) => ({ ...current, resourceId: selectedItem?.id || '' }))}
            />
          ) : (
            <Dropdown
              id="assignment-runtime-resource-set"
              titleText="Runtime resource set"
              label={runtimeSetsQ.isLoading ? 'Loading runtime resource sets' : 'Select a runtime resource set'}
              items={runtimeSetsQ.data || []}
              itemToString={(item) => item ? `${item.name || item.key} (${item.resourceKind})` : ''}
              selectedItem={selectedRuntimeSet}
              disabled={!form.runtimeEngineId || runtimeSetsQ.isLoading}
              onChange={({ selectedItem }) => setForm((current) => ({ ...current, resourceId: selectedItem?.id || '' }))}
            />
          )}
        </> : form.resourceType === 'external_engine_system' ? (
          <Dropdown
            id="assignment-external-system"
            titleText="External system"
            label="Select external system"
            items={activeExternalSystems}
            itemToString={(item) => item?.name || ''}
            selectedItem={selectedExternalSystem}
            onChange={({ selectedItem }) => setForm((current) => ({ ...current, resourceId: selectedItem?.id || '' }))}
          />
        ) : (
          <TextInput
            id="assignment-resource-id"
            labelText="Resource ID"
            disabled={form.resourceType === 'platform'}
            value={form.resourceId}
            onChange={(event) => setForm((current) => ({ ...current, resourceId: event.target.value }))}
          />
        )}
        <Dropdown
          id="assignment-role"
          titleText="Role"
          label="Select role"
          items={assignableRoles}
          itemToString={(item) => item?.name || ''}
          selectedItem={selectedRole}
          onChange={({ selectedItem }) => setForm((current) => ({ ...current, roleId: selectedItem?.id || '' }))}
        />
      </div>
      <div>
        <Button disabled={!canAssign || !canCreate} title={canCreate ? undefined : 'Missing permission platform:authz:roles:manage'} onClick={() => onAssign(form)}>
          Assign Role
        </Button>
      </div>
      {loading ? (
        <DataTableSkeleton headers={roleAssignmentHeaders} rowCount={5} />
      ) : (
        <TableContainer>
          <DataTable
            rows={assignments.map((assignment) => ({
              id: assignment.id,
              principal: formatAssignmentPrincipal(assignment, apiClients, groups, serviceAccounts),
              role: assignment.roleName || assignment.roleId,
              resource: formatAssignmentResource(assignment, externalSystems),
              source: assignment.source,
              actions: '',
            }))}
            headers={roleAssignmentHeaders}
          >
            {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
              <Table {...getTableProps()} size="md">
                <TableHead>
                  <TableRow>
                    {headers.map((header) => (
                      <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => {
                    const assignment = assignments.find((item) => item.id === row.id);
                    return (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'source') {
                            const configWarning = assignment?.source === 'config' && assignment.ownershipMode === 'config_warn';
                            return <TableCell key={cell.id}><Tag type={configWarning ? 'warm-gray' : authzSourceTagType(cell.value)}>{configWarning ? 'Config warning' : formatAuthzSource(cell.value)}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {(assignment?.source === 'manual' || (assignment?.source === 'config' && assignment.ownershipMode === 'config_warn')) && (
                                  <Button kind="ghost" size="sm" renderIcon={TrashCan} hasIconOnly iconDescription="Remove assignment" disabled={!canDelete} title={canDelete ? undefined : 'Missing permission platform:authz:roles:manage'} onClick={() => onRemove(assignment.id)} />
                                )}
                              </TableCell>
                            );
                          }
                          return <TableCell key={cell.id}>{cell.value}</TableCell>;
                        })}
                      </DataTableDataRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </DataTable>
        </TableContainer>
      )}
    </div>
  );
}

function PolicyInspectionTable({ rows }: { rows: ReturnType<typeof buildPolicyInspectionRows> }) {
  if (rows.length === 0) {
    return (
      <InlineNotification
        kind="info"
        title="No active policy candidates"
        subtitle="No active global or matching resource-type policies were found for this selection."
        lowContrast
      />
    );
  }

  return (
    <TableContainer title="Applicable policies">
      <DataTable rows={rows} headers={policyInspectionHeaders}>
        {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
          <Table {...getTableProps()} size="sm">
            <TableHead>
              <TableRow>
                {headers.map((header) => (
                  <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                  {row.cells.map((cell) => {
                    if (cell.info.header === 'effect') {
                      return <TableCell key={cell.id}><Tag type={cell.value === 'deny' ? 'red' : 'green'}>{cell.value}</Tag></TableCell>;
                    }
                    return <TableCell key={cell.id}>{cell.value}</TableCell>;
                  })}
                </DataTableDataRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataTable>
    </TableContainer>
  );
}

function ByPrincipalPanel({
  roles,
  assignments,
  policies,
  policyDataAvailable,
  showPolicyInspection,
  apiClients,
  groups,
  memberships,
  serviceAccounts,
  externalSystems,
  ssoGroupMappings,
  ssoAssignmentMappings,
  auditEntries,
  onOpenAuditReference,
  loading,
  groupDataAvailable,
}: {
  roles: RoleSummary[];
  assignments: RoleAssignment[];
  policies: AuthzPolicy[];
  policyDataAvailable: boolean;
  showPolicyInspection: boolean;
  apiClients: ApiClient[];
  groups: AuthzGroup[];
  memberships: AuthzGroupMembership[];
  serviceAccounts: ServiceAccount[];
  externalSystems: ExternalEngineSystem[];
  ssoGroupMappings: SsoGroupMapping[];
  ssoAssignmentMappings: SsoAssignmentMapping[];
  auditEntries: AuthzAuditEntry[];
  onOpenAuditReference?: (entry: AuthzAuditEntry) => void;
  loading: boolean;
  groupDataAvailable: boolean;
}) {
  const [searchQuery, setSearchQuery] = React.useState('');
  const principals = React.useMemo(
    () => buildPrincipalSummaries(assignments, groups, memberships, apiClients, serviceAccounts),
    [assignments, groups, memberships, apiClients, serviceAccounts],
  );
  const filteredPrincipals = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return principals;
    return principals.filter((principal) => [
      principal.label,
      principal.id,
      principal.type,
      principal.detail,
    ].join(' ').toLowerCase().includes(query));
  }, [principals, searchQuery]);
  const [selectedPrincipalKey, setSelectedPrincipalKey] = React.useState('');

  React.useEffect(() => {
    if (selectedPrincipalKey && principals.some((principal) => principal.key === selectedPrincipalKey)) return;
    setSelectedPrincipalKey(principals[0]?.key || '');
  }, [principals, selectedPrincipalKey]);

  const selectedPrincipal = principals.find((principal) => principal.key === selectedPrincipalKey) || principals[0] || null;
  const selectedDirectAssignments = selectedPrincipal
    ? assignments.filter((assignment) => roleAssignmentPrincipalMatches(assignment, selectedPrincipal.type, selectedPrincipal.id))
    : [];
  const selectedUserMemberships = selectedPrincipal?.type === 'user'
    ? memberships.filter((membership) => membership.userId === selectedPrincipal.id)
    : [];
  const selectedGroupMembers = selectedPrincipal?.type === 'group'
    ? memberships.filter((membership) => membership.groupId === selectedPrincipal.id)
    : [];
  const effectiveMembershipByGroupId = new Map<string, AuthzGroupMembership>();
  selectedUserMemberships.filter((membership) => isMembershipEffective(membership)).forEach((membership) => {
    const current = effectiveMembershipByGroupId.get(membership.groupId);
    if (!current || membership.source === 'sso') {
      effectiveMembershipByGroupId.set(membership.groupId, membership);
    }
  });
  const selectedInheritedAssignments = Array.from(effectiveMembershipByGroupId.values()).flatMap((membership) =>
    assignments
      .filter((assignment) => getAssignmentPrincipalType(assignment) === 'group' && getAssignmentPrincipalId(assignment) === membership.groupId)
      .map((assignment) => ({ assignment, membership }))
  );
  const selectedApiClient = selectedPrincipal?.type === 'api_client'
    ? apiClients.find((client) => client.id === selectedPrincipal.id) || null
    : null;
  const selectedServiceAccount = selectedPrincipal?.type === 'service_account'
    ? serviceAccounts.find((account) => account.id === selectedPrincipal.id) || null
    : null;
  const assignmentRows = [
    ...selectedDirectAssignments.map((assignment) => {
      const mapping = findSsoAssignmentMappingForAssignment(assignment, ssoAssignmentMappings);
      const auditReferenceEntries = findAssignmentAuditEntries(assignment, auditEntries, mapping);
      return {
      id: `direct-${assignment.id}`,
      grantType: 'Direct',
      role: assignment.roleName || assignment.roleId,
      scope: formatAssignmentResource(assignment, externalSystems),
      source: assignment.source,
      lineage: formatAssignmentLineage(assignment, roles, ssoAssignmentMappings),
      audit: formatAuditReferences(auditReferenceEntries),
      auditEntries: auditReferenceEntries,
      expires: assignment.expiresAt ? formatTimestamp(assignment.expiresAt) : 'Never',
      };
    }),
    ...selectedInheritedAssignments.map(({ assignment, membership }) => {
      const assignmentMapping = findSsoAssignmentMappingForAssignment(assignment, ssoAssignmentMappings);
      const membershipMapping = findSsoGroupMappingForMembership(membership, ssoGroupMappings);
      const auditReferenceEntries = [
        ...findMembershipAuditEntries(membership, auditEntries, membershipMapping),
        ...findAssignmentAuditEntries(assignment, auditEntries, assignmentMapping),
      ];
      return {
      id: `inherited-${membership.id}-${assignment.id}`,
      grantType: 'Group',
      role: assignment.roleName || assignment.roleId,
      scope: formatAssignmentResource(assignment, externalSystems),
      source: `${assignment.source} via ${membership.source}`,
      lineage: joinLineageParts([
        `via group ${membership.groupName || groups.find((group) => group.id === membership.groupId)?.name || membership.groupId} (${membership.source} membership)`,
        formatMembershipLineage(membership, ssoGroupMappings),
        formatAssignmentLineage(assignment, roles, ssoAssignmentMappings),
      ]),
      audit: formatAuditReferences(auditReferenceEntries),
      auditEntries: auditReferenceEntries,
      expires: membership.expiresAt ? formatTimestamp(membership.expiresAt) : 'Never',
      };
    }),
  ];
  const policyRows = getPolicyInspectionRowsForAssignments(
    policies,
    [
      ...selectedDirectAssignments,
      ...selectedInheritedAssignments.map(({ assignment }) => assignment),
    ],
  );
  const relationshipRows = selectedPrincipal?.type === 'user'
    ? selectedUserMemberships.map((membership) => {
      const mapping = findSsoGroupMappingForMembership(membership, ssoGroupMappings);
      const auditReferenceEntries = findMembershipAuditEntries(membership, auditEntries, mapping);
      return {
      id: membership.id,
      name: membership.groupName || groups.find((group) => group.id === membership.groupId)?.name || membership.groupId,
      type: 'Group membership',
      source: membership.source,
      lineage: formatMembershipLineage(membership, ssoGroupMappings),
      audit: formatAuditReferences(auditReferenceEntries),
      auditEntries: auditReferenceEntries,
      expires: membership.expiresAt ? formatTimestamp(membership.expiresAt) : 'Never',
      };
    })
    : selectedPrincipal?.type === 'group'
      ? selectedGroupMembers.map((membership) => {
        const mapping = findSsoGroupMappingForMembership(membership, ssoGroupMappings);
        const auditReferenceEntries = findMembershipAuditEntries(membership, auditEntries, mapping);
        return {
        id: membership.id,
        name: membership.userId,
        type: 'User member',
        source: membership.source,
        lineage: formatMembershipLineage(membership, ssoGroupMappings),
        audit: formatAuditReferences(auditReferenceEntries),
        auditEntries: auditReferenceEntries,
        expires: membership.expiresAt ? formatTimestamp(membership.expiresAt) : 'Never',
        };
      })
      : selectedApiClient
        ? (selectedApiClient.scopes || []).map((scope) => ({
          id: scope,
          name: scope,
          type: 'API client scope',
          source: 'api',
          lineage: selectedApiClient.createdById ? `createdBy=${selectedApiClient.createdById}` : '-',
          audit: '-',
          auditEntries: [],
          expires: 'Never',
        }))
        : selectedServiceAccount
          ? (selectedServiceAccount.scopes || []).map((scope) => ({
            id: scope,
            name: scope,
            type: 'Service account scope',
            source: 'api',
            lineage: selectedServiceAccount.createdById ? `createdBy=${selectedServiceAccount.createdById}` : '-',
            audit: '-',
            auditEntries: [],
            expires: 'Never',
          }))
          : [];

  if (loading) return <DataTableSkeleton headers={principalOverviewHeaders} rowCount={6} />;

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
      {!groupDataAvailable && (
        <InlineNotification
          kind="info"
          title="Group lineage unavailable"
          subtitle="Only direct role assignments are shown because group read permission is not available."
          lowContrast
        />
      )}
      <TableContainer title="Principals">
        <DataTable
          rows={filteredPrincipals.map((principal) => ({
            id: principal.key,
            principal: principal.label,
            type: principalTypeLabel(principal.type),
            directAssignments: principal.directAssignmentCount,
            inheritedAssignments: principal.inheritedAssignmentCount,
            relationships: principal.relationshipCount,
            status: principal.status,
            actions: '',
          }))}
          headers={principalOverviewHeaders}
        >
          {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
            <>
              <TableToolbar>
                <TableToolbarContent>
                  <TableToolbarSearch
                    persistent
                    value={searchQuery}
                    onChange={(event: any) => setSearchQuery(event.target.value)}
                    placeholder="Search principals"
                  />
                </TableToolbarContent>
              </TableToolbar>
              <Table {...getTableProps()} size="md">
                <TableHead>
                  <TableRow>
                    {headers.map((header) => (
                      <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={headers.length}>No principals match the current filter.</TableCell>
                    </TableRow>
                  ) : rows.map((row) => {
                    const principal = filteredPrincipals.find((item) => item.key === row.id);
                    return (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'status') return <TableCell key={cell.id}>{formatPrincipalStatus(cell.value as PrincipalSummaryStatus)}</TableCell>;
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {principal && (
                                  <Button kind="ghost" size="sm" aria-label={`View principal ${principal.label}`} onClick={() => setSelectedPrincipalKey(principal.key)}>
                                    View
                                  </Button>
                                )}
                              </TableCell>
                            );
                          }
                          return <TableCell key={cell.id}>{cell.value}</TableCell>;
                        })}
                      </DataTableDataRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </DataTable>
      </TableContainer>
      {selectedPrincipal ? (
        <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
          <div>
            <h3 style={{ margin: 0 }}>{principalTypeLabel(selectedPrincipal.type)}: {selectedPrincipal.label}</h3>
            <p style={{ marginTop: 'var(--spacing-2)' }}>{selectedPrincipal.detail}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-2)' }}>
              <Tag type="blue">{selectedDirectAssignments.length} direct assignment{selectedDirectAssignments.length === 1 ? '' : 's'}</Tag>
              <Tag type="teal">{selectedInheritedAssignments.length} inherited assignment{selectedInheritedAssignments.length === 1 ? '' : 's'}</Tag>
              <Tag type="cool-gray">{relationshipRows.length} relationship{relationshipRows.length === 1 ? '' : 's'}</Tag>
              {formatPrincipalStatus(selectedPrincipal.status)}
            </div>
          </div>
          <TableContainer title="Principal role assignments">
            <DataTable rows={assignmentRows} headers={principalAssignmentHeaders}>
              {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                <Table {...getTableProps()} size="sm">
                  <TableHead>
                    <TableRow>
                      {headers.map((header) => (
                        <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={headers.length}>No direct or inherited role assignments for this principal.</TableCell>
                      </TableRow>
                    ) : rows.map((row) => {
                      const assignmentRow = assignmentRows.find((item) => item.id === row.id);
                      return (
                        <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                          {row.cells.map((cell) => {
                            if (cell.info.header === 'grantType') {
                              return <TableCell key={cell.id}><Tag type={cell.value === 'Direct' ? 'blue' : 'teal'}>{cell.value}</Tag></TableCell>;
                            }
                            if (cell.info.header === 'audit') {
                              return (
                                <TableCell key={cell.id}>
                                  <AuditReferenceLinks entries={assignmentRow?.auditEntries || []} onOpen={onOpenAuditReference} />
                                </TableCell>
                              );
                            }
                            return <TableCell key={cell.id}>{cell.value}</TableCell>;
                          })}
                        </DataTableDataRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </DataTable>
          </TableContainer>
          <TableContainer title="Principal relationships">
            <DataTable rows={relationshipRows} headers={principalRelationshipHeaders}>
              {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                <Table {...getTableProps()} size="sm">
                  <TableHead>
                    <TableRow>
                      {headers.map((header) => (
                        <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={headers.length}>No group memberships, members, or machine scopes for this principal.</TableCell>
                      </TableRow>
                    ) : rows.map((row) => {
                      const relationshipRow = relationshipRows.find((item) => item.id === row.id);
                      return (
                        <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                          {row.cells.map((cell) => {
                            if (cell.info.header === 'audit') {
                              return (
                                <TableCell key={cell.id}>
                                  <AuditReferenceLinks entries={relationshipRow?.auditEntries || []} onOpen={onOpenAuditReference} />
                                </TableCell>
                              );
                            }
                            return <TableCell key={cell.id}>{cell.value}</TableCell>;
                          })}
                        </DataTableDataRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </DataTable>
          </TableContainer>
          {policyDataAvailable && showPolicyInspection && <PolicyInspectionTable rows={policyRows} />}
        </div>
      ) : (
        <InlineNotification kind="info" title="No principals found" subtitle="Role assignments, groups, API clients, and service accounts will appear here once created." lowContrast />
      )}
    </div>
  );
}

function ByResourcePanel({
  roles,
  assignments,
  policies,
  policyDataAvailable,
  showPolicyInspection,
  apiClients,
  groups,
  serviceAccounts,
  externalSystems,
  engineSets,
  externalEngines,
  projectTargets,
  ssoAssignmentMappings,
  auditEntries,
  onOpenAuditReference,
  loading,
}: {
  roles: RoleSummary[];
  assignments: RoleAssignment[];
  policies: AuthzPolicy[];
  policyDataAvailable: boolean;
  showPolicyInspection: boolean;
  apiClients: ApiClient[];
  groups: AuthzGroup[];
  serviceAccounts: ServiceAccount[];
  externalSystems: ExternalEngineSystem[];
  engineSets: EngineSetSummary[];
  externalEngines: ExternalEngineRegistration[];
  projectTargets: ProjectEngineTarget[];
  ssoAssignmentMappings: SsoAssignmentMapping[];
  auditEntries: AuthzAuditEntry[];
  onOpenAuditReference?: (entry: AuthzAuditEntry) => void;
  loading: boolean;
}) {
  const [searchQuery, setSearchQuery] = React.useState('');
  const resources = React.useMemo(
    () => buildResourceSummaries(assignments, externalSystems, engineSets, externalEngines, projectTargets),
    [assignments, externalSystems, engineSets, externalEngines, projectTargets],
  );
  const filteredResources = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return resources;
    return resources.filter((resource) => [
      resource.label,
      resource.id,
      resource.type,
      resource.detail,
      resource.status,
    ].join(' ').toLowerCase().includes(query));
  }, [resources, searchQuery]);
  const [selectedResourceKey, setSelectedResourceKey] = React.useState('');

  React.useEffect(() => {
    if (selectedResourceKey && resources.some((resource) => resource.key === selectedResourceKey)) return;
    setSelectedResourceKey(resources[0]?.key || '');
  }, [resources, selectedResourceKey]);

  const selectedResource = resources.find((resource) => resource.key === selectedResourceKey) || resources[0] || null;
  const selectedAssignments = selectedResource
    ? assignments.filter((assignment) => assignmentResourceMatches(assignment, selectedResource))
    : [];
  const assignmentRows = selectedAssignments.map((assignment) => {
    const mapping = findSsoAssignmentMappingForAssignment(assignment, ssoAssignmentMappings);
    const auditReferenceEntries = findAssignmentAuditEntries(assignment, auditEntries, mapping);
    return {
    id: assignment.id,
    principal: formatAssignmentPrincipal(assignment, apiClients, groups, serviceAccounts),
    principalType: principalTypeLabel(getAssignmentPrincipalType(assignment)),
    role: assignment.roleName || assignment.roleId,
    source: assignment.source,
    lineage: formatAssignmentLineage(assignment, roles, ssoAssignmentMappings),
    audit: formatAuditReferences(auditReferenceEntries),
    auditEntries: auditReferenceEntries,
    expires: assignment.expiresAt ? formatTimestamp(assignment.expiresAt) : 'Never',
    };
  });
  const relationshipRows = selectedResource?.type === 'engine'
    ? projectTargets.filter((target) => target.engineId === selectedResource.id).map((target) => ({
      id: target.id,
      name: target.projectName || target.projectId,
      type: 'Project target',
      status: target.status,
      source: target.source,
      details: `${target.allowManualDeploy ? 'manual' : ''}${target.allowCiDeploy ? ' ci' : ''}${target.allowApiDeploy ? ' api' : ''}${target.allowImport ? ' import' : ''}`.trim() || 'No deployment modes',
    }))
    : selectedResource?.type === 'project'
      ? projectTargets.filter((target) => target.projectId === selectedResource.id).map((target) => ({
        id: target.id,
        name: target.engineName || target.engineId,
        type: 'Engine target',
        status: target.status,
        source: target.source,
        details: target.environment?.name || target.engineId,
      }))
      : selectedResource?.type === 'external_engine_system'
        ? externalEngines.filter((engine) => engine.externalSystemId === selectedResource.id).map((engine) => ({
          id: engine.id,
          name: engine.name,
          type: 'Registered engine',
          status: engine.lifecycleStatus,
          source: engine.registrationSource,
          details: engine.externalId,
        }))
        : selectedResource?.type === 'engine_set'
          ? engineSets.filter((engineSet) => engineSet.id === selectedResource.id).map((engineSet) => ({
            id: engineSet.id,
            name: `${engineSet.materializedEngineCount} materialized engine${engineSet.materializedEngineCount === 1 ? '' : 's'}`,
            type: 'Materialization summary',
            status: engineSet.materializationStatus || 'unknown',
            source: engineSet.source,
            details: engineSet.selectorFingerprint,
          }))
          : selectedResource?.type === 'project_engine_target'
            ? projectTargets.filter((target) => target.id === selectedResource.id).map((target) => ({
              id: target.id,
              name: `${target.projectName || target.projectId} -> ${target.engineName || target.engineId}`,
              type: 'Target relationship',
              status: target.status,
              source: target.source,
              details: target.externalTargetId || target.environment?.name || target.engineId,
            }))
            : [];
  const policyRows = getPolicyInspectionRowsForResource(policies, selectedResource);

  if (loading) return <DataTableSkeleton headers={resourceOverviewHeaders} rowCount={6} />;

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
      <TableContainer title="Resources">
        <DataTable
          rows={filteredResources.map((resource) => ({
            id: resource.key,
            resource: resource.label,
            type: authzResourceTypeLabel(resource.type),
            assignments: resource.assignmentCount,
            users: resource.userAssignmentCount,
            groups: resource.groupAssignmentCount,
            machines: resource.machineAssignmentCount,
            status: resource.status,
            actions: '',
          }))}
          headers={resourceOverviewHeaders}
        >
          {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
            <>
              <TableToolbar>
                <TableToolbarContent>
                  <TableToolbarSearch
                    persistent
                    value={searchQuery}
                    onChange={(event: any) => setSearchQuery(event.target.value)}
                    placeholder="Search resources"
                  />
                </TableToolbarContent>
              </TableToolbar>
              <Table {...getTableProps()} size="md">
                <TableHead>
                  <TableRow>
                    {headers.map((header) => (
                      <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={headers.length}>No resources match the current filter.</TableCell>
                    </TableRow>
                  ) : rows.map((row) => {
                    const resource = filteredResources.find((item) => item.key === row.id);
                    return (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'status') return <TableCell key={cell.id}>{formatResourceStatusTag(String(cell.value))}</TableCell>;
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {resource && (
                                  <Button kind="ghost" size="sm" aria-label={`View resource ${resource.label}`} onClick={() => setSelectedResourceKey(resource.key)}>
                                    View
                                  </Button>
                                )}
                              </TableCell>
                            );
                          }
                          return <TableCell key={cell.id}>{cell.value}</TableCell>;
                        })}
                      </DataTableDataRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </DataTable>
      </TableContainer>
      {selectedResource ? (
        <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
          <div>
            <h3 style={{ margin: 0 }}>{authzResourceTypeLabel(selectedResource.type)}: {selectedResource.label}</h3>
            <p style={{ marginTop: 'var(--spacing-2)' }}>{selectedResource.detail}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-2)' }}>
              <Tag type="blue">{selectedAssignments.length} assignment{selectedAssignments.length === 1 ? '' : 's'}</Tag>
              <Tag type="teal">{relationshipRows.length} relationship{relationshipRows.length === 1 ? '' : 's'}</Tag>
              {formatResourceStatusTag(selectedResource.status)}
            </div>
          </div>
          <TableContainer title="Resource role assignments">
            <DataTable rows={assignmentRows} headers={resourceAssignmentHeaders}>
              {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                <Table {...getTableProps()} size="sm">
                  <TableHead>
                    <TableRow>
                      {headers.map((header) => (
                        <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={headers.length}>No role assignments target this resource.</TableCell>
                      </TableRow>
                    ) : rows.map((row) => {
                      const assignmentRow = assignmentRows.find((item) => item.id === row.id);
                      return (
                        <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                          {row.cells.map((cell) => {
                            if (cell.info.header === 'audit') {
                              return (
                                <TableCell key={cell.id}>
                                  <AuditReferenceLinks entries={assignmentRow?.auditEntries || []} onOpen={onOpenAuditReference} />
                                </TableCell>
                              );
                            }
                            return <TableCell key={cell.id}>{cell.value}</TableCell>;
                          })}
                        </DataTableDataRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </DataTable>
          </TableContainer>
          <TableContainer title="Resource relationships">
            <DataTable rows={relationshipRows} headers={resourceRelationshipHeaders}>
              {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                <Table {...getTableProps()} size="sm">
                  <TableHead>
                    <TableRow>
                      {headers.map((header) => (
                        <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={headers.length}>No related project targets, registered engines, or materialization summaries for this resource.</TableCell>
                      </TableRow>
                    ) : rows.map((row) => (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => (
                          <TableCell key={cell.id}>{cell.value}</TableCell>
                        ))}
                      </DataTableDataRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </DataTable>
          </TableContainer>
          {policyDataAvailable && showPolicyInspection && <PolicyInspectionTable rows={policyRows} />}
        </div>
      ) : (
        <InlineNotification kind="info" title="No resources found" subtitle="Scoped role assignments and known platform resources will appear here once created." lowContrast />
      )}
    </div>
  );
}

function SsoAssignmentDiagnosticsPanel({
  diagnostics,
  roles,
  testResult,
}: {
  diagnostics: SsoAssignmentDiagnostics;
  roles: RoleSummary[];
  testResult: SsoAssignmentTestResult | null | undefined;
}) {
  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
      <h3 style={{ margin: 0 }}>SSO diagnostics</h3>
      <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
        <Tag type="green">{diagnostics.activeMappings} active mapping{diagnostics.activeMappings === 1 ? '' : 's'}</Tag>
        <Tag type="gray">{diagnostics.inactiveMappings} inactive mapping{diagnostics.inactiveMappings === 1 ? '' : 's'}</Tag>
        <Tag type="blue">{diagnostics.authoritativeMappings} authoritative</Tag>
        <Tag type="cyan">{diagnostics.additiveMappings} additive</Tag>
        <Tag type={diagnostics.allEngineSelectors > 0 ? 'red' : 'gray'}>{diagnostics.allEngineSelectors} all-engine selector{diagnostics.allEngineSelectors === 1 ? '' : 's'}</Tag>
        <Tag type={diagnostics.targetWarnings.length > 0 ? 'magenta' : 'gray'}>{diagnostics.targetWarnings.length} target warning{diagnostics.targetWarnings.length === 1 ? '' : 's'}</Tag>
        <Tag type={diagnostics.staleAssignments.length > 0 ? 'red' : 'gray'}>{diagnostics.staleAssignments.length} stale SSO assignment{diagnostics.staleAssignments.length === 1 ? '' : 's'}</Tag>
        <Tag type="cool-gray">{diagnostics.ssoAssignmentCount} SSO-managed assignment{diagnostics.ssoAssignmentCount === 1 ? '' : 's'}</Tag>
      </div>

      {diagnostics.allEngineSelectors > 0 && (
        <InlineNotification
          kind="warning"
          title="All-engine selectors are broad"
          subtitle="Review these mappings before enabling authoritative sync in production environments."
          lowContrast
        />
      )}

      <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
        <strong>Target diagnostics</strong>
        {diagnostics.targetSummaries.length === 0 ? (
          <div>No SSO engine assignment mappings are configured.</div>
        ) : diagnostics.targetSummaries.map(({ mapping, summary, warning }) => (
          <div key={mapping.id} style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <code>{ssoClaimLabel(mapping)}</code>
            <span>{selectorLabel(mapping)}</span>
            <Tag type={warning ? 'magenta' : 'green'}>{summary}</Tag>
            <span>{roleLabel(mapping.targetRoleId, roles)}</span>
          </div>
        ))}
      </div>

      {diagnostics.staleAssignments.length > 0 && (
        <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
          <strong>Stale SSO assignment lineage</strong>
          {diagnostics.staleAssignments.map((assignment) => (
            <div key={assignment.id} style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'center', flexWrap: 'wrap' }}>
              <code>{assignment.id}</code>
              <span>{roleLabel(assignment.roleId, roles)} - {assignment.resourceType || assignment.scopeType}:{assignment.resourceId || assignment.scopeId || '*'}</span>
              <Tag type="red">{assignment.sourceMappingId || 'missing mapping'}</Tag>
            </div>
          ))}
        </div>
      )}

      {testResult && (
        <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
          <strong>Claims preview</strong>
          <div>
            {testResult.matchedMappings.length} matched mapping{testResult.matchedMappings.length === 1 ? '' : 's'}; {testResult.assignments.length} assignment{testResult.assignments.length === 1 ? '' : 's'} would be created or refreshed.
          </div>
          {testResult.assignments.length > 0 && (
            <div style={{ display: 'grid', gap: 'var(--spacing-1)' }}>
              {testResult.assignments.map((assignment, index) => (
                <div key={`${assignment.mappingId}-${assignment.roleId}-${assignment.resourceId || 'all'}-${index}`} style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Tag type="blue">{assignment.mappingId}</Tag>
                  <span>{roleLabel(assignment.roleId, roles)} - {assignment.resourceId || 'all engines'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type SsoSyncDiagnosticsOptions = {
  includeProviderChecks: boolean;
  includeSnapshotReplay: boolean;
  refreshProviderClaims: boolean;
  includeCleanup: boolean;
};

const DEFAULT_SSO_DIAGNOSTICS_OPTIONS: SsoSyncDiagnosticsOptions = {
  includeProviderChecks: false,
  includeSnapshotReplay: false,
  refreshProviderClaims: false,
  includeCleanup: false,
};

function SsoSyncDiagnosticsPanel({
  runs,
  events,
  loading,
  eventsLoading,
  runsError,
  eventsError,
  selectedRunId,
  canRunDiagnostics,
  diagnosticsUnavailableReason,
  diagnosticsRunning,
  lastDiagnosticsResult,
  diagnosticsOptions,
  onSelectRun,
  onRunDiagnostics,
  onDiagnosticsOptionsChange,
}: {
  runs: SsoSyncRun[];
  events: SsoSyncEvent[];
  loading: boolean;
  eventsLoading: boolean;
  runsError: boolean;
  eventsError: boolean;
  selectedRunId: string | null;
  canRunDiagnostics: boolean;
  diagnosticsUnavailableReason?: string;
  diagnosticsRunning: boolean;
  lastDiagnosticsResult: SsoSyncDiagnosticsScanResult | null;
  diagnosticsOptions: SsoSyncDiagnosticsOptions;
  onSelectRun: (runId: string) => void;
  onRunDiagnostics: () => void;
  onDiagnosticsOptionsChange: (options: SsoSyncDiagnosticsOptions) => void;
}) {
  const selectedRun = runs.find((run) => run.id === selectedRunId) || null;
  const updateOption = (key: keyof SsoSyncDiagnosticsOptions, checked: boolean) => {
    onDiagnosticsOptionsChange({
      ...diagnosticsOptions,
      [key]: checked,
      ...(key === 'includeSnapshotReplay' && !checked ? { refreshProviderClaims: false } : {}),
    });
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>SSO sync runs</h3>
        <Button
          kind="secondary"
          size="sm"
          onClick={onRunDiagnostics}
          disabled={!canRunDiagnostics || diagnosticsRunning}
          title={diagnosticsUnavailableReason}
        >
          {diagnosticsRunning ? 'Running...' : 'Run diagnostics'}
        </Button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-4)', flexWrap: 'wrap' }}>
        <Checkbox
          id="sso-diagnostics-provider-checks"
          labelText="Provider checks"
          checked={diagnosticsOptions.includeProviderChecks}
          onChange={(_event, { checked }) => updateOption('includeProviderChecks', Boolean(checked))}
        />
        <Checkbox
          id="sso-diagnostics-snapshot-replay"
          labelText="Snapshot replay"
          checked={diagnosticsOptions.includeSnapshotReplay}
          onChange={(_event, { checked }) => updateOption('includeSnapshotReplay', Boolean(checked))}
        />
        <Checkbox
          id="sso-diagnostics-refresh-claims"
          labelText="Refresh claims"
          checked={diagnosticsOptions.refreshProviderClaims}
          disabled={!diagnosticsOptions.includeSnapshotReplay}
          onChange={(_event, { checked }) => updateOption('refreshProviderClaims', Boolean(checked))}
        />
        <Checkbox
          id="sso-diagnostics-cleanup"
          labelText="Cleanup stale rows"
          checked={diagnosticsOptions.includeCleanup}
          onChange={(_event, { checked }) => updateOption('includeCleanup', Boolean(checked))}
        />
      </div>
      {lastDiagnosticsResult && (
        <InlineNotification
          kind={lastDiagnosticsResult.errors > 0 ? 'error' : lastDiagnosticsResult.warnings > 0 ? 'warning' : 'success'}
          title="Diagnostics run complete"
          subtitle={`${lastDiagnosticsResult.warnings} warning${lastDiagnosticsResult.warnings === 1 ? '' : 's'}, ${lastDiagnosticsResult.errors} error${lastDiagnosticsResult.errors === 1 ? '' : 's'} across ${lastDiagnosticsResult.scannedAssignmentMappings} assignment mapping${lastDiagnosticsResult.scannedAssignmentMappings === 1 ? '' : 's'} and ${lastDiagnosticsResult.scannedGroupMappings} group mapping${lastDiagnosticsResult.scannedGroupMappings === 1 ? '' : 's'}.`}
          lowContrast
        />
      )}
      {runsError && <InlineNotification kind="error" title="Unable to load SSO sync runs" lowContrast />}
      {loading ? (
        <DataTableSkeleton headers={ssoSyncRunHeaders} rowCount={3} />
      ) : (
        <TableContainer>
          <DataTable
            rows={runs.map((run) => ({
              id: run.id,
              status: run.status,
              provider: providerLabel(run.providerId),
              user: run.userId || '-',
              trigger: formatStatusLabel(run.trigger),
              changes: formatSsoSyncCounts(run),
              started: formatTimestamp(run.startedAt),
              duration: formatSsoSyncDuration(run),
              error: run.errorMessage || run.errorCode || '-',
              actions: '',
            }))}
            headers={ssoSyncRunHeaders}
          >
            {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
              <Table {...getTableProps()} size="md">
                <TableHead>
                  <TableRow>
                    {headers.map((header) => (
                      <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={headers.length}>No SSO sync runs have been recorded yet.</TableCell>
                    </TableRow>
                  ) : rows.map((row) => {
                    const run = runs.find((item) => item.id === row.id);
                    return (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'status') {
                            const status = cell.value as SsoSyncRun['status'];
                            return <TableCell key={cell.id}><Tag type={getSsoSyncStatusTagType(status)}>{formatStatusLabel(status)}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {run && (
                                  <Button kind="ghost" size="sm" onClick={() => onSelectRun(run.id)}>
                                    Events
                                  </Button>
                                )}
                              </TableCell>
                            );
                          }
                          return <TableCell key={cell.id}>{cell.value}</TableCell>;
                        })}
                      </DataTableDataRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </DataTable>
        </TableContainer>
      )}

      {selectedRun ? (
        <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
          <strong>{selectedRun.id} events</strong>
          {eventsError && <InlineNotification kind="error" title="Unable to load SSO sync events" lowContrast />}
          {eventsLoading ? (
            <DataTableSkeleton headers={ssoSyncEventHeaders} rowCount={3} />
          ) : (
            <TableContainer>
              <DataTable
                rows={events.map((event) => ({
                  id: event.id,
                  severity: event.severity,
                  type: event.type,
                  message: event.message,
                  resource: formatSsoSyncResource(event),
                  mapping: formatSsoSyncMapping(event),
                  created: formatTimestamp(event.createdAt),
                  details: formatSsoSyncDetails(event.details),
                }))}
                headers={ssoSyncEventHeaders}
              >
                {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                  <Table {...getTableProps()} size="md">
                    <TableHead>
                      <TableRow>
                        {headers.map((header) => (
                          <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={headers.length}>No events were recorded for this run.</TableCell>
                        </TableRow>
                      ) : rows.map((row) => (
                        <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                          {row.cells.map((cell) => {
                            if (cell.info.header === 'severity') {
                              const severity = cell.value as SsoSyncEvent['severity'];
                              return <TableCell key={cell.id}><Tag type={getSsoSyncSeverityTagType(severity)}>{formatStatusLabel(severity)}</Tag></TableCell>;
                            }
                            return <TableCell key={cell.id}>{cell.value}</TableCell>;
                          })}
                        </DataTableDataRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </DataTable>
            </TableContainer>
          )}
        </div>
      ) : (
        !loading && runs.length > 0 && (
          <InlineNotification kind="info" title="Select a sync run to inspect reconciliation events" lowContrast />
        )
      )}
    </div>
  );
}

function SsoEngineAccessSnapshotsPanel({
  snapshots,
  roles,
  loading,
  error,
  canManageCleanup,
  cleanupUnavailableReason,
}: {
  snapshots: SsoEngineAccessSnapshot[];
  roles: RoleSummary[];
  loading: boolean;
  error: boolean;
  canManageCleanup: boolean;
  cleanupUnavailableReason?: string;
}) {
  const previewCleanupM = usePreviewEngineAccessTransitionCleanup();
  const applyCleanupM = useApplyEngineAccessTransitionCleanup();
  const [cleanupEngineId, setCleanupEngineId] = React.useState('');
  const [selectedCleanupIds, setSelectedCleanupIds] = React.useState<string[]>([]);
  const cleanupCandidates = previewCleanupM.data?.candidates || [];
  const previewCleanup = async () => {
    const engineId = cleanupEngineId.trim();
    if (!engineId) return;
    setSelectedCleanupIds([]);
    await previewCleanupM.mutateAsync(engineId);
  };
  const applyCleanup = async () => {
    if (!previewCleanupM.data || selectedCleanupIds.length === 0) return;
    await applyCleanupM.mutateAsync({
      engineId: previewCleanupM.data.engineId,
      previewCorrelationId: previewCleanupM.data.previewCorrelationId,
      assignmentIds: selectedCleanupIds,
    });
    setSelectedCleanupIds([]);
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>SSO engine access snapshots</h3>
        <Tag type="purple" size="sm">{snapshots.length} snapshot{snapshots.length === 1 ? '' : 's'}</Tag>
      </div>
      <div style={{ display: 'flex', gap: 'var(--spacing-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <TextInput
          id="sso-engine-access-cleanup-engine-id"
          labelText="Transition cleanup engine ID"
          value={cleanupEngineId}
          onChange={(event) => setCleanupEngineId(event.target.value)}
          style={{ minWidth: 260 }}
        />
        <Button
          kind="tertiary"
          size="sm"
          onClick={previewCleanup}
          disabled={!canManageCleanup || !cleanupEngineId.trim() || previewCleanupM.isPending}
          title={!canManageCleanup ? cleanupUnavailableReason : undefined}
        >
          {previewCleanupM.isPending ? 'Previewing...' : 'Preview cleanup'}
        </Button>
      </div>
      {previewCleanupM.error && (
        <InlineNotification kind="error" title="Cleanup preview failed" subtitle={parseApiError(previewCleanupM.error, 'Unable to preview cleanup').message} lowContrast />
      )}
      {applyCleanupM.error && (
        <InlineNotification kind="error" title="Cleanup apply failed" subtitle={parseApiError(applyCleanupM.error, 'Unable to apply cleanup').message} lowContrast />
      )}
      {previewCleanupM.data && (
        <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
          <InlineNotification
            kind={cleanupCandidates.length > 0 ? 'info' : 'success'}
            title={`${cleanupCandidates.length} cleanup candidate${cleanupCandidates.length === 1 ? '' : 's'} found`}
            subtitle={cleanupCandidates.length > 0 ? 'Select manual assignments to remove. SSO assignments are kept as replacements.' : 'No duplicate manual access was found for this engine.'}
            lowContrast
          />
          {cleanupCandidates.length > 0 && (
            <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
              {cleanupCandidates.map((candidate) => (
                <Checkbox
                  key={`${candidate.manualAssignmentId}-${candidate.ssoAssignmentId}`}
                  id={`cleanup-${candidate.manualAssignmentId}-${candidate.ssoAssignmentId}`}
                  labelText={`${candidate.principalType}:${candidate.principalId} manual ${roleLabel(candidate.manualRoleId, roles)} -> SSO ${roleLabel(candidate.ssoRoleId, roles)} (${formatStatusLabel(candidate.recommendedAction)})`}
                  checked={selectedCleanupIds.includes(candidate.manualAssignmentId)}
                  onChange={(_event, { checked }) => {
                    setSelectedCleanupIds((current) => checked
                      ? Array.from(new Set([...current, candidate.manualAssignmentId]))
                      : current.filter((id) => id !== candidate.manualAssignmentId));
                  }}
                />
              ))}
              <Button
                kind="danger--tertiary"
                size="sm"
                onClick={applyCleanup}
                disabled={!canManageCleanup || selectedCleanupIds.length === 0 || applyCleanupM.isPending}
                title={!canManageCleanup ? cleanupUnavailableReason : undefined}
              >
                {applyCleanupM.isPending ? 'Applying...' : `Remove ${selectedCleanupIds.length} manual assignment${selectedCleanupIds.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          )}
        </div>
      )}
      {error ? (
        <InlineNotification kind="warning" title="Unable to load SSO engine access snapshots" lowContrast />
      ) : loading ? (
        <DataTableSkeleton headers={ssoEngineAccessSnapshotHeaders} rowCount={3} />
      ) : snapshots.length === 0 ? (
        <InlineNotification kind="info" title="No SSO engine access snapshots yet" subtitle="Snapshots are recorded after SSO engine assignment sync creates or refreshes engine-scoped access." lowContrast />
      ) : (
        <TableContainer>
          <DataTable
            rows={snapshots.slice(0, 25).map((snapshot) => {
              const currentRoleIds = snapshot.currentRoleIds || [];
              const providerSubjectIds = snapshot.providerSubjectIds || [];
              const providerGroupIds = snapshot.providerGroupIds || [];
              return {
                id: snapshot.id,
                principal: `${snapshot.principalType}: ${snapshot.principalId}`,
                engine: snapshot.engineId,
                roles: currentRoleIds.map((roleId) => roleLabel(roleId, roles)).join(', ') || '-',
                status: snapshot.status,
                mapping: snapshot.mappingId,
                lastSync: formatTimestamp(snapshot.lastSyncedAt),
                lineage: [
                  snapshot.providerId ? `provider=${snapshot.providerId}` : '',
                  providerSubjectIds.length ? `${providerSubjectIds.length} subject id${providerSubjectIds.length === 1 ? '' : 's'}` : '',
                  providerGroupIds.length ? `${providerGroupIds.length} group id${providerGroupIds.length === 1 ? '' : 's'}` : '',
                  snapshot.cleanupReason ? `cleanup=${snapshot.cleanupReason}` : '',
                ].filter(Boolean).join('; ') || '-',
              };
            })}
            headers={ssoEngineAccessSnapshotHeaders}
          >
            {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
              <Table {...getTableProps()} size="md">
                <TableHead>
                  <TableRow>
                    {headers.map((header) => (
                      <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow {...getRowProps({ row })}>
                      {row.cells.map((cell) => {
                        if (cell.info.header === 'status') {
                          const status = String(cell.value) as SsoEngineAccessSnapshot['status'];
                          return <TableCell key={cell.id}><Tag type={getSsoEngineSnapshotStatusTagType(status)}>{formatStatusLabel(status)}</Tag></TableCell>;
                        }
                        return <TableCell key={cell.id}>{cell.value}</TableCell>;
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </DataTable>
        </TableContainer>
      )}
    </div>
  );
}

function SsoMappingsPanel({
  platformMappings,
  groupMappings,
  groups,
  platformLoading,
  groupLoading,
  testClaims,
  platformTestResult,
  groupTestResult,
  canReadPlatform,
  canManagePlatform,
  canReadGroups,
  canManageGroups,
  platformPending,
  groupPending,
  onTestClaimsChange,
  onTestPlatform,
  onTestGroups,
  onCreatePlatform,
  onEditPlatform,
  onDeletePlatform,
  onCreateGroup,
  onEditGroup,
  onDeleteGroup,
}: {
  platformMappings: SsoClaimsMapping[];
  groupMappings: SsoGroupMapping[];
  groups: AuthzGroup[];
  platformLoading: boolean;
  groupLoading: boolean;
  testClaims: string;
  platformTestResult: SsoPlatformMappingTestResult | null | undefined;
  groupTestResult: SsoGroupMappingTestResult | null | undefined;
  canReadPlatform: boolean;
  canManagePlatform: boolean;
  canReadGroups: boolean;
  canManageGroups: boolean;
  platformPending: boolean;
  groupPending: boolean;
  onTestClaimsChange: (value: string) => void;
  onTestPlatform: () => void;
  onTestGroups: () => void;
  onCreatePlatform: () => void;
  onEditPlatform: (mapping: SsoClaimsMapping) => void;
  onDeletePlatform: (id: string) => void;
  onCreateGroup: () => void;
  onEditGroup: (mapping: SsoGroupMapping) => void;
  onDeleteGroup: (id: string) => void;
}) {
  const activeGroups = groups.filter((group) => !group.isArchived);

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-6)' }}>
      <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
        <h3 style={{ margin: 0 }}>Claims preview</h3>
        <TextInput
          id="sso-mappings-test-claims"
          labelText="Test claims JSON"
          value={testClaims}
          onChange={(event) => onTestClaimsChange(event.target.value)}
        />
        <div style={{ display: 'flex', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
          {canReadPlatform && (
            <Button kind="ghost" size="sm" onClick={onTestPlatform} disabled={!canManagePlatform || platformPending} title={canManagePlatform ? undefined : 'Missing permission platform:settings:manage'}>
              Test Platform Role Mappings
            </Button>
          )}
          {canReadGroups && (
            <Button kind="ghost" size="sm" onClick={onTestGroups} disabled={!canManageGroups || groupPending} title={canManageGroups ? undefined : 'Missing permission platform:sso-assignments:manage'}>
              Test Group Mappings
            </Button>
          )}
        </div>
        {platformTestResult && (
          <InlineNotification
            kind="info"
            title={`Platform role preview: ${platformRoleLabel(platformTestResult.resolvedRole)}`}
            subtitle={`${platformTestResult.matchedMappings.length} mapping${platformTestResult.matchedMappings.length === 1 ? '' : 's'} matched.`}
            lowContrast
          />
        )}
        {groupTestResult && (
          <InlineNotification
            kind="info"
            title={`${groupTestResult.memberships.length} group membership${groupTestResult.memberships.length === 1 ? '' : 's'} would sync`}
            subtitle={`${groupTestResult.matchedMappings.length} mapping${groupTestResult.matchedMappings.length === 1 ? '' : 's'} matched.`}
            lowContrast
          />
        )}
      </div>

      {canReadPlatform && (
        <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
          <div>
            <h3 style={{ margin: 0 }}>Platform role mappings</h3>
            <p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>
              Legacy SSO claim mappings that provision platform admin or standard user roles.
            </p>
          </div>
          {platformLoading ? (
            <DataTableSkeleton headers={ssoPlatformMappingHeaders} rowCount={4} />
          ) : (
            <TableContainer>
              <DataTable
                rows={platformMappings.map((mapping) => ({
                  id: mapping.id,
                  provider: providerLabel(mapping.providerId),
                  claim: ssoClaimLabel(mapping),
                  targetRole: mapping.targetRole,
                  priority: mapping.priority,
                  status: mapping.isActive,
                  actions: '',
                }))}
                headers={ssoPlatformMappingHeaders}
              >
                {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                  <>
                    <TableToolbar>
                      <TableToolbarContent>
                        <Button kind="primary" renderIcon={Add} onClick={onCreatePlatform} disabled={!canManagePlatform} title={canManagePlatform ? undefined : 'Missing permission platform:settings:manage'}>
                          Add Platform Mapping
                        </Button>
                      </TableToolbarContent>
                    </TableToolbar>
                    <Table {...getTableProps()} size="md">
                      <TableHead>
                        <TableRow>
                          {headers.map((header) => (
                            <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {rows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={headers.length}>No platform role SSO mappings configured.</TableCell>
                          </TableRow>
                        ) : rows.map((row) => {
                          const mapping = platformMappings.find((item) => item.id === row.id);
                          return (
                            <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                              {row.cells.map((cell) => {
                                if (cell.info.header === 'targetRole') {
                                  return <TableCell key={cell.id}><Tag type={cell.value === 'admin' ? 'red' : 'gray'}>{platformRoleLabel(String(cell.value))}</Tag></TableCell>;
                                }
                                if (cell.info.header === 'status') {
                                  return <TableCell key={cell.id}><Tag type={cell.value ? 'green' : 'gray'}>{cell.value ? 'Active' : 'Inactive'}</Tag></TableCell>;
                                }
                                if (cell.info.header === 'actions') {
                                  return (
                                    <TableCell key={cell.id}>
                                      <Button kind="ghost" size="sm" disabled={!canManagePlatform} title={canManagePlatform ? undefined : 'Missing permission platform:settings:manage'} onClick={() => mapping && onEditPlatform(mapping)}>Edit</Button>
                                      <Button kind="ghost" size="sm" disabled={!canManagePlatform} title={canManagePlatform ? undefined : 'Missing permission platform:settings:manage'} renderIcon={TrashCan} hasIconOnly iconDescription="Delete platform mapping" onClick={() => mapping && onDeletePlatform(mapping.id)} />
                                    </TableCell>
                                  );
                                }
                                return <TableCell key={cell.id}>{cell.value}</TableCell>;
                              })}
                            </DataTableDataRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </>
                )}
              </DataTable>
            </TableContainer>
          )}
        </div>
      )}

      {canReadGroups && (
        <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
          <div>
            <h3 style={{ margin: 0 }}>Group mappings</h3>
            <p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>
              Preferred SSO mappings that sync claims into internal authorization groups.
            </p>
          </div>
          {activeGroups.length === 0 && (
            <InlineNotification
              kind="warning"
              title="No active target groups"
              subtitle="Create an authorization group before adding SSO group mappings."
              lowContrast
            />
          )}
          {groupLoading ? (
            <DataTableSkeleton headers={ssoGroupMappingHeaders} rowCount={4} />
          ) : (
            <TableContainer>
              <DataTable
                rows={groupMappings.map((mapping) => ({
                  id: mapping.id,
                  provider: providerLabel(mapping.providerId),
                  claim: ssoClaimLabel(mapping),
                  targetGroup: mapping.targetGroupName || mapping.targetGroupKey || mapping.targetGroupId,
                  mode: mapping.syncMode,
                  priority: mapping.priority,
                  status: mapping.isActive,
                  actions: '',
                }))}
                headers={ssoGroupMappingHeaders}
              >
                {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                  <>
                    <TableToolbar>
                      <TableToolbarContent>
                        <Button kind="primary" renderIcon={Add} onClick={onCreateGroup} disabled={!canManageGroups || activeGroups.length === 0} title={canManageGroups ? undefined : 'Missing permission platform:sso-assignments:manage'}>
                          Add Group Mapping
                        </Button>
                      </TableToolbarContent>
                    </TableToolbar>
                    <Table {...getTableProps()} size="md">
                      <TableHead>
                        <TableRow>
                          {headers.map((header) => (
                            <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {rows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={headers.length}>No SSO group mappings configured.</TableCell>
                          </TableRow>
                        ) : rows.map((row) => {
                          const mapping = groupMappings.find((item) => item.id === row.id);
                          return (
                            <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                              {row.cells.map((cell) => {
                                if (cell.info.header === 'mode') {
                                  return <TableCell key={cell.id}><Tag type={cell.value === 'authoritative' ? 'blue' : 'cyan'}>{cell.value}</Tag></TableCell>;
                                }
                                if (cell.info.header === 'status') {
                                  return <TableCell key={cell.id}><Tag type={cell.value ? 'green' : 'gray'}>{cell.value ? 'Active' : 'Inactive'}</Tag></TableCell>;
                                }
                                if (cell.info.header === 'actions') {
                                  return (
                                    <TableCell key={cell.id}>
                                      <Button kind="ghost" size="sm" disabled={!canManageGroups} title={canManageGroups ? undefined : 'Missing permission platform:sso-assignments:manage'} onClick={() => mapping && onEditGroup(mapping)}>Edit</Button>
                                      <Button kind="ghost" size="sm" disabled={!canManageGroups} title={canManageGroups ? undefined : 'Missing permission platform:sso-assignments:manage'} renderIcon={TrashCan} hasIconOnly iconDescription="Delete group mapping" onClick={() => mapping && onDeleteGroup(mapping.id)} />
                                    </TableCell>
                                  );
                                }
                                return <TableCell key={cell.id}>{cell.value}</TableCell>;
                              })}
                            </DataTableDataRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </>
                )}
              </DataTable>
            </TableContainer>
          )}
        </div>
      )}
    </div>
  );
}

function GroupsPanel({
  groups,
  memberships,
  loading,
  membershipsLoading,
  pending,
  selectedGroupId,
  canManage,
  onSelectGroup,
  onCreate,
  onEdit,
  onArchive,
  onAddMembership,
  onRemoveMembership,
}: {
  groups: AuthzGroup[];
  memberships: AuthzGroupMembership[];
  loading: boolean;
  membershipsLoading: boolean;
  pending: boolean;
  selectedGroupId: string;
  canManage: boolean;
  onSelectGroup: (id: string) => void;
  onCreate: () => void;
  onEdit: (group: AuthzGroup) => void;
  onArchive: (id: string) => void;
  onAddMembership: (userId: string) => void;
  onRemoveMembership: (id: string) => void;
}) {
  const [memberUserId, setMemberUserId] = React.useState('');
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) || groups.find((group) => !group.isArchived) || groups[0] || null;
  const selectedMemberships = selectedGroup ? memberships.filter((membership) => membership.groupId === selectedGroup.id) : [];
  const canManageSelectedGroup = Boolean(selectedGroup && isEditableGroup(selectedGroup) && !selectedGroup.isArchived && canManage);
  const selectedGroupUnavailableReason = !canManage
    ? 'Missing permission platform:authz:roles:manage'
    : selectedGroup && !isEditableGroup(selectedGroup)
      ? selectedGroup?.source === 'config' && selectedGroup.ownershipMode === 'config_locked'
        ? 'This group is locked by its configuration bundle'
        : 'Source-owned groups are managed by their source'
      : selectedGroup?.isArchived
        ? 'Archived groups cannot be changed'
        : undefined;

  if (loading) return <DataTableSkeleton headers={authzGroupHeaders} rowCount={4} />;

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
      <TableContainer>
        <DataTable
          rows={groups.map((group) => ({
            id: group.id,
            name: group.name,
            key: group.key,
            source: group.isSystem ? 'system' : group.source,
            members: memberships.filter((membership) => membership.groupId === group.id).length,
            status: group.isArchived ? 'Archived' : 'Active',
            actions: '',
          }))}
          headers={authzGroupHeaders}
        >
          {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
            <>
              <TableToolbar>
                <TableToolbarContent>
                  <Button kind="primary" renderIcon={Add} onClick={onCreate} disabled={!canManage} title={canManage ? undefined : 'Missing permission platform:authz:roles:manage'}>
                    Create Group
                  </Button>
                </TableToolbarContent>
              </TableToolbar>
              <Table {...getTableProps()} size="md">
                <TableHead>
                  <TableRow>
                    {headers.map((header) => (
                      <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={headers.length}>No authorization groups are configured.</TableCell>
                    </TableRow>
                  ) : rows.map((row) => {
                    const group = groups.find((item) => item.id === row.id);
                    const editable = group ? isEditableGroup(group) : false;
                    const rowUnavailableReason = !canManage
                      ? 'Missing permission platform:authz:roles:manage'
                      : !editable
                        ? group?.source === 'config' && group.ownershipMode === 'config_locked'
                          ? 'This group is locked by its configuration bundle'
                          : 'Source-owned groups are managed by their source'
                        : group?.isArchived
                          ? 'Archived groups cannot be changed'
                          : undefined;
                    return (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'source') {
                            return <TableCell key={cell.id}><div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}><Tag type={group?.source === 'config' && group.ownershipMode === 'config_warn' ? 'warm-gray' : authzSourceTagType(cell.value)}>{group?.source === 'config' && group.ownershipMode === 'config_warn' ? 'Config warning' : formatAuthzSource(cell.value)}</Tag>{group?.driftStatus === 'drifted' && <Tag type="red">Drifted</Tag>}</div></TableCell>;
                          }
                          if (cell.info.header === 'status') {
                            return <TableCell key={cell.id}><Tag type={cell.value === 'Active' ? 'green' : 'gray'}>{cell.value}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {group && (
                                  <>
                                    <Button kind="ghost" size="sm" onClick={() => onSelectGroup(group.id)}>Members</Button>
                                    <Button kind="ghost" size="sm" disabled={pending || Boolean(rowUnavailableReason)} title={rowUnavailableReason} onClick={() => onEdit(group)}>Edit</Button>
                                    {!group.isArchived && (
                                      <Button kind="ghost" size="sm" disabled={pending || Boolean(rowUnavailableReason)} title={rowUnavailableReason} renderIcon={TrashCan} onClick={() => onArchive(group.id)}>Archive</Button>
                                    )}
                                  </>
                                )}
                              </TableCell>
                            );
                          }
                          return <TableCell key={cell.id}>{cell.value}</TableCell>;
                        })}
                      </DataTableDataRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </DataTable>
      </TableContainer>

      {selectedGroup ? (
        <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
          <h3 style={{ margin: 0 }}>{selectedGroup.name} members</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) auto', gap: 'var(--spacing-4)', alignItems: 'end' }}>
            <TextInput
              id="group-member-user-id"
              labelText="User ID"
              value={memberUserId}
              disabled={!canManageSelectedGroup || pending}
              onChange={(event) => setMemberUserId(event.target.value)}
            />
            <Button
              disabled={!memberUserId.trim() || !canManageSelectedGroup || pending}
              title={selectedGroupUnavailableReason}
              onClick={() => {
                onAddMembership(memberUserId.trim());
                setMemberUserId('');
              }}
            >
              Add Member
            </Button>
          </div>
          {membershipsLoading ? (
            <DataTableSkeleton headers={authzGroupMembershipHeaders} rowCount={3} />
          ) : (
            <TableContainer>
              <DataTable
                rows={selectedMemberships.map((membership) => ({
                  id: membership.id,
                  userId: membership.userId,
                  source: membership.source,
                  expires: membership.expiresAt ? new Date(membership.expiresAt).toLocaleString() : 'Never',
                  created: new Date(membership.createdAt).toLocaleString(),
                  actions: '',
                }))}
                headers={authzGroupMembershipHeaders}
              >
                {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                  <Table {...getTableProps()} size="md">
                    <TableHead>
                      <TableRow>
                        {headers.map((header) => (
                          <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={headers.length}>No users are assigned to this group.</TableCell>
                        </TableRow>
                      ) : rows.map((row) => {
                        const membership = selectedMemberships.find((item) => item.id === row.id);
                        const canRemove = canManageSelectedGroup && membership?.source === 'manual';
                        return (
                          <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                            {row.cells.map((cell) => {
                              if (cell.info.header === 'source') {
                                return <TableCell key={cell.id}><Tag type={authzSourceTagType(cell.value)}>{formatAuthzSource(cell.value)}</Tag></TableCell>;
                              }
                              if (cell.info.header === 'actions') {
                                return (
                                  <TableCell key={cell.id}>
                                    {membership && (
                                      <Button
                                        kind="ghost"
                                        size="sm"
                                        renderIcon={TrashCan}
                                        hasIconOnly
                                        iconDescription="Remove group member"
                                        disabled={pending || !canRemove}
                                        title={canRemove ? undefined : membership.source === 'manual' ? selectedGroupUnavailableReason : 'Source-managed memberships are updated by their source'}
                                        onClick={() => onRemoveMembership(membership.id)}
                                      />
                                    )}
                                  </TableCell>
                                );
                              }
                              return <TableCell key={cell.id}>{cell.value}</TableCell>;
                            })}
                          </DataTableDataRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </DataTable>
            </TableContainer>
          )}
        </div>
      ) : (
        <InlineNotification kind="info" title="Create a group before adding members" lowContrast />
      )}
    </div>
  );
}

function RuntimeResourcesPanel({
  engines,
  selectedEngineId,
  resources,
  loading,
  error,
  canManage,
  reconcilePending,
  reconcileError,
  reconcileResult,
  onSelectEngine,
  onReconcile,
}: {
  engines: RuntimeResourceEngineOption[];
  selectedEngineId: string;
  resources: RuntimeResourceInventoryRow[];
  loading: boolean;
  error: unknown;
  canManage: boolean;
  reconcilePending: boolean;
  reconcileError: unknown;
  reconcileResult: { created: number; updated: number; deactivated: number; materializedSets: number; deployments: { created: number; updated: number; artifactsCreated: number } } | undefined;
  onSelectEngine: (id: string) => void;
  onReconcile: () => void;
}) {
  const selectedEngine = engines.find((engine) => engine.id === selectedEngineId) || null;
  const processCount = resources.filter((resource) => resource.resourceKind === 'process_definition').length;
  const decisionCount = resources.filter((resource) => resource.resourceKind === 'decision_definition').length;

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
      <div>
        <h3 style={{ margin: 0 }}>Runtime Resources</h3>
        <p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>
          Sanitized process and decision inventory for resource-aware central engines. Inventory supports authorization decisions; it is not a copy of engine payload data.
        </p>
      </div>
      <div style={{ display: 'flex', gap: 'var(--spacing-4)', alignItems: 'end', flexWrap: 'wrap' }}>
        <Dropdown
          id="runtime-resource-engine"
          titleText="Engine"
          label="Select an engine"
          items={engines}
          selectedItem={selectedEngine}
          itemToString={(item) => item?.name || ''}
          onChange={({ selectedItem }) => onSelectEngine(selectedItem?.id || '')}
          style={{ minWidth: 280 }}
        />
        <Button kind="secondary" size="sm" disabled={!selectedEngineId || !canManage || reconcilePending} onClick={onReconcile}>
          Reconcile inventory
        </Button>
        {selectedEngine && <Tag type="cool-gray">{processCount} processes</Tag>}
        {selectedEngine && <Tag type="cool-gray">{decisionCount} decisions</Tag>}
      </div>
      {Boolean(reconcileError) && <InlineNotification kind="error" lowContrast title="Runtime inventory could not be reconciled" subtitle={parseApiError(reconcileError, 'Request failed').message} hideCloseButton />}
      {reconcileResult && !reconcileError && <InlineNotification kind="success" lowContrast title="Inventory reconciled" subtitle={`${reconcileResult.created + reconcileResult.updated} runtime resources refreshed, ${reconcileResult.deactivated} deactivated; ${reconcileResult.deployments.created + reconcileResult.deployments.updated} deployment records and ${reconcileResult.deployments.artifactsCreated} artifacts reconciled.`} hideCloseButton />}
      {loading ? <DataTableSkeleton headers={[{ key: 'key', header: 'Resource' }]} rowCount={6} /> : error ? (
        <InlineNotification kind="error" lowContrast title="Runtime resources could not be loaded" subtitle={parseApiError(error, 'Request failed').message} hideCloseButton />
      ) : !selectedEngine ? (
        <InlineNotification kind="info" lowContrast title="Select an engine" subtitle="Choose an engine to inspect its runtime resource inventory." hideCloseButton />
      ) : resources.length === 0 ? (
        <InlineNotification kind="info" lowContrast title="No runtime resources recorded" subtitle="Reconcile inventory after the engine is reachable or a deployment receipt has been received." hideCloseButton />
      ) : (
        <TableContainer>
          <Table size="md">
            <TableHead><TableRow>
              <TableHeader>Resource</TableHeader><TableHeader>Kind</TableHeader><TableHeader>Runtime tenant</TableHeader><TableHeader>Project</TableHeader><TableHeader>Source</TableHeader><TableHeader>Observed</TableHeader>
            </TableRow></TableHead>
            <TableBody>{resources.map((resource) => (
              <TableRow key={resource.id}>
                <TableCell style={{ overflowWrap: 'anywhere' }}>{resource.resourceKey}</TableCell>
                <TableCell><Tag type={resource.resourceKind === 'process_definition' ? 'blue' : 'purple'} size="sm">{resource.resourceKind === 'process_definition' ? 'Process' : 'Decision'}</Tag></TableCell>
                <TableCell>{resource.runtimeTenantId || '-'}</TableCell>
                <TableCell>{resource.projectId || '-'}</TableCell>
                <TableCell>{resource.source}</TableCell>
                <TableCell>{new Date(resource.observedAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </TableContainer>
      )}
    </div>
  );
}

function EngineSetsPanel({
  engineSets,
  selectedEngineSet,
  assignments,
  apiClients,
  groups,
  serviceAccounts,
  auditEntries,
  loading,
  detailLoading,
  assignmentLoading,
  auditLoading,
  materializeSummary,
  onCreate,
  onEdit,
  onArchive,
  onMaterialize,
  onSelect,
  pending,
  canManage,
  canReadAssignments,
  canReadAudit,
  manageUnavailableReason,
  assignmentsReadUnavailableReason,
  auditReadUnavailableReason,
}: {
  engineSets: EngineSetSummary[];
  selectedEngineSet: EngineSetDetail | null;
  assignments: RoleAssignment[];
  apiClients: ApiClient[];
  groups: AuthzGroup[];
  serviceAccounts: ServiceAccount[];
  auditEntries: AuthzAuditEntry[];
  loading: boolean;
  detailLoading: boolean;
  assignmentLoading: boolean;
  auditLoading: boolean;
  materializeSummary: string | null;
  onCreate: () => void;
  onEdit: (engineSet: EngineSetSummary) => void;
  onArchive: (id: string) => void;
  onMaterialize: (id: string) => void;
  onSelect: (id: string) => void;
  pending: boolean;
  canManage: boolean;
  canReadAssignments: boolean;
  canReadAudit: boolean;
  manageUnavailableReason?: string;
  assignmentsReadUnavailableReason?: string;
  auditReadUnavailableReason?: string;
}) {
  if (loading) return <DataTableSkeleton headers={engineSetHeaders} rowCount={4} />;
  const selectedEngineSetMaterializations = selectedEngineSet?.materializations || [];
  const selectedAssignments = selectedEngineSet
    ? assignments.filter((assignment) => assignmentScopeMatches(assignment, 'engine_set', selectedEngineSet.id))
    : [];

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
      {materializeSummary && (
        <InlineNotification kind="info" title="Engine Set materialized" subtitle={materializeSummary} lowContrast />
      )}
      <TableContainer>
        <DataTable
          rows={engineSets.map((engineSet) => ({
            id: engineSet.id,
            name: engineSet.name,
            key: engineSet.key,
            selector: formatEngineSetSelector(engineSet.selector),
            engines: engineSet.materializedEngineCount,
            source: engineSet.source,
            status: engineSet.isArchived ? 'Archived' : engineSet.materializationStatus || 'Active',
            materialized: engineSet.lastMaterializedAt ? new Date(engineSet.lastMaterializedAt).toLocaleString() : 'Never',
            actions: '',
          }))}
          headers={engineSetHeaders}
        >
          {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
            <>
              <TableToolbar>
                <TableToolbarContent>
                  <Button kind="primary" renderIcon={Add} onClick={onCreate} disabled={!canManage} title={manageUnavailableReason}>
                    Create Engine Set
                  </Button>
                </TableToolbarContent>
              </TableToolbar>
              <Table {...getTableProps()} size="md">
                <TableHead>
                  <TableRow>
                    {headers.map((header) => (
                      <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={headers.length}>No Engine Sets are defined yet.</TableCell>
                    </TableRow>
                  ) : rows.map((row) => {
                    const engineSet = engineSets.find((item) => item.id === row.id);
                    const sourceOwned = engineSet ? isSourceOwnedEngineSet(engineSet) : false;
                    const rowManageUnavailableReason = !canManage
                      ? manageUnavailableReason
                      : sourceOwned && engineSet
                        ? engineSetSourceOwnershipReason(engineSet)
                        : undefined;
                    return (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'source') {
                            return <TableCell key={cell.id}><div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}><Tag type={engineSet?.source === 'config' && engineSet.ownershipMode === 'config_warn' ? 'warm-gray' : engineSet?.source === 'config' ? 'purple' : sourceOwned ? 'cyan' : 'gray'}>{engineSet?.source === 'config' && engineSet.ownershipMode === 'config_warn' ? 'Config warning' : engineSet?.source === 'config' ? 'Managed by config' : cell.value}</Tag>{engineSet?.driftStatus === 'drifted' && <Tag type="red">Drifted</Tag>}</div></TableCell>;
                          }
                          if (cell.info.header === 'status') {
                            const status = String(cell.value);
                            const type = status === 'Archived' ? 'gray' : status === 'failed' ? 'red' : 'green';
                            return <TableCell key={cell.id}><Tag type={type}>{status}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {engineSet && (
                                  <>
                                    <Button kind="ghost" size="sm" onClick={() => onSelect(engineSet.id)}>Details</Button>
                                    <Button kind="ghost" size="sm" disabled={pending || Boolean(rowManageUnavailableReason)} title={rowManageUnavailableReason} onClick={() => onEdit(engineSet)}>Edit</Button>
                                    <Button kind="ghost" size="sm" disabled={pending || !canManage || engineSet.isArchived} title={!canManage ? manageUnavailableReason : engineSet.isArchived ? 'Archived Engine Sets cannot be materialized' : undefined} onClick={() => onMaterialize(engineSet.id)}>Materialize</Button>
                                    {!engineSet.isArchived && (
                                      <Button kind="ghost" size="sm" disabled={pending || Boolean(rowManageUnavailableReason)} title={rowManageUnavailableReason} renderIcon={TrashCan} onClick={() => onArchive(engineSet.id)}>Archive</Button>
                                    )}
                                  </>
                                )}
                              </TableCell>
                            );
                          }
                          return <TableCell key={cell.id}>{cell.value}</TableCell>;
                        })}
                      </DataTableDataRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </DataTable>
      </TableContainer>

      {detailLoading ? (
        <DataTableSkeleton headers={engineSetMaterializationHeaders} rowCount={3} />
      ) : selectedEngineSet ? (
        <>
          <TableContainer title={`${selectedEngineSet.name} materializations`}>
            <DataTable
              rows={selectedEngineSetMaterializations.map((materialization) => ({
                id: materialization.id,
                engine: materialization.engineName || materialization.engineId,
                source: materialization.source,
                matched: formatEngineSetMatchedBy(materialization.matchedBy),
                seen: new Date(materialization.lastSeenAt).toLocaleString(),
              }))}
              headers={engineSetMaterializationHeaders}
            >
              {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                <Table {...getTableProps()} size="md">
                  <TableHead>
                    <TableRow>
                      {headers.map((header) => (
                        <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={headers.length}>No engines are currently materialized for this Engine Set.</TableCell>
                      </TableRow>
                    ) : rows.map((row) => (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => (
                          <TableCell key={cell.id}>{cell.value}</TableCell>
                        ))}
                      </DataTableDataRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </DataTable>
          </TableContainer>

          {canReadAssignments ? (
            assignmentLoading ? (
              <DataTableSkeleton headers={engineSetAssignmentUsageHeaders} rowCount={3} />
            ) : (
              <TableContainer title={`${selectedEngineSet.name} assignment usage`}>
                <DataTable
                  rows={selectedAssignments.map((assignment) => ({
                    id: assignment.id,
                    principal: formatAssignmentPrincipal(assignment, apiClients, groups, serviceAccounts),
                    role: assignment.roleName || assignment.roleId,
                    source: assignment.source,
                    created: new Date(assignment.createdAt).toLocaleString(),
                  }))}
                  headers={engineSetAssignmentUsageHeaders}
                >
                  {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                    <Table {...getTableProps()} size="md">
                      <TableHead>
                        <TableRow>
                          {headers.map((header) => (
                            <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {rows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={headers.length}>No role assignments target this Engine Set.</TableCell>
                          </TableRow>
                        ) : rows.map((row) => (
                          <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                            {row.cells.map((cell) => {
                              if (cell.info.header === 'source') {
                                return <TableCell key={cell.id}><Tag type={authzSourceTagType(cell.value)}>{formatAuthzSource(cell.value)}</Tag></TableCell>;
                              }
                              return <TableCell key={cell.id}>{cell.value}</TableCell>;
                            })}
                          </DataTableDataRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </DataTable>
              </TableContainer>
            )
          ) : (
            <InlineNotification kind="info" title="Assignment usage hidden" subtitle={assignmentsReadUnavailableReason || 'Missing permission platform:authz:roles:view'} lowContrast />
          )}

          {canReadAudit ? (
            auditLoading ? (
              <DataTableSkeleton headers={engineSetAuditPreviewHeaders} rowCount={3} />
            ) : (
              <TableContainer title={`${selectedEngineSet.name} authorization audit`}>
                <DataTable
                  rows={auditEntries.map((entry) => ({
                    id: entry.id,
                    timestamp: formatTimestamp(entry.timestamp),
                    decision: entry.decision,
                    action: entry.action,
                    user: entry.userId,
                    reason: entry.reason || '-',
                  }))}
                  headers={engineSetAuditPreviewHeaders}
                >
                  {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                    <Table {...getTableProps()} size="md">
                      <TableHead>
                        <TableRow>
                          {headers.map((header) => (
                            <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {rows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={headers.length}>No authorization audit events reference this Engine Set.</TableCell>
                          </TableRow>
                        ) : rows.map((row) => (
                          <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                            {row.cells.map((cell) => {
                              if (cell.info.header === 'decision') {
                                return <TableCell key={cell.id}><Tag type={cell.value === 'allow' ? 'green' : 'red'}>{cell.value === 'allow' ? 'Allow' : 'Deny'}</Tag></TableCell>;
                              }
                              if (cell.info.header === 'action') {
                                return <TableCell key={cell.id}><code>{cell.value}</code></TableCell>;
                              }
                              return <TableCell key={cell.id}>{cell.value}</TableCell>;
                            })}
                          </DataTableDataRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </DataTable>
              </TableContainer>
            )
          ) : (
            <InlineNotification kind="info" title="Authorization audit hidden" subtitle={auditReadUnavailableReason || 'Missing permission platform:audit:view'} lowContrast />
          )}
        </>
      ) : (
        <InlineNotification kind="info" title="Select an Engine Set to inspect materialized engines and selector lineage" lowContrast />
      )}
    </div>
  );
}

function ProjectEngineTargetsPanel({
  targets,
  loading,
  pending,
  syncSummary,
  eligibilityResult,
  onCreate,
  onEdit,
  onArchive,
  onSyncLegacy,
  onEvaluate,
  canManage,
  canEvaluate,
  manageUnavailableReason,
  evaluateUnavailableReason,
  externalProjectTargetApiUpsertDecision,
  externalProjectTargetApiDecommissionDecision,
}: {
  targets: ProjectEngineTarget[];
  loading: boolean;
  pending: boolean;
  syncSummary: string | null;
  eligibilityResult: DeploymentEligibilityResult | null;
  onCreate: () => void;
  onEdit: (target: ProjectEngineTarget) => void;
  onArchive: (id: string) => void;
  onSyncLegacy: (projectId: string) => void;
  onEvaluate: (form: { userId: string; projectId: string; engineId: string; mode: ProjectEngineTargetMode }) => void;
  canManage: boolean;
  canEvaluate: boolean;
  manageUnavailableReason?: string;
  evaluateUnavailableReason?: string;
  externalProjectTargetApiUpsertDecision: UiAuthzDecision;
  externalProjectTargetApiDecommissionDecision: UiAuthzDecision;
}) {
  const [projectFilter, setProjectFilter] = React.useState('');
  const [engineFilter, setEngineFilter] = React.useState('');
  const [syncProjectId, setSyncProjectId] = React.useState('');
  const [evaluateForm, setEvaluateForm] = React.useState({
    userId: '',
    projectId: '',
    engineId: '',
    mode: 'manual' as ProjectEngineTargetMode,
  });
  const selectedEvaluateMode = PROJECT_ENGINE_TARGET_MODES.find((item) => item.id === evaluateForm.mode) || PROJECT_ENGINE_TARGET_MODES[0];
  const filteredTargets = React.useMemo(() => targets.filter((target) => {
    const matchesProject = !projectFilter.trim() || target.projectId.toLowerCase().includes(projectFilter.trim().toLowerCase()) || (target.projectName || '').toLowerCase().includes(projectFilter.trim().toLowerCase());
    const matchesEngine = !engineFilter.trim() || target.engineId.toLowerCase().includes(engineFilter.trim().toLowerCase()) || (target.engineName || '').toLowerCase().includes(engineFilter.trim().toLowerCase());
    return matchesProject && matchesEngine;
  }), [engineFilter, projectFilter, targets]);

  if (loading) return <DataTableSkeleton headers={projectEngineTargetHeaders} rowCount={5} />;

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
      <div aria-label="Project target API diagnostics" style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
        <h3 style={{ margin: 0 }}>Project target API diagnostics</h3>
        <div style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <Tag
            type={externalProjectTargetApiUpsertDecision.allowed ? 'green' : 'red'}
            title={externalProjectTargetApiUpsertDecision.reason}
          >
            External API target registration {externalProjectTargetApiUpsertDecision.allowed ? 'allowed' : 'blocked'}
          </Tag>
          <Tag
            type={externalProjectTargetApiDecommissionDecision.allowed ? 'green' : 'red'}
            title={externalProjectTargetApiDecommissionDecision.reason}
          >
            External API target decommission {externalProjectTargetApiDecommissionDecision.allowed ? 'allowed' : 'blocked'}
          </Tag>
        </div>
      </div>
      {syncSummary && (
        <InlineNotification kind="info" title="Legacy project targets synced" subtitle={syncSummary} lowContrast />
      )}
      {eligibilityResult && (
        <InlineNotification
          kind={eligibilityResult.allowed ? 'success' : 'warning'}
          title={eligibilityResult.allowed ? 'Deployment eligibility allowed' : 'Deployment eligibility denied'}
          subtitle={formatDeploymentEligibility(eligibilityResult)}
          lowContrast
        />
      )}
      <TableContainer>
        <DataTable
          rows={filteredTargets.map((target) => ({
            id: target.id,
            project: target.projectName || target.projectId,
            engine: target.engineName || target.engineId,
            environment: target.environment?.name || '-',
            status: target.status,
            source: target.source,
            modes: formatProjectEngineTargetModes(target),
            approval: formatStatusLabel(target.approvalStatus),
            external: formatProjectEngineTargetExternalRefs(target),
            diagnostics: formatProjectEngineTargetDiagnostics(target),
            actions: '',
          }))}
          headers={projectEngineTargetHeaders}
        >
          {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
            <>
              <TableToolbar>
                <TableToolbarContent>
                  <TableToolbarSearch persistent placeholder="Filter projects" value={projectFilter} onChange={(event: any) => setProjectFilter(event.target.value)} />
                  <TextInput id="target-engine-filter" labelText="Filter engines" value={engineFilter} onChange={(event) => setEngineFilter(event.target.value)} />
                  <Button kind="primary" renderIcon={Add} onClick={onCreate} disabled={!canManage} title={manageUnavailableReason}>
                    Create Target
                  </Button>
                </TableToolbarContent>
              </TableToolbar>
              <Table {...getTableProps()} size="md">
                <TableHead>
                  <TableRow>
                    {headers.map((header) => (
                      <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={headers.length}>No project-engine targets match the current filters.</TableCell>
                    </TableRow>
                  ) : rows.map((row) => {
                    const target = filteredTargets.find((item) => item.id === row.id);
                    const sourceOwned = target ? isSourceOwnedProjectTarget(target) : false;
                    const rowManageUnavailableReason = !canManage
                      ? manageUnavailableReason
                      : sourceOwned
                        ? 'Source-owned targets are managed by their external source'
                        : undefined;
                    return (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'status') {
                            const status = String(cell.value);
                            const type = status === 'active' ? 'green' : status === 'disabled' ? 'gray' : 'red';
                            return <TableCell key={cell.id}><Tag type={type}>{formatStatusLabel(status)}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'source') {
                            return <TableCell key={cell.id}><div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}><Tag type={target?.source === 'config' && target.ownershipMode === 'config_warn' ? 'warm-gray' : sourceOwned ? 'cyan' : 'gray'}>{target?.source === 'config' && target.ownershipMode === 'config_warn' ? 'Config warning' : cell.value}</Tag>{target?.driftStatus === 'drifted' && <Tag type="red">Drifted</Tag>}</div></TableCell>;
                          }
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {target && (
                                  <>
                                    <Button kind="ghost" size="sm" disabled={pending || Boolean(rowManageUnavailableReason)} title={rowManageUnavailableReason} onClick={() => onEdit(target)}>Edit</Button>
                                    {target.status !== 'archived' && (
                                      <Button kind="ghost" size="sm" disabled={pending || Boolean(rowManageUnavailableReason)} title={rowManageUnavailableReason} renderIcon={TrashCan} onClick={() => onArchive(target.id)}>Archive</Button>
                                    )}
                                  </>
                                )}
                              </TableCell>
                            );
                          }
                          return <TableCell key={cell.id}>{cell.value}</TableCell>;
                        })}
                      </DataTableDataRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </DataTable>
      </TableContainer>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-4)', alignItems: 'end' }}>
        <TextInput
          id="target-sync-project-id"
          labelText="Project ID to sync"
          value={syncProjectId}
          onChange={(event) => setSyncProjectId(event.target.value)}
        />
        <Button disabled={!syncProjectId.trim() || pending || !canManage} title={manageUnavailableReason} onClick={() => onSyncLegacy(syncProjectId.trim())}>
          Sync Legacy Targets
        </Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-4)', alignItems: 'end' }}>
        <TextInput id="target-evaluate-user-id" labelText="User ID" value={evaluateForm.userId} onChange={(event) => setEvaluateForm((current) => ({ ...current, userId: event.target.value }))} />
        <TextInput id="target-evaluate-project-id" labelText="Project ID" value={evaluateForm.projectId} onChange={(event) => setEvaluateForm((current) => ({ ...current, projectId: event.target.value }))} />
        <TextInput id="target-evaluate-engine-id" labelText="Engine ID" value={evaluateForm.engineId} onChange={(event) => setEvaluateForm((current) => ({ ...current, engineId: event.target.value }))} />
        <Dropdown
          id="target-evaluate-mode"
          titleText="Mode"
          label="Mode"
          items={PROJECT_ENGINE_TARGET_MODES}
          itemToString={(item) => item?.label || ''}
          selectedItem={selectedEvaluateMode}
          onChange={({ selectedItem }) => setEvaluateForm((current) => ({ ...current, mode: (selectedItem?.id || 'manual') as ProjectEngineTargetMode }))}
        />
        <Button
          disabled={!canEvaluate || pending || !evaluateForm.userId.trim() || !evaluateForm.projectId.trim() || !evaluateForm.engineId.trim()}
          title={evaluateUnavailableReason}
          onClick={() => onEvaluate({
            userId: evaluateForm.userId.trim(),
            projectId: evaluateForm.projectId.trim(),
            engineId: evaluateForm.engineId.trim(),
            mode: evaluateForm.mode,
          })}
        >
          Evaluate Eligibility
        </Button>
      </div>
    </div>
  );
}

function PoliciesPanel({
  policies,
  loading,
  pending,
  canManage,
  manageUnavailableReason,
  onCreate,
  onEdit,
  onToggle,
  onDelete,
}: {
  policies: AuthzPolicy[];
  loading: boolean;
  pending: boolean;
  canManage: boolean;
  manageUnavailableReason?: string;
  onCreate: () => void;
  onEdit: (policy: AuthzPolicy) => void;
  onToggle: (policy: AuthzPolicy) => void;
  onDelete: (id: string) => void;
}) {
  if (loading) return <DataTableSkeleton headers={authzPolicyHeaders} rowCount={5} />;

  return (
    <TableContainer>
      <DataTable
        rows={policies.map((policy) => ({
          id: policy.id,
          name: policy.name,
          effect: policy.effect,
          resourceType: policy.resourceType || 'All resources',
          action: policy.action || 'All actions',
          priority: policy.priority,
          conditions: formatPolicyConditions(policy.conditions),
          status: policy.isActive,
          actions: '',
        }))}
        headers={authzPolicyHeaders}
      >
        {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
          <>
            <TableToolbar>
              <TableToolbarContent>
                <Button
                  kind="primary"
                  renderIcon={Add}
                  onClick={onCreate}
                  disabled={!canManage}
                  title={manageUnavailableReason}
                >
                  Add Policy
                </Button>
              </TableToolbarContent>
            </TableToolbar>
            <Table {...getTableProps()} size="md">
              <TableHead>
                <TableRow>
                  {headers.map((header) => (
                    <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={headers.length}>No authorization policies are configured.</TableCell>
                  </TableRow>
                ) : rows.map((row) => {
                  const policy = policies.find((item) => item.id === row.id);
                  return (
                    <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                      {row.cells.map((cell) => {
                        if (cell.info.header === 'effect') {
                          return (
                            <TableCell key={cell.id}>
                              <Tag type={cell.value === 'deny' ? 'red' : 'green'}>{cell.value === 'deny' ? 'Deny' : 'Allow'}</Tag>
                            </TableCell>
                          );
                        }
                        if (cell.info.header === 'status') {
                          return (
                            <TableCell key={cell.id}>
                              <Tag type={cell.value ? 'green' : 'gray'}>{cell.value ? 'Active' : 'Inactive'}</Tag>
                            </TableCell>
                          );
                        }
                        if (cell.info.header === 'action') {
                          return <TableCell key={cell.id}><code>{cell.value}</code></TableCell>;
                        }
                        if (cell.info.header === 'actions') {
                          return (
                            <TableCell key={cell.id}>
                              {policy && (
                                <>
                                  <Button kind="ghost" size="sm" disabled={pending || !canManage} title={manageUnavailableReason} onClick={() => onEdit(policy)}>Edit</Button>
                                  <Button kind="ghost" size="sm" disabled={pending || !canManage} title={manageUnavailableReason} onClick={() => onToggle(policy)}>
                                    {policy.isActive ? 'Disable' : 'Enable'}
                                  </Button>
                                  <Button kind="ghost" size="sm" disabled={pending || !canManage} title={manageUnavailableReason} renderIcon={TrashCan} onClick={() => onDelete(policy.id)}>Delete</Button>
                                </>
                              )}
                            </TableCell>
                          );
                        }
                        return <TableCell key={cell.id}>{cell.value}</TableCell>;
                      })}
                    </DataTableDataRow>
                  );
                })}
              </TableBody>
            </Table>
          </>
        )}
      </DataTable>
    </TableContainer>
  );
}

function AuthzAuditPanel({
  entries,
  loading,
  filters,
  onFiltersChange,
  onClearFilters,
}: {
  entries: AuthzAuditEntry[];
  loading: boolean;
  filters: AuthzAuditFilterState;
  onFiltersChange: (patch: Partial<AuthzAuditFilterState>) => void;
  onClearFilters: () => void;
}) {
  const selectedDecision = AUTHZ_AUDIT_DECISION_FILTERS.find((item) => item.id === filters.decision) || AUTHZ_AUDIT_DECISION_FILTERS[0];
  const selectedLimit = AUTHZ_AUDIT_LIMITS.find((item) => item.id === filters.limit) || AUTHZ_AUDIT_LIMITS[1];

  if (loading) return <DataTableSkeleton headers={authzAuditHeaders} rowCount={6} />;

  return (
    <TableContainer>
      <DataTable
        rows={entries.map((entry) => ({
          id: entry.id,
          timestamp: formatTimestamp(entry.timestamp),
          decision: entry.decision,
          action: entry.action,
          user: entry.userId,
          resource: formatAuditResource(entry),
          reason: entry.reason || '-',
          policy: entry.policyId || '-',
          context: formatAuditContext(entry.context),
          network: formatAuditNetwork(entry),
        }))}
        headers={authzAuditHeaders}
      >
        {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
          <>
            <TableToolbar>
              <TableToolbarContent>
                <TextInput
                  id="authz-audit-user-filter"
                  labelText="User ID"
                  value={filters.userId}
                  onChange={(event) => onFiltersChange({ userId: event.target.value })}
                />
                <TextInput
                  id="authz-audit-resource-type-filter"
                  labelText="Resource type"
                  value={filters.resourceType}
                  onChange={(event) => onFiltersChange({ resourceType: event.target.value })}
                />
                <TextInput
                  id="authz-audit-resource-id-filter"
                  labelText="Resource ID"
                  value={filters.resourceId}
                  onChange={(event) => onFiltersChange({ resourceId: event.target.value })}
                />
                <Dropdown
                  id="authz-audit-decision-filter"
                  titleText="Decision"
                  label="Decision"
                  items={AUTHZ_AUDIT_DECISION_FILTERS}
                  itemToString={(item) => item?.label || ''}
                  selectedItem={selectedDecision}
                  onChange={({ selectedItem }) => onFiltersChange({ decision: selectedItem?.id || 'all' })}
                />
                <Dropdown
                  id="authz-audit-limit"
                  titleText="Limit"
                  label="Limit"
                  items={AUTHZ_AUDIT_LIMITS}
                  itemToString={(item) => item?.label || ''}
                  selectedItem={selectedLimit}
                  onChange={({ selectedItem }) => onFiltersChange({ limit: selectedItem?.id || 50 })}
                />
                <Button kind="ghost" size="sm" onClick={onClearFilters}>
                  Clear
                </Button>
              </TableToolbarContent>
            </TableToolbar>
            <Table {...getTableProps()} size="md">
              <TableHead>
                <TableRow>
                  {headers.map((header) => (
                    <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={headers.length}>No authorization audit events match the current filters.</TableCell>
                  </TableRow>
                ) : rows.map((row) => (
                  <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                    {row.cells.map((cell) => {
                      if (cell.info.header === 'decision') {
                        return (
                          <TableCell key={cell.id}>
                            <Tag type={cell.value === 'allow' ? 'green' : 'red'}>{cell.value === 'allow' ? 'Allow' : 'Deny'}</Tag>
                          </TableCell>
                        );
                      }
                      if (cell.info.header === 'action') {
                        return <TableCell key={cell.id}><code>{cell.value}</code></TableCell>;
                      }
                      return <TableCell key={cell.id}>{cell.value}</TableCell>;
                    })}
                  </DataTableDataRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </DataTable>
    </TableContainer>
  );
}

function ApiClientsPanel({
  clients,
  serviceAccounts,
  loading,
  serviceAccountsLoading,
  pending,
  generatedToken,
  generatedServiceAccountToken,
  externalSystems,
  externalSystemsLoading,
  externalEngines,
  externalEnginesLoading,
  selectedEngineId,
  auditFilter,
  reconcileSummary,
  auditEntries,
  auditLoading,
  machineAuditEntries,
  machineAuditLoading,
  roleAssignments,
  roleAssignmentsLoading,
  onCreate,
  onCreateServiceAccount,
  onRotate,
  onRotateServiceAccount,
  onRevoke,
  onRevokeServiceAccount,
  onCreateExternalSystem,
  onUpdateExternalSystem,
  onArchiveExternalSystem,
  onSelectEngine,
  onReconcileEngine,
  onDecommissionEngine,
  onReactivateEngine,
  onAuditFilterChange,
  onOpenMachineAuditReference,
  canManageApiClients,
  canManageServiceAccounts,
  canManageExternalSystems,
  canReadRoleAssignments,
  canReadAuthzAudit,
  canReadExternalEngineAudit,
  canReconcileExternalEngine,
  canManageExternalEngineLifecycle,
  apiClientsManageUnavailableReason,
  serviceAccountsManageUnavailableReason,
  externalSystemsManageUnavailableReason,
  externalEngineAuditReadUnavailableReason,
  externalEngineReconcileUnavailableReason,
  externalEngineLifecycleUnavailableReason,
  externalEngineApiUpsertDecision,
  externalEngineApiDecommissionDecision,
}: {
  clients: ApiClient[];
  serviceAccounts: ServiceAccount[];
  loading: boolean;
  serviceAccountsLoading: boolean;
  pending: boolean;
  generatedToken: string | null;
  generatedServiceAccountToken: string | null;
  externalSystems: ExternalEngineSystem[];
  externalSystemsLoading: boolean;
  externalEngines: ExternalEngineRegistration[];
  externalEnginesLoading: boolean;
  selectedEngineId: string;
  auditFilter: ExternalEngineAuditAction;
  reconcileSummary: string | null;
  auditEntries: ExternalEngineRegistrationAuditEntry[];
  auditLoading: boolean;
  machineAuditEntries: AuthzAuditEntry[];
  machineAuditLoading: boolean;
  roleAssignments: RoleAssignment[];
  roleAssignmentsLoading: boolean;
  onCreate: (name: string, scopes: string[]) => void;
  onCreateServiceAccount: (name: string, description: string, scopes: string[]) => void;
  onRotate: (id: string) => void;
  onRotateServiceAccount: (id: string) => void;
  onRevoke: (id: string) => void;
  onRevokeServiceAccount: (id: string) => void;
  onCreateExternalSystem: (payload: Required<Pick<ExternalEngineSystemPayload, 'name'>> & ExternalEngineSystemPayload) => void;
  onUpdateExternalSystem: (id: string, payload: ExternalEngineSystemPayload) => void;
  onArchiveExternalSystem: (id: string) => void;
  onSelectEngine: (id: string) => void;
  onReconcileEngine: (id: string) => void;
  onDecommissionEngine: (id: string) => void;
  onReactivateEngine: (id: string) => void;
  onAuditFilterChange: (filter: ExternalEngineAuditAction) => void;
  onOpenMachineAuditReference?: (entry: AuthzAuditEntry) => void;
  canManageApiClients: boolean;
  canManageServiceAccounts: boolean;
  canManageExternalSystems: boolean;
  canReadRoleAssignments: boolean;
  canReadAuthzAudit: boolean;
  canReadExternalEngineAudit: boolean;
  canReconcileExternalEngine: boolean;
  canManageExternalEngineLifecycle: boolean;
  apiClientsManageUnavailableReason?: string;
  serviceAccountsManageUnavailableReason?: string;
  externalSystemsManageUnavailableReason?: string;
  externalEngineAuditReadUnavailableReason?: string;
  externalEngineReconcileUnavailableReason?: string;
  externalEngineLifecycleUnavailableReason?: string;
  externalEngineApiUpsertDecision: UiAuthzDecision;
  externalEngineApiDecommissionDecision: UiAuthzDecision;
}) {
  const [name, setName] = React.useState('');
  const [scopes, setScopes] = React.useState<string[]>(['engine:register']);
  const [serviceAccountName, setServiceAccountName] = React.useState('');
  const [serviceAccountDescription, setServiceAccountDescription] = React.useState('');
  const [serviceAccountScopes, setServiceAccountScopes] = React.useState<string[]>(['deployment:execute']);
  const [editingExternalSystemId, setEditingExternalSystemId] = React.useState<string | null>(null);
  const [externalSystemForm, setExternalSystemForm] = React.useState(DEFAULT_EXTERNAL_SYSTEM_FORM);
  const selectedEngine = externalEngines.find((engine) => engine.id === selectedEngineId) || null;
  const activeApiClients = clients.filter((client) => client.isActive);
  const activeServiceAccounts = serviceAccounts.filter((account) => account.isActive);
  const revokedMachineIdentities = clients.filter((client) => !client.isActive).length +
    serviceAccounts.filter((account) => !account.isActive).length;
  const neverUsedMachineIdentities = [...activeApiClients, ...activeServiceAccounts]
    .filter((identity) => !identity.lastUsedAt).length;
  const broadRegistrationScopes = activeApiClients.filter((client) => client.scopes.includes('engine:register')).length;
  const deploymentExecutionScopes = [...activeApiClients, ...activeServiceAccounts]
    .filter((identity) => identity.scopes.includes('deployment:execute')).length;
  const machineRoleAssignmentCount = getMachineIdentityRoleAssignments(roleAssignments).length;
  const machineIdentityAuditReferenceCount = countMachineIdentitiesWithAuditReferences(
    clients,
    serviceAccounts,
    machineAuditEntries,
  );

  const create = () => {
    onCreate(name, scopes);
    setName('');
    setScopes(['engine:register']);
  };

  const createServiceAccount = () => {
    onCreateServiceAccount(serviceAccountName, serviceAccountDescription, serviceAccountScopes);
    setServiceAccountName('');
    setServiceAccountDescription('');
    setServiceAccountScopes(['deployment:execute']);
  };

  const resetExternalSystemForm = () => {
    setEditingExternalSystemId(null);
    setExternalSystemForm(DEFAULT_EXTERNAL_SYSTEM_FORM);
  };

  const editExternalSystem = (system: ExternalEngineSystem) => {
    setEditingExternalSystemId(system.id);
    setExternalSystemForm({
      key: system.key,
      name: system.name,
      description: system.description || '',
      defaultManagementMode: system.defaultManagementMode === 'hybrid' ? 'hybrid' : 'external_managed',
      defaultFieldOwnership: { ...DEFAULT_EXTERNAL_SYSTEM_OWNERSHIP, ...system.defaultFieldOwnership },
    });
  };

  const submitExternalSystem = () => {
    const payload = {
      name: externalSystemForm.name.trim(),
      description: externalSystemForm.description.trim() || null,
      defaultManagementMode: externalSystemForm.defaultManagementMode,
      defaultFieldOwnership: externalSystemForm.defaultFieldOwnership,
    };
    if (editingExternalSystemId) {
      onUpdateExternalSystem(editingExternalSystemId, payload);
    } else {
      onCreateExternalSystem({
        ...payload,
        key: externalSystemForm.key.trim() || undefined,
      });
    }
    resetExternalSystemForm();
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
      {generatedToken && (
        <InlineNotification
          kind="success"
          title="API client token generated"
          subtitle={generatedToken}
          lowContrast
        />
	      )}
	      {generatedServiceAccountToken && (
	        <InlineNotification
	          kind="success"
	          title="Service account token generated"
	          subtitle={generatedServiceAccountToken}
	          lowContrast
	        />
	      )}
      <div aria-label="Machine identity diagnostics" style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
        <h3 style={{ margin: 0 }}>Machine identity diagnostics</h3>
        <div style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <Tag type="green">{formatMachineDiagnosticCount(activeApiClients.length, 'active API client')}</Tag>
          <Tag type="green">{formatMachineDiagnosticCount(activeServiceAccounts.length, 'active service account')}</Tag>
          <Tag type={revokedMachineIdentities > 0 ? 'magenta' : 'gray'}>
            {formatMachineDiagnosticCount(revokedMachineIdentities, 'revoked machine identity', 'revoked machine identities')}
          </Tag>
          <Tag type="blue">
            {roleAssignmentsLoading
              ? 'Machine role assignments loading'
              : canReadRoleAssignments
                ? formatMachineDiagnosticCount(machineRoleAssignmentCount, 'machine role assignment')
                : 'Machine role assignments hidden'}
          </Tag>
          <Tag type={neverUsedMachineIdentities > 0 ? 'warm-gray' : 'green'}>
            {formatMachineDiagnosticCount(neverUsedMachineIdentities, 'never-used machine identity', 'never-used machine identities')}
          </Tag>
          <Tag type={broadRegistrationScopes > 0 ? 'purple' : 'gray'}>
            {formatMachineDiagnosticCount(broadRegistrationScopes, 'broad registration scope')}
          </Tag>
          <Tag type={deploymentExecutionScopes > 0 ? 'cyan' : 'gray'}>
            {formatMachineDiagnosticCount(deploymentExecutionScopes, 'deployment execution scope')}
          </Tag>
          <Tag
            type={externalEngineApiUpsertDecision.allowed ? 'green' : 'red'}
            title={externalEngineApiUpsertDecision.reason}
          >
            External API registration {externalEngineApiUpsertDecision.allowed ? 'allowed' : 'blocked'}
          </Tag>
          <Tag
            type={externalEngineApiDecommissionDecision.allowed ? 'green' : 'red'}
            title={externalEngineApiDecommissionDecision.reason}
          >
            External API decommission {externalEngineApiDecommissionDecision.allowed ? 'allowed' : 'blocked'}
          </Tag>
          {canReadAuthzAudit && (
            <Tag type="teal">
              {machineAuditLoading
                ? 'Audit references loading'
                : formatMachineDiagnosticCount(machineIdentityAuditReferenceCount, 'machine identity with audit reference', 'machine identities with audit references')}
            </Tag>
          )}
        </div>
      </div>
	      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-4)', alignItems: 'end' }}>
	        <TextInput
	          id="api-client-name"
          labelText="Client name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div style={{ display: 'flex', gap: 'var(--spacing-4)', alignItems: 'center', flexWrap: 'wrap' }}>
          {API_CLIENT_SCOPE_OPTIONS.map((scope) => (
            <Checkbox
              key={scope.id}
              id={`api-client-scope-${scope.id.replace(/[:]/g, '-')}`}
              labelText={scope.label}
              checked={scopes.includes(scope.id)}
              onChange={(_, { checked }) => {
                setScopes((current) => checked
                  ? Array.from(new Set([...current, scope.id]))
                  : current.filter((item) => item !== scope.id));
              }}
            />
          ))}
        </div>
        <Button disabled={!name.trim() || scopes.length === 0 || pending || !canManageApiClients} title={apiClientsManageUnavailableReason} onClick={create}>
          Create Client
        </Button>
      </div>
      <h3 style={{ margin: 0 }}>API clients</h3>
      {loading ? (
        <DataTableSkeleton headers={apiClientHeaders} rowCount={4} />
      ) : (
        <TableContainer>
          <DataTable
            rows={clients.map((client) => ({
              id: client.id,
              name: client.name,
              prefix: client.tokenPrefix,
              scopes: client.scopes.join(', '),
              created: new Date(client.createdAt).toLocaleString(),
              lastUsed: client.lastUsedAt ? new Date(client.lastUsedAt).toLocaleString() : 'Never',
              status: client.isActive,
              audit: machineAuditLoading ? 'Loading...' : formatAuditReferences(findMachineIdentityAuditEntries('api_client', client.id, machineAuditEntries)),
              actions: '',
            }))}
            headers={apiClientHeaders}
          >
            {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
              <Table {...getTableProps()} size="md">
                <TableHead>
                  <TableRow>
                  {headers.map((header) => (
                    <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                  ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => {
                    const client = clients.find((item) => item.id === row.id);
                    return (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'status') {
                            return <TableCell key={cell.id}><Tag type={cell.value ? 'green' : 'gray'}>{cell.value ? 'Active' : 'Revoked'}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'audit') {
                            return (
                              <TableCell key={cell.id}>
                                {machineAuditLoading ? 'Loading...' : canReadAuthzAudit && client ? (
                                  <AuditReferenceLinks
                                    entries={findMachineIdentityAuditEntries('api_client', client.id, machineAuditEntries)}
                                    onOpen={onOpenMachineAuditReference}
                                  />
                                ) : '-'}
                              </TableCell>
                            );
                          }
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {client?.isActive && (
                                  <>
                                    <Button kind="ghost" size="sm" disabled={pending || !canManageApiClients} title={apiClientsManageUnavailableReason} onClick={() => onRotate(client.id)}>Rotate</Button>
                                    <Button kind="ghost" size="sm" disabled={pending || !canManageApiClients} title={apiClientsManageUnavailableReason} renderIcon={TrashCan} onClick={() => onRevoke(client.id)}>Revoke</Button>
                                  </>
                                )}
                              </TableCell>
                            );
                          }
                          return <TableCell key={cell.id}>{cell.value}</TableCell>;
                        })}
                      </DataTableDataRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </DataTable>
        </TableContainer>
      )}
      <h3 style={{ margin: 0 }}>Service accounts</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-4)', alignItems: 'end' }}>
        <TextInput
          id="service-account-name"
          labelText="Service account name"
          value={serviceAccountName}
          onChange={(event) => setServiceAccountName(event.target.value)}
        />
        <TextInput
          id="service-account-description"
          labelText="Service account description"
          value={serviceAccountDescription}
          onChange={(event) => setServiceAccountDescription(event.target.value)}
        />
        <div style={{ display: 'flex', gap: 'var(--spacing-4)', alignItems: 'center', flexWrap: 'wrap' }}>
          {SERVICE_ACCOUNT_SCOPE_OPTIONS.map((scope) => (
            <Checkbox
              key={scope.id}
              id={`service-account-scope-${scope.id.replace(/[:]/g, '-')}`}
              labelText={scope.label}
              checked={serviceAccountScopes.includes(scope.id)}
              onChange={(_, { checked }) => {
                setServiceAccountScopes((current) => checked
                  ? Array.from(new Set([...current, scope.id]))
                  : current.filter((item) => item !== scope.id));
              }}
            />
          ))}
        </div>
        <Button disabled={!serviceAccountName.trim() || serviceAccountScopes.length === 0 || pending || !canManageServiceAccounts} title={serviceAccountsManageUnavailableReason} onClick={createServiceAccount}>
          Create Service Account
        </Button>
      </div>
      {serviceAccountsLoading ? (
        <DataTableSkeleton headers={serviceAccountHeaders} rowCount={4} />
      ) : (
        <TableContainer>
          <DataTable
            rows={serviceAccounts.map((account) => ({
              id: account.id,
              name: account.name,
              prefix: account.tokenPrefix || '-',
              scopes: account.scopes.join(', '),
              description: account.description || '-',
              created: new Date(account.createdAt).toLocaleString(),
              lastUsed: account.lastUsedAt ? new Date(account.lastUsedAt).toLocaleString() : 'Never',
              status: account.isActive,
              audit: machineAuditLoading ? 'Loading...' : formatAuditReferences(findMachineIdentityAuditEntries('service_account', account.id, machineAuditEntries)),
              actions: '',
            }))}
            headers={serviceAccountHeaders}
          >
            {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
              <Table {...getTableProps()} size="md">
                <TableHead>
                  <TableRow>
                    {headers.map((header) => (
                      <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => {
                    const account = serviceAccounts.find((item) => item.id === row.id);
                    return (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'status') {
                            return <TableCell key={cell.id}><Tag type={cell.value ? 'green' : 'gray'}>{cell.value ? 'Active' : 'Revoked'}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'audit') {
                            return (
                              <TableCell key={cell.id}>
                                {machineAuditLoading ? 'Loading...' : canReadAuthzAudit && account ? (
                                  <AuditReferenceLinks
                                    entries={findMachineIdentityAuditEntries('service_account', account.id, machineAuditEntries)}
                                    onOpen={onOpenMachineAuditReference}
                                  />
                                ) : '-'}
                              </TableCell>
                            );
                          }
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {account?.isActive && (
                                  <>
                                    <Button kind="ghost" size="sm" disabled={pending || !canManageServiceAccounts} title={serviceAccountsManageUnavailableReason} onClick={() => onRotateServiceAccount(account.id)}>Rotate</Button>
                                    <Button kind="ghost" size="sm" disabled={pending || !canManageServiceAccounts} title={serviceAccountsManageUnavailableReason} renderIcon={TrashCan} onClick={() => onRevokeServiceAccount(account.id)}>Revoke</Button>
                                  </>
                                )}
                              </TableCell>
                            );
                          }
                          return <TableCell key={cell.id}>{cell.value}</TableCell>;
                        })}
                      </DataTableDataRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </DataTable>
        </TableContainer>
      )}
      <h3 style={{ margin: 0 }}>External systems</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-4)', alignItems: 'end' }}>
        <TextInput
          id="external-system-key"
          labelText="System key"
          value={externalSystemForm.key}
          disabled={Boolean(editingExternalSystemId) || pending || !canManageExternalSystems}
          onChange={(event) => setExternalSystemForm((current) => ({ ...current, key: event.target.value }))}
        />
        <TextInput
          id="external-system-name"
          labelText="System name"
          value={externalSystemForm.name}
          disabled={pending || !canManageExternalSystems}
          onChange={(event) => setExternalSystemForm((current) => ({ ...current, name: event.target.value }))}
        />
        <TextInput
          id="external-system-description"
          labelText="System description"
          value={externalSystemForm.description}
          disabled={pending || !canManageExternalSystems}
          onChange={(event) => setExternalSystemForm((current) => ({ ...current, description: event.target.value }))}
        />
        <Dropdown
          id="external-system-mode"
          titleText="Default mode"
          label="Default mode"
          disabled={pending || !canManageExternalSystems}
          items={EXTERNAL_SYSTEM_MODE_OPTIONS}
          itemToString={(item) => item?.label || ''}
          selectedItem={EXTERNAL_SYSTEM_MODE_OPTIONS.find((item) => item.id === externalSystemForm.defaultManagementMode) || EXTERNAL_SYSTEM_MODE_OPTIONS[0]}
          onChange={({ selectedItem }) => {
            if (selectedItem) {
              setExternalSystemForm((current) => ({ ...current, defaultManagementMode: selectedItem.id }));
            }
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: 'var(--spacing-5)', alignItems: 'center', flexWrap: 'wrap' }}>
        {EXTERNAL_SYSTEM_OWNERSHIP_FIELDS.map((field) => (
          <Toggle
            key={field.id}
            id={`external-system-ownership-${field.id}`}
            labelText={`${field.label} manually editable`}
            labelA="External"
            labelB="Manual"
            disabled={pending || !canManageExternalSystems}
            toggled={externalSystemForm.defaultFieldOwnership[field.id] === 'manual'}
            onToggle={(checked) => {
              setExternalSystemForm((current) => ({
                ...current,
                defaultFieldOwnership: {
                  ...current.defaultFieldOwnership,
                  [field.id]: checked ? 'manual' : 'external',
                },
              }));
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
        <Button disabled={!externalSystemForm.name.trim() || pending || !canManageExternalSystems} title={externalSystemsManageUnavailableReason} onClick={submitExternalSystem}>
          {editingExternalSystemId ? 'Update System' : 'Create System'}
        </Button>
        {editingExternalSystemId && (
          <Button kind="secondary" disabled={pending} onClick={resetExternalSystemForm}>
            Cancel Edit
          </Button>
        )}
      </div>
      {externalSystemsLoading ? (
        <DataTableSkeleton headers={externalEngineSystemHeaders} rowCount={3} />
      ) : (
        <TableContainer>
          <DataTable
            rows={externalSystems.map((system) => ({
              id: system.id,
              name: system.name,
              key: system.key,
              mode: system.defaultManagementMode === 'hybrid' ? 'Hybrid' : 'External managed',
              ownership: formatFieldOwnership(system.defaultFieldOwnership),
              status: system.isActive ? 'Active' : 'Disabled',
              actions: '',
            }))}
            headers={externalEngineSystemHeaders}
          >
            {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
              <Table {...getTableProps()} size="md">
                <TableHead>
                  <TableRow>
                    {headers.map((header) => (
                      <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => {
                    const system = externalSystems.find((item) => item.id === row.id);
                    return (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'status') {
                            return <TableCell key={cell.id}><Tag type={cell.value === 'Active' ? 'green' : 'gray'}>{cell.value}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {system && (
                                  <>
                                    <Button kind="ghost" size="sm" disabled={pending || !canManageExternalSystems} title={externalSystemsManageUnavailableReason} aria-label={`Edit ${system.name}`} onClick={() => editExternalSystem(system)}>Edit</Button>
                                    {system.isActive && (
                                      <Button kind="ghost" size="sm" disabled={pending || !canManageExternalSystems} title={externalSystemsManageUnavailableReason} aria-label={`Archive ${system.name}`} renderIcon={TrashCan} onClick={() => onArchiveExternalSystem(system.id)}>Archive</Button>
                                    )}
                                  </>
                                )}
                              </TableCell>
                            );
                          }
                          return <TableCell key={cell.id}>{cell.value}</TableCell>;
                        })}
                      </DataTableDataRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </DataTable>
        </TableContainer>
      )}
      <h3 style={{ margin: 0 }}>Registered engines</h3>
      {reconcileSummary && (
        <InlineNotification kind="info" title="Reconcile diagnostics" subtitle={reconcileSummary} lowContrast />
      )}
      {externalEnginesLoading ? (
        <DataTableSkeleton headers={externalEngineHeaders} rowCount={4} />
      ) : (
        <TableContainer>
          <DataTable
            rows={externalEngines.map((engine) => ({
              id: engine.id,
              name: engine.name,
              externalId: engine.externalId || '-',
              system: engine.externalSystemName || engine.externalSystemId || '-',
              mode: engine.managementMode === 'hybrid' ? 'Hybrid' : engine.managementMode === 'manual' ? 'Manual' : 'External managed',
              lifecycle: formatStatusLabel(engine.lifecycleStatus || 'active'),
              drift: formatStatusLabel(engine.driftStatus || 'in_sync'),
              capability: formatStatusLabel(engine.capabilityStatus || 'unknown'),
              diagnostics: formatCapabilityDiagnostics(engine.capabilityDiagnostics),
              ownership: formatFieldOwnership(engine.fieldOwnership),
              labels: formatLabels(engine.labels),
              source: engine.registrationSource || '-',
              lastSync: engine.lastExternalSyncAt || engine.externalUpdatedAt ? new Date(engine.lastExternalSyncAt || engine.externalUpdatedAt || 0).toLocaleString() : '-',
              actions: '',
            }))}
            headers={externalEngineHeaders}
          >
            {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
              <Table {...getTableProps()} size="md">
                <TableHead>
                  <TableRow>
                    {headers.map((header) => (
                      <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => {
                    const engine = externalEngines.find((item) => item.id === row.id);
                    return (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'lifecycle') {
                            return <TableCell key={cell.id}><Tag type={getLifecycleTagType(engine?.lifecycleStatus || 'active')}>{cell.value}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'drift') {
                            return <TableCell key={cell.id}><Tag type={getDriftTagType(engine?.driftStatus || 'in_sync')}>{cell.value}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'capability') {
                            return <TableCell key={cell.id}><Tag type={getCapabilityTagType(engine?.capabilityStatus || 'unknown')}>{cell.value}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'source') {
                            return <TableCell key={cell.id}><Tag type={cell.value === 'external_api' ? 'green' : 'gray'}>{cell.value}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {engine && (
                                  <>
                                    <Button kind="ghost" size="sm" disabled={pending || !canReconcileExternalEngine || engine.lifecycleStatus === 'decommissioned'} title={!canReconcileExternalEngine ? externalEngineReconcileUnavailableReason : engine.lifecycleStatus === 'decommissioned' ? 'Decommissioned engines cannot be reconciled' : undefined} onClick={() => onReconcileEngine(engine.id)}>Reconcile</Button>
                                    {engine.lifecycleStatus === 'decommissioned' ? (
                                      <Button kind="ghost" size="sm" disabled={pending || !canManageExternalEngineLifecycle} title={externalEngineLifecycleUnavailableReason} onClick={() => onReactivateEngine(engine.id)}>Reactivate</Button>
                                    ) : (
                                      <Button kind="ghost" size="sm" disabled={pending || !canManageExternalEngineLifecycle} title={externalEngineLifecycleUnavailableReason} onClick={() => onDecommissionEngine(engine.id)}>Decommission</Button>
                                    )}
                                    <Button kind="ghost" size="sm" disabled={!canReadExternalEngineAudit} title={externalEngineAuditReadUnavailableReason} onClick={() => onSelectEngine(engine.id)}>View audit</Button>
                                  </>
                                )}
                              </TableCell>
                            );
                          }
                          return <TableCell key={cell.id}>{cell.value}</TableCell>;
                        })}
                      </DataTableDataRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </DataTable>
        </TableContainer>
      )}
      <h3 style={{ margin: 0 }}>{selectedEngine ? `${selectedEngine.name} audit` : 'Registration audit'}</h3>
      {!selectedEngine ? (
        <InlineNotification kind="info" title="Select a registered engine to view registration audit history" lowContrast />
      ) : auditLoading ? (
        <DataTableSkeleton headers={externalEngineAuditHeaders} rowCount={3} />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
          <div style={{ maxWidth: 320 }}>
            <Dropdown
              id="external-engine-audit-filter"
              titleText="Audit event"
              label="Audit event"
              items={EXTERNAL_ENGINE_AUDIT_FILTERS}
              itemToString={(item) => item?.label || ''}
              selectedItem={EXTERNAL_ENGINE_AUDIT_FILTERS.find((item) => item.id === auditFilter) || EXTERNAL_ENGINE_AUDIT_FILTERS[0]}
              onChange={({ selectedItem }) => {
                if (selectedItem) onAuditFilterChange(selectedItem.id);
              }}
            />
          </div>
          <TableContainer>
            <DataTable
              rows={auditEntries.map((entry) => ({
                id: entry.id,
                action: entry.action,
                actor: entry.userId || '-',
                details: formatDetails(entry.details),
                created: new Date(entry.createdAt).toLocaleString(),
              }))}
              headers={externalEngineAuditHeaders}
            >
              {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                <Table {...getTableProps()} size="md">
                  <TableHead>
                    <TableRow>
                      {headers.map((header) => (
                        <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => (
                          <TableCell key={cell.id}>{cell.value}</TableCell>
                        ))}
                      </DataTableDataRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </DataTable>
          </TableContainer>
        </div>
      )}
    </div>
  );
}

export default function AccessControl() {
  const rolesQ = useRbacRoles();
  const permissionsQ = usePermissionCatalog();
  const assignmentsQ = useRoleAssignments();
  const groupsQ = useAuthzGroups();
  const groupMembershipsQ = useAuthzGroupMemberships();
  const apiClientsQ = useApiClients();
  const serviceAccountsQ = useServiceAccounts();
  const externalSystemsQ = useExternalEngineSystems();
  const externalEnginesQ = useExternalEngines();
  const engineSetsQ = useEngineSets();
  const projectEngineTargetsQ = useProjectEngineTargets({ status: 'all' });
  const policiesQ = useAuthzPolicies();
  const ssoPlatformMappingsQ = useSsoClaimsMappings();
  const ssoGroupMappingsQ = useSsoGroupMappings();
  const mappingsQ = useSsoAssignmentMappings();
  const createRoleM = useCreateCustomRole();
  const updateRoleM = useUpdateCustomRole();
  const archiveRoleM = useArchiveCustomRole();
  const createPermissionM = useCreateCustomPermission();
  const createGroupM = useCreateAuthzGroup();
  const updateGroupM = useUpdateAuthzGroup();
  const deleteGroupM = useDeleteAuthzGroup();
  const addGroupMembershipM = useAddAuthzGroupMembership();
  const removeGroupMembershipM = useRemoveAuthzGroupMembership();
  const assignRoleM = useAssignRole();
  const removeAssignmentM = useRemoveRoleAssignment();
  const createEngineSetM = useCreateEngineSet();
  const updateEngineSetM = useUpdateEngineSet();
  const archiveEngineSetM = useArchiveEngineSet();
  const previewEngineSetM = usePreviewEngineSetSelector();
  const materializeEngineSetM = useMaterializeEngineSet();
  const createProjectEngineTargetM = useCreateProjectEngineTarget();
  const updateProjectEngineTargetM = useUpdateProjectEngineTarget();
  const archiveProjectEngineTargetM = useArchiveProjectEngineTarget();
  const syncLegacyProjectEngineTargetsM = useSyncLegacyProjectEngineTargets();
  const evaluateDeploymentEligibilityM = useEvaluateDeploymentEligibility();
  const createPolicyM = useCreatePolicy();
  const updatePolicyM = useUpdatePolicy();
  const deletePolicyM = useDeletePolicy();
  const createApiClientM = useCreateApiClient();
  const createServiceAccountM = useCreateServiceAccount();
  const createExternalSystemM = useCreateExternalEngineSystem();
  const updateExternalSystemM = useUpdateExternalEngineSystem();
  const archiveExternalSystemM = useArchiveExternalEngineSystem();
  const rotateApiClientM = useRotateApiClient();
  const rotateServiceAccountM = useRotateServiceAccount();
  const revokeApiClientM = useRevokeApiClient();
  const revokeServiceAccountM = useRevokeServiceAccount();
  const decommissionExternalEngineM = useDecommissionExternalEngine();
  const reactivateExternalEngineM = useReactivateExternalEngine();
  const reconcileExternalEngineM = useReconcileExternalEngine();
  const createSsoPlatformMappingM = useCreateSsoMapping();
  const updateSsoPlatformMappingM = useUpdateSsoMapping();
  const deleteSsoPlatformMappingM = useDeleteSsoMapping();
  const testSsoPlatformMappingM = useTestSsoMapping();
  const createSsoGroupMappingM = useCreateSsoGroupMapping();
  const updateSsoGroupMappingM = useUpdateSsoGroupMapping();
  const deleteSsoGroupMappingM = useDeleteSsoGroupMapping();
  const testSsoGroupMappingM = useTestSsoGroupMapping();
  const createM = useCreateSsoAssignmentMapping();
  const updateM = useUpdateSsoAssignmentMapping();
  const deleteM = useDeleteSsoAssignmentMapping();
  const testM = useTestSsoAssignmentMapping();
  const runSsoSyncDiagnosticsM = useRunSsoSyncDiagnostics();
  const platformSettingsQ = usePlatformSyncSettings();

  const [error, setError] = React.useState<string | null>(null);
  const [assignmentWarnings, setAssignmentWarnings] = React.useState<string[]>([]);
  const [roleModalOpen, setRoleModalOpen] = React.useState(false);
  const [permissionModalOpen, setPermissionModalOpen] = React.useState(false);
  const [editingRole, setEditingRole] = React.useState<RoleSummary | null>(null);
  const [duplicatingRole, setDuplicatingRole] = React.useState<RoleSummary | null>(null);
  const [matrixSavingRoleId, setMatrixSavingRoleId] = React.useState<string | null>(null);
  const [roleRiskAcknowledged, setRoleRiskAcknowledged] = React.useState(false);
  const [groupModalOpen, setGroupModalOpen] = React.useState(false);
  const [editingGroup, setEditingGroup] = React.useState<AuthzGroup | null>(null);
  const [groupForm, setGroupForm] = React.useState<AuthzGroupFormState>(DEFAULT_AUTHZ_GROUP_FORM);
  const [selectedGroupId, setSelectedGroupId] = React.useState('');
  const [engineSetModalOpen, setEngineSetModalOpen] = React.useState(false);
  const [editingEngineSet, setEditingEngineSet] = React.useState<EngineSetSummary | null>(null);
  const [selectedEngineSetId, setSelectedEngineSetId] = React.useState('');
  const [selectedRuntimeEngineId, setSelectedRuntimeEngineId] = React.useState('');
  const [engineSetMaterializeSummary, setEngineSetMaterializeSummary] = React.useState<string | null>(null);
  const [engineSetRiskAcknowledged, setEngineSetRiskAcknowledged] = React.useState(false);
  const [projectTargetModalOpen, setProjectTargetModalOpen] = React.useState(false);
  const [editingProjectTarget, setEditingProjectTarget] = React.useState<ProjectEngineTarget | null>(null);
  const [projectTargetForm, setProjectTargetForm] = React.useState<ProjectEngineTargetFormState>(DEFAULT_PROJECT_ENGINE_TARGET_FORM);
  const [projectTargetSyncSummary, setProjectTargetSyncSummary] = React.useState<string | null>(null);
  const [deploymentEligibilityResult, setDeploymentEligibilityResult] = React.useState<DeploymentEligibilityResult | null>(null);
  const [policyModalOpen, setPolicyModalOpen] = React.useState(false);
  const [editingPolicy, setEditingPolicy] = React.useState<AuthzPolicy | null>(null);
  const [policyForm, setPolicyForm] = React.useState<AuthzPolicyFormState>(DEFAULT_AUTHZ_POLICY_FORM);
  const [policyConditionsJson, setPolicyConditionsJson] = React.useState('{}');
  const [ssoPlatformModalOpen, setSsoPlatformModalOpen] = React.useState(false);
  const [editingSsoPlatformMapping, setEditingSsoPlatformMapping] = React.useState<SsoClaimsMapping | null>(null);
  const [ssoPlatformForm, setSsoPlatformForm] = React.useState<SsoPlatformMappingFormState>(DEFAULT_SSO_PLATFORM_MAPPING_FORM);
  const [ssoPlatformRiskAcknowledged, setSsoPlatformRiskAcknowledged] = React.useState(false);
  const [ssoGroupModalOpen, setSsoGroupModalOpen] = React.useState(false);
  const [editingSsoGroupMapping, setEditingSsoGroupMapping] = React.useState<SsoGroupMapping | null>(null);
  const [ssoGroupForm, setSsoGroupForm] = React.useState<SsoGroupMappingFormState>(DEFAULT_SSO_GROUP_MAPPING_FORM);
  const [ssoGroupRiskAcknowledged, setSsoGroupRiskAcknowledged] = React.useState(false);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<SsoAssignmentMapping | null>(null);
  const [ssoHighRiskAcknowledged, setSsoHighRiskAcknowledged] = React.useState(false);
  const [apiClientToken, setApiClientToken] = React.useState<string | null>(null);
  const [serviceAccountToken, setServiceAccountToken] = React.useState<string | null>(null);
  const [selectedExternalEngineId, setSelectedExternalEngineId] = React.useState('');
  const [externalEngineAuditFilter, setExternalEngineAuditFilter] = React.useState<ExternalEngineAuditAction>('all');
  const [authzAuditFilter, setAuthzAuditFilter] = React.useState<AuthzAuditFilterState>(DEFAULT_AUTHZ_AUDIT_FILTER);
  const [externalEngineReconcileSummary, setExternalEngineReconcileSummary] = React.useState<string | null>(null);
  const [selectedSsoSyncRunId, setSelectedSsoSyncRunId] = React.useState<string | null>(null);
  const [ssoDiagnosticsOptions, setSsoDiagnosticsOptions] = React.useState<SsoSyncDiagnosticsOptions>(DEFAULT_SSO_DIAGNOSTICS_OPTIONS);
  const [testClaims, setTestClaims] = React.useState('{\n  "email": "user@example.com",\n  "groups": ["Camunda Operators"]\n}');
  const roleDetailRoleId = roleModalOpen ? (editingRole?.id || duplicatingRole?.id) : undefined;
  const roleDetailQ = useRoleDetail(roleDetailRoleId);
  const selectedEngineSetQ = useEngineSet(selectedEngineSetId || undefined);
  const externalEngineAuditQ = useExternalEngineAudit(selectedExternalEngineId || undefined, { action: externalEngineAuditFilter, limit: 50 });
  const platformAuthzResource = React.useMemo(() => ({ type: 'platform' as const }), []);
  const rolesReadDecision = useActionDecision('platform.authz.roles.read', platformAuthzResource);
  const permissionsReadDecision = useActionDecision('platform.authz.permissions.read', platformAuthzResource);
  const rolesManageDecision = useActionDecision('platform.authz.roles.manage', platformAuthzResource);
  const assignmentsReadDecision = useActionDecision('platform.authz.assignments.read', platformAuthzResource);
  const assignmentsCreateDecision = useActionDecision('platform.authz.assignments.create', platformAuthzResource);
  const assignmentsDeleteDecision = useActionDecision('platform.authz.assignments.delete', platformAuthzResource);
  const groupsReadDecision = useActionDecision('platform.authz.groups.read', platformAuthzResource);
  const groupsManageDecision = useActionDecision('platform.authz.groups.manage', platformAuthzResource);
  const effectiveAccessDecision = useActionDecision('platform.authz.evaluate', platformAuthzResource);
  const ssoPlatformMappingsReadDecision = useActionDecision('platform.sso.platform-role-mappings.read', platformAuthzResource);
  const ssoPlatformMappingsManageDecision = useActionDecision('platform.sso.platform-role-mappings.manage', platformAuthzResource);
  const ssoGroupMappingsReadDecision = useActionDecision('platform.sso.group-mappings.read', platformAuthzResource);
  const ssoGroupMappingsManageDecision = useActionDecision('platform.sso.group-mappings.manage', platformAuthzResource);
  const ssoAssignmentsReadDecision = useActionDecision('platform.sso.engine-assignments.read', platformAuthzResource);
  const ssoAssignmentsManageDecision = useActionDecision('platform.sso.engine-assignments.manage', platformAuthzResource);
  const engineSetsReadDecision = useActionDecision('platform.engine-sets.read', platformAuthzResource);
  const engineSetsManageDecision = useActionDecision('platform.engine-sets.manage', platformAuthzResource);
  const projectTargetsReadDecision = useActionDecision('platform.project-engine-targets.read', platformAuthzResource);
  const projectTargetsManageDecision = useActionDecision('platform.project-engine-targets.manage', platformAuthzResource);
  const deploymentEligibilityDecision = useActionDecision('project.deployment-eligibility.evaluate', platformAuthzResource);
  const policiesReadDecision = useActionDecision('platform.authz.policies.read', platformAuthzResource);
  const policiesManageDecision = useActionDecision('platform.authz.policies.manage', platformAuthzResource);
  const auditReadDecision = useActionDecision('platform.audit.read', platformAuthzResource);
  const apiClientsReadDecision = useActionDecision('platform.api-clients.read', platformAuthzResource);
  const apiClientsManageDecision = useActionDecision('platform.api-clients.manage', platformAuthzResource);
  const serviceAccountsReadDecision = useActionDecision('platform.service-accounts.read', platformAuthzResource);
  const serviceAccountsManageDecision = useActionDecision('platform.service-accounts.manage', platformAuthzResource);
  const externalSystemsReadDecision = useActionDecision('platform.external-engine-systems.read', platformAuthzResource);
  const externalSystemsManageDecision = useActionDecision('platform.external-engine-systems.manage', platformAuthzResource);
  const externalEnginesReadDecision = useActionDecision('platform.external-engines.read', platformAuthzResource);
  const externalEngineAuditReadDecision = useActionDecision('platform.external-engines.audit.read', platformAuthzResource);
  const externalEngineReconcileDecision = useActionDecision('platform.external-engines.reconcile', platformAuthzResource);
  const externalEngineLifecycleDecision = useActionDecision('platform.external-engines.lifecycle.manage', platformAuthzResource);
  const externalEngineApiUpsertDecision = useActionDecision('engine.external-registration.upsert', platformAuthzResource);
  const externalEngineApiDecommissionDecision = useActionDecision('engine.external-registration.decommission', platformAuthzResource);
  const externalProjectTargetApiUpsertDecision = useActionDecision('project-engine-target.external-registration.upsert', platformAuthzResource);
  const externalProjectTargetApiDecommissionDecision = useActionDecision('project-engine-target.external-registration.decommission', platformAuthzResource);
  const runtimeResourceEnginesQ = useQuery({
    queryKey: ['authz-runtime-resource-engines'],
    enabled: engineSetsReadDecision.allowed,
    queryFn: () => apiClient.get<RuntimeResourceEngineOption[]>('/engines-api/engines'),
  });
  const runtimeResourcesQ = useQuery({
    queryKey: ['authz-runtime-resources', selectedRuntimeEngineId],
    enabled: engineSetsReadDecision.allowed && Boolean(selectedRuntimeEngineId),
    queryFn: () => apiClient.get<RuntimeResourceInventoryRow[]>(`/api/authz/runtime-resources?engineId=${encodeURIComponent(selectedRuntimeEngineId)}`),
  });
  const reconcileRuntimeResourcesM = useMutation({
    mutationFn: () => apiClient.post<{ created: number; updated: number; deactivated: number; materializedSets: number; deployments: { created: number; updated: number; artifactsCreated: number } }>(`/api/authz/runtime-resources/${encodeURIComponent(selectedRuntimeEngineId)}/reconcile`, {}),
    onSuccess: () => { void runtimeResourcesQ.refetch(); },
  });
  const assignmentsReadUnavailableReason = unavailableReason(assignmentsReadDecision, 'Missing permission platform:authz:roles:view');
  const ssoAssignmentsManageUnavailableReason = unavailableReason(ssoAssignmentsManageDecision, 'Missing permission platform:sso-assignments:manage');
  const engineSetsManageUnavailableReason = unavailableReason(engineSetsManageDecision, 'Missing permission platform:engine-sets:manage');
  const projectTargetsManageUnavailableReason = unavailableReason(projectTargetsManageDecision, 'Missing permission platform:project-engine-targets:manage');
  const deploymentEligibilityUnavailableReason = unavailableReason(deploymentEligibilityDecision, 'Missing permission platform:project-engine-targets:view');
  const policiesManageUnavailableReason = unavailableReason(policiesManageDecision, 'Missing permission platform:authz:roles:manage');
  const auditReadUnavailableReason = unavailableReason(auditReadDecision, 'Missing permission platform:audit:view');
  const apiClientsManageUnavailableReason = unavailableReason(apiClientsManageDecision, 'Missing permission platform:api-clients:manage');
  const serviceAccountsManageUnavailableReason = unavailableReason(serviceAccountsManageDecision, 'Missing permission platform:service-accounts:manage');
  const externalSystemsManageUnavailableReason = unavailableReason(externalSystemsManageDecision, 'Missing permission platform:engine-registration:manage');
  const externalEngineAuditReadUnavailableReason = unavailableReason(externalEngineAuditReadDecision, 'Missing permission platform:engine-registration:manage');
  const externalEngineReconcileUnavailableReason = unavailableReason(externalEngineReconcileDecision, 'Missing permission platform:engine-registration:manage');
  const externalEngineLifecycleUnavailableReason = unavailableReason(externalEngineLifecycleDecision, 'Missing permission platform:engine-registration:manage');
  const ssoSyncRunsQ = useSsoSyncRuns({ limit: 10 }, { enabled: ssoAssignmentsReadDecision.allowed });
  const ssoSyncEventsQ = useSsoSyncEvents(selectedSsoSyncRunId || undefined, { limit: 50 }, {
    enabled: ssoAssignmentsReadDecision.allowed && Boolean(selectedSsoSyncRunId),
  });
  const ssoEngineAccessSnapshotsQ = useSsoEngineAccessSnapshots({ limit: 25 }, { enabled: ssoAssignmentsReadDecision.allowed });
  const authzAuditQ = useAuthzAuditLog({
    userId: authzAuditFilter.userId.trim() || undefined,
    resourceType: authzAuditFilter.resourceType.trim() || undefined,
    resourceId: authzAuditFilter.resourceId.trim() || undefined,
    decision: authzAuditFilter.decision === 'all' ? undefined : authzAuditFilter.decision,
    limit: authzAuditFilter.limit,
  }, { enabled: auditReadDecision.allowed });
  const inspectionAuditQ = useAuthzAuditLog({ limit: 100 }, {
    enabled: auditReadDecision.allowed && (
      assignmentsReadDecision.allowed ||
      apiClientsReadDecision.allowed ||
      serviceAccountsReadDecision.allowed ||
      effectiveAccessDecision.allowed
    ),
  });
  const selectedEngineSetAuditQ = useAuthzAuditLog({
    resourceType: 'engine_set',
    resourceId: selectedEngineSetId,
    limit: 10,
  }, {
    enabled: auditReadDecision.allowed && engineSetsReadDecision.allowed && Boolean(selectedEngineSetId),
  });
  const canManageRoles = rolesManageDecision.allowed;
  const canManageSsoAssignments = ssoAssignmentsManageDecision.allowed;
  const showSsoMappingsTab = ssoPlatformMappingsReadDecision.allowed || ssoGroupMappingsReadDecision.allowed;
  const showExternalRegistrationTab = apiClientsReadDecision.allowed || serviceAccountsReadDecision.allowed || externalSystemsReadDecision.allowed || externalEnginesReadDecision.allowed;
  const hasVisibleTabs = rolesReadDecision.allowed ||
    permissionsReadDecision.allowed ||
    assignmentsReadDecision.allowed ||
    groupsReadDecision.allowed ||
    effectiveAccessDecision.allowed ||
    showSsoMappingsTab ||
    ssoAssignmentsReadDecision.allowed ||
    engineSetsReadDecision.allowed ||
    projectTargetsReadDecision.allowed ||
    policiesReadDecision.allowed ||
    auditReadDecision.allowed ||
    showExternalRegistrationTab;
  const visibleTabIds = React.useMemo<AccessControlTabId[]>(() => {
    const tabIds: AccessControlTabId[] = [];
    if (rolesReadDecision.allowed) tabIds.push('roles');
    if (permissionsReadDecision.allowed) tabIds.push('permissions');
    if (assignmentsReadDecision.allowed) {
      tabIds.push('assignments', 'by_principal', 'by_resource');
    }
    if (groupsReadDecision.allowed) tabIds.push('groups');
    if (effectiveAccessDecision.allowed) tabIds.push('effective_access');
    if (showSsoMappingsTab) tabIds.push('sso_mappings');
    if (ssoAssignmentsReadDecision.allowed) tabIds.push('sso_engine_assignments');
    if (engineSetsReadDecision.allowed) tabIds.push('engine_sets', 'runtime_resources');
    if (projectTargetsReadDecision.allowed) tabIds.push('project_targets');
    if (policiesReadDecision.allowed) tabIds.push('policies');
    if (auditReadDecision.allowed) tabIds.push('audit');
    if (showExternalRegistrationTab) tabIds.push('external_registration');
    return tabIds;
  }, [
    rolesReadDecision.allowed,
    permissionsReadDecision.allowed,
    assignmentsReadDecision.allowed,
    groupsReadDecision.allowed,
    effectiveAccessDecision.allowed,
    showSsoMappingsTab,
    ssoAssignmentsReadDecision.allowed,
    engineSetsReadDecision.allowed,
    projectTargetsReadDecision.allowed,
    policiesReadDecision.allowed,
    auditReadDecision.allowed,
    showExternalRegistrationTab,
  ]);
  const [selectedTabId, setSelectedTabId] = React.useState<AccessControlTabId>('roles');
  const selectedTabIndex = Math.max(0, visibleTabIds.indexOf(selectedTabId));

  React.useEffect(() => {
    if (visibleTabIds.length === 0 || visibleTabIds.includes(selectedTabId)) return;
    setSelectedTabId(visibleTabIds[0]);
  }, [selectedTabId, visibleTabIds]);

  const [roleForm, setRoleForm] = React.useState({
    name: '',
    description: '',
    scope: 'engine' as AuthzResourceType,
    permissionIds: [] as string[],
  });

  const [permissionForm, setPermissionForm] = React.useState({
    key: '',
    scope: 'project' as AuthzResourceType,
    category: '',
    label: '',
    description: '',
  });

  const [engineSetForm, setEngineSetForm] = React.useState<EngineSetFormState>(DEFAULT_ENGINE_SET_FORM);

  const [form, setForm] = React.useState({
    providerId: '',
    claimType: 'group' as SsoAssignmentMapping['claimType'],
    claimKey: 'groups',
    claimValue: '',
    claimOperator: '' as SsoClaimOperator | '',
    targetSelectorType: 'engine_id' as SsoAssignmentMapping['targetSelectorType'],
    targetEngineId: '',
    targetExternalEngineId: '',
    targetLabelKey: '',
    targetLabelValue: '',
    targetRoleId: 'system.engine.operator' as SsoAssignmentMapping['targetRoleId'],
    syncMode: 'authoritative' as SsoAssignmentMapping['syncMode'],
    priority: 0,
    isActive: true,
  });
  const ssoSelectedTargetRoleId = modalOpen && form.targetRoleId && !form.targetRoleId.startsWith('system.')
    ? form.targetRoleId
    : undefined;
  const ssoSelectedTargetRoleDetailQ = useRoleDetail(ssoSelectedTargetRoleId);

  const permissions = permissionsQ.data || [];
  const roles = rolesQ.data || [];
  const assignments = assignmentsQ.data || [];
  const groups = groupsQ.data || [];
  const groupMemberships = groupMembershipsQ.data || [];
  const apiClients = apiClientsQ.data || [];
  const serviceAccounts = serviceAccountsQ.data || [];
  const externalSystems = externalSystemsQ.data || [];
  const externalEngines = externalEnginesQ.data || [];
  const engineSets = engineSetsQ.data || [];
  const projectEngineTargets = projectEngineTargetsQ.data || [];
  const policies = policiesQ.data || [];
  const authzAuditEntries = authzAuditQ.data || [];
  const inspectionAuditEntries = inspectionAuditQ.data || [];
  const externalEngineAudit = externalEngineAuditQ.data || [];
  const ssoPlatformMappings = ssoPlatformMappingsQ.data || [];
  const ssoGroupMappings = ssoGroupMappingsQ.data || [];
  const mappings = mappingsQ.data || [];
  const ssoSyncRuns = ssoSyncRunsQ.data || [];
  const ssoSyncEvents = ssoSyncEventsQ.data || [];
  const ssoEngineAccessSnapshots = ssoEngineAccessSnapshotsQ.data || [];
  const staleSsoAssignments = React.useMemo(
    () => findStaleSsoAssignments(assignments, mappings),
    [assignments, mappings],
  );
  const ssoDiagnostics = React.useMemo(
    () => getSsoAssignmentDiagnostics(mappings, assignments, externalEngines),
    [assignments, externalEngines, mappings],
  );
  const ssoAllEnginesAssignmentMappingsEnabled = platformSettingsQ.data?.ssoAllEnginesAssignmentMappingsEnabled ?? true;
  const ssoEngineOwnerAssignmentMappingsEnabled = platformSettingsQ.data?.ssoEngineOwnerAssignmentMappingsEnabled ?? false;
  const ssoEngineDelegateAssignmentMappingsEnabled = platformSettingsQ.data?.ssoEngineDelegateAssignmentMappingsEnabled ?? false;
  const ssoRegexClaimMappingsEnabled = platformSettingsQ.data?.ssoRegexClaimMappingsEnabled ?? false;
  const ssoSecretViewMappingsEnabled = platformSettingsQ.data?.ssoSecretViewMappingsEnabled ?? false;
  const ssoUnredactedAuditMappingsEnabled = platformSettingsQ.data?.ssoUnredactedAuditMappingsEnabled ?? false;
  const ssoPermanentDeleteMappingsEnabled = platformSettingsQ.data?.ssoPermanentDeleteMappingsEnabled ?? false;
  const ssoTargetRoleOptions = React.useMemo(
    () => getSsoTargetRoleOptions(roles, {
      includeEngineOwner: ssoEngineOwnerAssignmentMappingsEnabled || form.targetRoleId === 'system.engine.owner',
      includeEngineDelegate: ssoEngineDelegateAssignmentMappingsEnabled || form.targetRoleId === 'system.engine.delegate',
    }),
    [form.targetRoleId, roles, ssoEngineDelegateAssignmentMappingsEnabled, ssoEngineOwnerAssignmentMappingsEnabled],
  );
  const ssoTargetSelectors = React.useMemo(() => {
    if (ssoAllEnginesAssignmentMappingsEnabled || form.targetSelectorType === 'all_engines') {
      return TARGET_SELECTORS;
    }
    return TARGET_SELECTORS.filter((selector) => selector.id !== 'all_engines');
  }, [form.targetSelectorType, ssoAllEnginesAssignmentMappingsEnabled]);

  React.useEffect(() => {
    if (!ssoAssignmentsReadDecision.allowed) {
      if (selectedSsoSyncRunId) setSelectedSsoSyncRunId(null);
      return;
    }
    if (ssoSyncRuns.length === 0) {
      if (selectedSsoSyncRunId) setSelectedSsoSyncRunId(null);
      return;
    }
    if (!selectedSsoSyncRunId || !ssoSyncRuns.some((run) => run.id === selectedSsoSyncRunId)) {
      setSelectedSsoSyncRunId(ssoSyncRuns[0].id);
    }
  }, [selectedSsoSyncRunId, ssoAssignmentsReadDecision.allowed, ssoSyncRuns]);

  React.useEffect(() => {
    const engines = runtimeResourceEnginesQ.data || [];
    if (!engineSetsReadDecision.allowed || engines.length === 0) {
      if (selectedRuntimeEngineId) setSelectedRuntimeEngineId('');
      return;
    }
    if (!engines.some((engine) => engine.id === selectedRuntimeEngineId)) {
      setSelectedRuntimeEngineId(engines[0].id);
    }
  }, [engineSetsReadDecision.allowed, runtimeResourceEnginesQ.data, selectedRuntimeEngineId]);
  const ssoAllEnginesBlockedBySettings =
    form.targetSelectorType === 'all_engines' &&
    form.isActive &&
    !ssoAllEnginesAssignmentMappingsEnabled;
  const ssoGovernanceRoleSelected = form.targetRoleId === 'system.engine.owner' || form.targetRoleId === 'system.engine.delegate';
  const ssoGovernanceRoleBlockedBySettings =
    form.isActive &&
    (
      (form.targetRoleId === 'system.engine.owner' && !ssoEngineOwnerAssignmentMappingsEnabled) ||
      (form.targetRoleId === 'system.engine.delegate' && !ssoEngineDelegateAssignmentMappingsEnabled)
    );
  const ssoPlatformRegexOperatorSelected = ssoClaimOperatorIsRegex(ssoPlatformForm.claimOperator || null);
  const ssoGroupRegexOperatorSelected = ssoClaimOperatorIsRegex(ssoGroupForm.claimOperator || null);
  const ssoRegexOperatorSelected = ssoClaimOperatorIsRegex(form.claimOperator || null);
  const ssoPlatformRegexBlockedBySettings = ssoPlatformForm.isActive && ssoPlatformRegexOperatorSelected && !ssoRegexClaimMappingsEnabled;
  const ssoGroupRegexBlockedBySettings = ssoGroupForm.isActive && ssoGroupRegexOperatorSelected && !ssoRegexClaimMappingsEnabled;
  const ssoRegexOperatorBlockedBySettings = form.isActive && ssoRegexOperatorSelected && !ssoRegexClaimMappingsEnabled;
  const ssoSelectedTargetPermissionIds = ssoSelectedTargetRoleDetailQ.data?.permissions || [];
  const ssoCustomSecretRoleSelected =
    form.isActive &&
    ssoSelectedTargetPermissionIds.some((permissionId) =>
      permissionId === 'engine:secrets:view' || permissionId === 'engine:secrets:manage'
    );
  const ssoCustomUnredactedAuditRoleSelected =
    form.isActive &&
    ssoSelectedTargetPermissionIds.some((permissionId) => permissionId === 'platform:audit:unredacted-view');
  const ssoCustomPermanentDeleteRoleSelected =
    form.isActive &&
    ssoSelectedTargetPermissionIds.some((permissionId) => permissionId === 'platform:users:permanent-delete' || permissionId.endsWith(':permanent-delete'));
  const ssoCustomSecretRoleBlockedBySettings = ssoCustomSecretRoleSelected && !ssoSecretViewMappingsEnabled;
  const ssoCustomUnredactedAuditRoleBlockedBySettings = ssoCustomUnredactedAuditRoleSelected && !ssoUnredactedAuditMappingsEnabled;
  const ssoCustomPermanentDeleteRoleBlockedBySettings = ssoCustomPermanentDeleteRoleSelected && !ssoPermanentDeleteMappingsEnabled;
  const ssoSensitivePermissionRiskLabels = [
    ...(ssoCustomSecretRoleSelected ? ['engine secret access'] : []),
    ...(ssoCustomUnredactedAuditRoleSelected ? ['unredacted audit access'] : []),
    ...(ssoCustomPermanentDeleteRoleSelected ? ['permanent-delete authority'] : []),
  ];
  const ssoSensitivePermissionRoleSelected =
    ssoCustomSecretRoleSelected ||
    ssoCustomUnredactedAuditRoleSelected ||
    ssoCustomPermanentDeleteRoleSelected;
  const ssoSensitivePermissionRoleBlockedBySettings =
    ssoCustomSecretRoleBlockedBySettings ||
    ssoCustomUnredactedAuditRoleBlockedBySettings ||
    ssoCustomPermanentDeleteRoleBlockedBySettings;
  const ssoPlatformRegexRequiresAcknowledgement =
    ssoPlatformForm.isActive && ssoPlatformRegexOperatorSelected && !ssoPlatformRegexBlockedBySettings;
  const ssoGroupRegexRequiresAcknowledgement =
    ssoGroupForm.isActive && ssoGroupRegexOperatorSelected && !ssoGroupRegexBlockedBySettings;
  const ssoHighRiskMappingSelected = form.targetSelectorType === 'all_engines' || ssoGovernanceRoleSelected || ssoRegexOperatorSelected || ssoSensitivePermissionRoleSelected;
  const ssoHighRiskMappingAcknowledgementSelected =
    form.targetSelectorType === 'all_engines' ||
    ssoRegexOperatorSelected ||
    ssoSensitivePermissionRoleSelected;
  const ssoHighRiskMappingRequiresAcknowledgement =
    form.isActive &&
    ssoHighRiskMappingAcknowledgementSelected &&
    !ssoAllEnginesBlockedBySettings &&
    !ssoRegexOperatorBlockedBySettings &&
    !ssoSensitivePermissionRoleBlockedBySettings;

  React.useEffect(() => {
    if (!roleDetailQ.data) return;
    if (editingRole) {
      setRoleForm({
        name: roleDetailQ.data.name,
        description: roleDetailQ.data.description || '',
        scope: roleDetailQ.data.scope,
        permissionIds: roleDetailQ.data.permissions,
      });
      return;
    }
    if (duplicatingRole) {
      setRoleForm({
        name: `Copy of ${roleDetailQ.data.name}`,
        description: roleDetailQ.data.description || '',
        scope: roleDetailQ.data.scope,
        permissionIds: roleDetailQ.data.permissions,
      });
    }
  }, [editingRole, duplicatingRole, roleDetailQ.data]);

  React.useEffect(() => {
    if (selectedGroupId && groups.some((group) => group.id === selectedGroupId)) return;
    setSelectedGroupId(groups.find((group) => !group.isArchived)?.id || groups[0]?.id || '');
  }, [groups, selectedGroupId]);

  const openCreateRole = () => {
    setEditingRole(null);
    setDuplicatingRole(null);
    setRoleRiskAcknowledged(false);
    setRoleForm({
      name: '',
      description: '',
      scope: 'engine',
      permissionIds: [],
    });
    setRoleModalOpen(true);
  };

  const openDuplicateRole = (role: RoleSummary) => {
    setEditingRole(null);
    setDuplicatingRole(role);
    setRoleRiskAcknowledged(false);
    setRoleForm({
      name: `Copy of ${role.name}`,
      description: role.description || '',
      scope: role.scope,
      permissionIds: [],
    });
    setRoleModalOpen(true);
  };

  const openEditRole = (role: RoleSummary) => {
    setEditingRole(role);
    setDuplicatingRole(null);
    setRoleRiskAcknowledged(false);
    setRoleForm({
      name: role.name,
      description: role.description || '',
      scope: role.scope,
      permissionIds: [],
    });
    setRoleModalOpen(true);
  };

  const submitRole = async () => {
    try {
      const payload = {
        name: roleForm.name,
        description: roleForm.description || null,
        permissionIds: roleForm.permissionIds,
      };
      if (editingRole) {
        await updateRoleM.mutateAsync({ id: editingRole.id, ...payload });
      } else {
        await createRoleM.mutateAsync({ ...payload, scope: roleForm.scope });
      }
      setRoleModalOpen(false);
      setEditingRole(null);
      setDuplicatingRole(null);
      setRoleRiskAcknowledged(false);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to save custom role').message);
    }
  };

  const updateRolePermissionsFromMatrix = async (role: RoleSummary, permissionIds: string[]) => {
    try {
      setMatrixSavingRoleId(role.id);
      await updateRoleM.mutateAsync({ id: role.id, permissionIds });
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to update role permissions').message);
    } finally {
      setMatrixSavingRoleId(null);
    }
  };

  const archiveRole = async (role: RoleSummary) => {
    try {
      await archiveRoleM.mutateAsync(role.id);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to archive custom role').message);
    }
  };

  const openCreatePermission = () => {
    setPermissionForm({
      key: '',
      scope: 'project',
      category: '',
      label: '',
      description: '',
    });
    setPermissionModalOpen(true);
  };

  const submitPermission = async () => {
    try {
      await createPermissionM.mutateAsync({
        key: permissionForm.key,
        scope: permissionForm.scope,
        category: permissionForm.category,
        label: permissionForm.label,
        description: permissionForm.description || null,
      });
      setPermissionModalOpen(false);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to create custom permission').message);
    }
  };

  const openCreateGroup = () => {
    setEditingGroup(null);
    setGroupForm(DEFAULT_AUTHZ_GROUP_FORM);
    setGroupModalOpen(true);
  };

  const openEditGroup = (group: AuthzGroup) => {
    setEditingGroup(group);
    setGroupForm({
      key: group.key,
      name: group.name,
      description: group.description || '',
    });
    setGroupModalOpen(true);
  };

  const submitGroup = async () => {
    try {
      const payload = {
        name: groupForm.name.trim(),
        description: groupForm.description.trim() || null,
      };
      if (editingGroup) {
        await updateGroupM.mutateAsync({ id: editingGroup.id, ...payload });
      } else {
        const result = await createGroupM.mutateAsync({
          ...payload,
          key: groupForm.key.trim() || undefined,
        });
        setSelectedGroupId(result.id);
      }
      setGroupModalOpen(false);
      setEditingGroup(null);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to save authorization group').message);
    }
  };

  const archiveGroup = async (id: string) => {
    try {
      await deleteGroupM.mutateAsync(id);
      if (selectedGroupId === id) setSelectedGroupId('');
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to archive authorization group').message);
    }
  };

  const addGroupMembership = async (userId: string) => {
    if (!selectedGroupId) return;
    try {
      await addGroupMembershipM.mutateAsync({ groupId: selectedGroupId, userId });
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to add group member').message);
    }
  };

  const removeGroupMembership = async (id: string) => {
    try {
      await removeGroupMembershipM.mutateAsync(id);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to remove group member').message);
    }
  };

  const openCreatePolicy = () => {
    setEditingPolicy(null);
    setPolicyForm(DEFAULT_AUTHZ_POLICY_FORM);
    setPolicyConditionsJson('{}');
    setPolicyModalOpen(true);
  };

  const openEditPolicy = (policy: AuthzPolicy) => {
    setEditingPolicy(policy);
    setPolicyForm({
      name: policy.name,
      description: policy.description || '',
      effect: policy.effect,
      priority: policy.priority,
      resourceType: policy.resourceType || '',
      action: policy.action || '',
    });
    setPolicyConditionsJson(getPolicyConditionsJson(policy));
    setPolicyModalOpen(true);
  };

  const submitPolicy = async () => {
    let conditions: PolicyCondition;
    try {
      conditions = JSON.parse(policyConditionsJson || '{}');
    } catch {
      setError('Policy conditions must be valid JSON.');
      return;
    }

    const payload = {
      name: policyForm.name.trim(),
      description: policyForm.description.trim() || undefined,
      effect: policyForm.effect,
      priority: policyForm.priority,
      resourceType: policyForm.resourceType || undefined,
      action: policyForm.action.trim() || undefined,
      conditions,
    };

    try {
      if (editingPolicy) {
        await updatePolicyM.mutateAsync({ id: editingPolicy.id, ...payload });
      } else {
        await createPolicyM.mutateAsync(payload);
      }
      setPolicyModalOpen(false);
      setEditingPolicy(null);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to save authorization policy').message);
    }
  };

  const togglePolicy = async (policy: AuthzPolicy) => {
    try {
      await updatePolicyM.mutateAsync({ id: policy.id, isActive: !policy.isActive });
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to update authorization policy').message);
    }
  };

  const deletePolicy = async (id: string) => {
    try {
      await deletePolicyM.mutateAsync(id);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to delete authorization policy').message);
    }
  };

  const openCreateEngineSet = () => {
    setEditingEngineSet(null);
    setEngineSetForm(DEFAULT_ENGINE_SET_FORM);
    setEngineSetRiskAcknowledged(false);
    previewEngineSetM.reset();
    setEngineSetModalOpen(true);
  };

  const openEditEngineSet = (engineSet: EngineSetSummary) => {
    setEditingEngineSet(engineSet);
    setEngineSetForm(engineSetFormFromSummary(engineSet));
    setEngineSetRiskAcknowledged(false);
    previewEngineSetM.reset();
    setEngineSetModalOpen(true);
  };

  const submitEngineSet = async () => {
    const selector = buildEngineSetSelector(engineSetForm);
    const riskReasons = getEngineSetSelectorRiskReasons(selector);
    try {
      const payload = {
        name: engineSetForm.name.trim(),
        description: engineSetForm.description.trim() || null,
        selector,
        ...(riskReasons.length > 0 ? { riskAcknowledged: engineSetRiskAcknowledged } : {}),
      };
      if (editingEngineSet) {
        await updateEngineSetM.mutateAsync({ id: editingEngineSet.id, ...payload });
      } else {
        await createEngineSetM.mutateAsync({
          ...payload,
          key: engineSetForm.key.trim() || undefined,
        });
      }
      setEngineSetModalOpen(false);
      setEditingEngineSet(null);
      setEngineSetRiskAcknowledged(false);
      previewEngineSetM.reset();
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to save Engine Set').message);
    }
  };

  const previewEngineSet = async () => {
    try {
      await previewEngineSetM.mutateAsync({ selector: buildEngineSetSelector(engineSetForm) });
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to preview Engine Set').message);
    }
  };

  const archiveEngineSet = async (id: string) => {
    try {
      await archiveEngineSetM.mutateAsync(id);
      if (selectedEngineSetId === id) setSelectedEngineSetId('');
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to archive Engine Set').message);
    }
  };

  const materializeEngineSet = async (id: string) => {
    try {
      const result = await materializeEngineSetM.mutateAsync(id);
      setEngineSetMaterializeSummary(`${result.matched} matched; ${result.created} created, ${result.updated} updated, ${result.removed} removed`);
      setSelectedEngineSetId(id);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to materialize Engine Set').message);
    }
  };

  const openCreateProjectTarget = () => {
    setEditingProjectTarget(null);
    setProjectTargetForm(DEFAULT_PROJECT_ENGINE_TARGET_FORM);
    setProjectTargetModalOpen(true);
  };

  const openEditProjectTarget = (target: ProjectEngineTarget) => {
    setEditingProjectTarget(target);
    setProjectTargetForm(projectEngineTargetFormFromTarget(target));
    setProjectTargetModalOpen(true);
  };

  const submitProjectTarget = async () => {
      const payload = projectEngineTargetPayloadFromForm(projectTargetForm);
      try {
        if (editingProjectTarget) {
        await updateProjectEngineTargetM.mutateAsync({
          id: editingProjectTarget.id,
          status: payload.status,
          source: payload.source,
          sourceRef: payload.sourceRef,
          externalSystemId: payload.externalSystemId,
          externalProjectId: payload.externalProjectId,
          externalEngineId: payload.externalEngineId,
          externalTargetId: payload.externalTargetId,
          allowManualDeploy: payload.allowManualDeploy,
          allowCiDeploy: payload.allowCiDeploy,
          allowApiDeploy: payload.allowApiDeploy,
          allowImport: payload.allowImport,
          policyTags: payload.policyTags,
        });
      } else {
        await createProjectEngineTargetM.mutateAsync(payload);
      }
      setProjectTargetModalOpen(false);
      setEditingProjectTarget(null);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to save project-engine target').message);
    }
  };

  const archiveProjectTarget = async (id: string) => {
    try {
      await archiveProjectEngineTargetM.mutateAsync(id);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to archive project-engine target').message);
    }
  };

  const syncLegacyProjectTargets = async (projectId: string) => {
    try {
      const result = await syncLegacyProjectEngineTargetsM.mutateAsync({ projectId });
      setProjectTargetSyncSummary(`${result.createdOrUpdated} target${result.createdOrUpdated === 1 ? '' : 's'} created or updated for ${projectId}`);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to sync legacy project-engine targets').message);
    }
  };

  const evaluateProjectTargetEligibility = async (form: { userId: string; projectId: string; engineId: string; mode: ProjectEngineTargetMode }) => {
    try {
      const result = await evaluateDeploymentEligibilityM.mutateAsync(form);
      setDeploymentEligibilityResult(result);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to evaluate deployment eligibility').message);
    }
  };

  const assignRole = async (assignment: {
    principalType: AssignmentPrincipalType;
    principalId: string;
    roleId: string;
    resourceType: CoreAssignmentResourceType;
    resourceId: string;
  }) => {
    try {
      const result = await assignRoleM.mutateAsync({
        principalType: assignment.principalType,
        principalId: assignment.principalId,
        roleId: assignment.roleId,
        resourceType: assignment.resourceType,
        resourceId: assignment.resourceType === 'platform' ? null : assignment.resourceId,
      });
      setAssignmentWarnings(result.warnings || []);
      setError(null);
    } catch (e) {
      setAssignmentWarnings([]);
      setError(parseApiError(e, 'Unable to assign role').message);
    }
  };

  const removeAssignment = async (assignmentId: string) => {
    try {
      await removeAssignmentM.mutateAsync(assignmentId);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to remove role assignment').message);
    }
  };

  const createApiClient = async (name: string, scopes: string[]) => {
    try {
      const result = await createApiClientM.mutateAsync({ name, scopes });
      setApiClientToken(result.token);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to create API client').message);
    }
  };

  const createServiceAccount = async (name: string, description: string, scopes: string[]) => {
    try {
      const result = await createServiceAccountM.mutateAsync({ name, description: description || null, scopes });
      setServiceAccountToken(result.token);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to create service account').message);
    }
  };

  const rotateApiClient = async (id: string) => {
    try {
      const result = await rotateApiClientM.mutateAsync(id);
      setApiClientToken(result.token);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to rotate API client').message);
    }
  };

  const rotateServiceAccount = async (id: string) => {
    try {
      const result = await rotateServiceAccountM.mutateAsync(id);
      setServiceAccountToken(result.token);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to rotate service account token').message);
    }
  };

  const revokeApiClient = async (id: string) => {
    try {
      await revokeApiClientM.mutateAsync(id);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to revoke API client').message);
    }
  };

  const revokeServiceAccount = async (id: string) => {
    try {
      await revokeServiceAccountM.mutateAsync(id);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to revoke service account').message);
    }
  };

  const createExternalSystem = async (payload: Required<Pick<ExternalEngineSystemPayload, 'name'>> & ExternalEngineSystemPayload) => {
    try {
      await createExternalSystemM.mutateAsync(payload);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to create external engine system').message);
    }
  };

  const updateExternalSystem = async (id: string, payload: ExternalEngineSystemPayload) => {
    try {
      await updateExternalSystemM.mutateAsync({ id, ...payload });
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to update external engine system').message);
    }
  };

  const archiveExternalSystem = async (id: string) => {
    try {
      await archiveExternalSystemM.mutateAsync(id);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to archive external engine system').message);
    }
  };

  const decommissionExternalEngine = async (id: string) => {
    try {
      await decommissionExternalEngineM.mutateAsync({
        id,
        reason: 'Decommissioned from Access Control',
      });
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to decommission external engine').message);
    }
  };

  const reactivateExternalEngine = async (id: string) => {
    try {
      await reactivateExternalEngineM.mutateAsync({
        id,
        reason: 'Reactivated from Access Control',
      });
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to reactivate external engine').message);
    }
  };

  const reconcileExternalEngine = async (id: string) => {
    try {
      const result = await reconcileExternalEngineM.mutateAsync(id);
      setExternalEngineReconcileSummary(formatReconcileSummary(result));
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to reconcile external engine').message);
    }
  };

  const roleScopePermissions = permissions.filter((permission) => permission.scope === roleForm.scope);
  const selectedRiskyRolePermissions = roleScopePermissions.filter(
    (permission) => roleForm.permissionIds.includes(permission.key) && getPermissionRisk(permission)
  );
  const selectedRoleScope = [
    { id: 'platform', label: 'Platform' },
    { id: 'project', label: 'Project' },
    { id: 'engine', label: 'Engine' },
  ].find((item) => item.id === roleForm.scope);
  const selectedPermissionScope = [
    { id: 'platform', label: 'Platform' },
    { id: 'project', label: 'Project' },
    { id: 'engine', label: 'Engine' },
  ].find((item) => item.id === permissionForm.scope);
  const customPermissionKeyValid = permissionForm.key.trim().toLowerCase().startsWith(`${permissionForm.scope}:custom:`);
  const engineSetSelector = buildEngineSetSelector(engineSetForm);
  const engineSetSelectorValid = engineSetSelector.mode === 'all'
    || (engineSetSelector.mode === 'engine_ids' && engineSetSelector.engineIds.length > 0)
    || (engineSetSelector.mode === 'labels' && Object.keys(engineSetSelector.labels).length > 0);
  const engineSetSelectorRiskReasons = getEngineSetSelectorRiskReasons(engineSetSelector);
  const engineSetHighRiskSelectorSelected = engineSetSelectorValid && engineSetSelectorRiskReasons.length > 0;
  const projectTargetFormValid = Boolean(
    projectTargetForm.projectId.trim() &&
    projectTargetForm.engineId.trim() &&
    (
      projectTargetForm.allowManualDeploy ||
      projectTargetForm.allowCiDeploy ||
      projectTargetForm.allowApiDeploy ||
      projectTargetForm.allowImport
    )
  );
  const selectedProjectTargetStatus = PROJECT_ENGINE_TARGET_STATUSES.find((item) => item.id === projectTargetForm.status) || PROJECT_ENGINE_TARGET_STATUSES[0];
  const selectedPolicyEffect = POLICY_EFFECTS.find((item) => item.id === policyForm.effect) || POLICY_EFFECTS[1];
  const selectedPolicyResourceType = POLICY_RESOURCE_TYPES.find((item) => item.id === policyForm.resourceType) || POLICY_RESOURCE_TYPES[0];
  const policyConditionsJsonValid = React.useMemo(() => {
    try {
      JSON.parse(policyConditionsJson || '{}');
      return true;
    } catch {
      return false;
    }
  }, [policyConditionsJson]);
  const toggleRolePermission = (permissionId: string, checked: boolean) => {
    setRoleForm((current) => ({
      ...current,
      permissionIds: checked
        ? Array.from(new Set([...current.permissionIds, permissionId]))
        : current.permissionIds.filter((id) => id !== permissionId),
    }));
  };

  const openCreateSsoPlatformMapping = () => {
    setEditingSsoPlatformMapping(null);
    setSsoPlatformRiskAcknowledged(false);
    setSsoPlatformForm(DEFAULT_SSO_PLATFORM_MAPPING_FORM);
    setSsoPlatformModalOpen(true);
  };

  const openEditSsoPlatformMapping = (mapping: SsoClaimsMapping) => {
    setEditingSsoPlatformMapping(mapping);
    setSsoPlatformRiskAcknowledged(false);
    setSsoPlatformForm({
      providerId: mapping.providerId || '',
      claimType: mapping.claimType,
      claimKey: mapping.claimKey,
      claimValue: mapping.claimValue,
      claimOperator: mapping.claimOperator || '',
      targetRole: mapping.targetRole,
      priority: mapping.priority,
      isActive: mapping.isActive,
    });
    setSsoPlatformModalOpen(true);
  };

  const submitSsoPlatformMapping = async () => {
    try {
      const payload = {
        ...ssoPlatformForm,
        providerId: ssoPlatformForm.providerId.trim() || null,
        claimKey: ssoPlatformForm.claimKey.trim(),
        claimValue: ssoPlatformForm.claimValue.trim(),
        claimOperator: ssoPlatformForm.claimOperator || null,
        ...(ssoPlatformRegexOperatorSelected
          ? { riskAcknowledged: ssoPlatformRiskAcknowledged }
          : {}),
      };
      if (editingSsoPlatformMapping) {
        await updateSsoPlatformMappingM.mutateAsync({ id: editingSsoPlatformMapping.id, ...payload });
      } else {
        await createSsoPlatformMappingM.mutateAsync(payload);
      }
      setSsoPlatformModalOpen(false);
      setEditingSsoPlatformMapping(null);
      setSsoPlatformRiskAcknowledged(false);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to save platform role SSO mapping').message);
    }
  };

  const deleteSsoPlatformMapping = async (id: string) => {
    try {
      await deleteSsoPlatformMappingM.mutateAsync(id);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to delete platform role SSO mapping').message);
    }
  };

  const testSsoPlatformMappings = async () => {
    try {
      await testSsoPlatformMappingM.mutateAsync({ claims: JSON.parse(testClaims) });
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to test platform role SSO mappings').message);
    }
  };

  const openCreateSsoGroupMapping = () => {
    setEditingSsoGroupMapping(null);
    setSsoGroupRiskAcknowledged(false);
    setSsoGroupForm({
      ...DEFAULT_SSO_GROUP_MAPPING_FORM,
      targetGroupId: groups.find((group) => !group.isArchived)?.id || '',
    });
    setSsoGroupModalOpen(true);
  };

  const openEditSsoGroupMapping = (mapping: SsoGroupMapping) => {
    setEditingSsoGroupMapping(mapping);
    setSsoGroupRiskAcknowledged(false);
    setSsoGroupForm({
      providerId: mapping.providerId || '',
      claimType: mapping.claimType,
      claimKey: mapping.claimKey,
      claimValue: mapping.claimValue,
      claimOperator: mapping.claimOperator || '',
      targetGroupId: mapping.targetGroupId,
      syncMode: mapping.syncMode,
      priority: mapping.priority,
      isActive: mapping.isActive,
    });
    setSsoGroupModalOpen(true);
  };

  const submitSsoGroupMapping = async () => {
    try {
      const payload = {
        ...ssoGroupForm,
        providerId: ssoGroupForm.providerId.trim() || null,
        claimKey: ssoGroupForm.claimKey.trim(),
        claimValue: ssoGroupForm.claimValue.trim(),
        claimOperator: ssoGroupForm.claimOperator || null,
        ...(ssoGroupRegexOperatorSelected
          ? { riskAcknowledged: ssoGroupRiskAcknowledged }
          : {}),
      };
      if (editingSsoGroupMapping) {
        await updateSsoGroupMappingM.mutateAsync({ id: editingSsoGroupMapping.id, ...payload });
      } else {
        await createSsoGroupMappingM.mutateAsync(payload);
      }
      setSsoGroupModalOpen(false);
      setEditingSsoGroupMapping(null);
      setSsoGroupRiskAcknowledged(false);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to save SSO group mapping').message);
    }
  };

  const deleteSsoGroupMapping = async (id: string) => {
    try {
      await deleteSsoGroupMappingM.mutateAsync(id);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to delete SSO group mapping').message);
    }
  };

  const testSsoGroupMappings = async () => {
    try {
      await testSsoGroupMappingM.mutateAsync({ claims: JSON.parse(testClaims) });
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to test SSO group mappings').message);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setSsoHighRiskAcknowledged(false);
    setForm({
      providerId: '',
      claimType: 'group',
      claimKey: 'groups',
      claimValue: '',
      claimOperator: '',
      targetSelectorType: 'engine_id',
      targetEngineId: '',
      targetExternalEngineId: '',
      targetLabelKey: '',
      targetLabelValue: '',
      targetRoleId: 'system.engine.operator',
      syncMode: 'authoritative',
      priority: 0,
      isActive: true,
    });
    setModalOpen(true);
  };

  const openEdit = (mapping: SsoAssignmentMapping) => {
    setEditing(mapping);
    setSsoHighRiskAcknowledged(false);
    setForm({
      providerId: mapping.providerId || '',
      claimType: mapping.claimType,
      claimKey: mapping.claimKey,
      claimValue: mapping.claimValue,
      claimOperator: mapping.claimOperator || '',
      targetSelectorType: mapping.targetSelectorType,
      targetEngineId: mapping.targetEngineId || '',
      targetExternalEngineId: mapping.targetExternalEngineId || '',
      targetLabelKey: mapping.targetLabelKey || '',
      targetLabelValue: mapping.targetLabelValue || '',
      targetRoleId: mapping.targetRoleId,
      syncMode: mapping.syncMode,
      priority: mapping.priority,
      isActive: mapping.isActive,
    });
    setModalOpen(true);
  };

  const submit = async () => {
    try {
      const payload = {
        ...form,
        providerId: form.providerId || null,
        claimOperator: form.claimOperator || null,
        targetEngineId: form.targetSelectorType === 'engine_id' ? form.targetEngineId || null : null,
        targetExternalEngineId: form.targetSelectorType === 'external_engine_id' ? form.targetExternalEngineId || null : null,
        targetLabelKey: form.targetSelectorType === 'engine_label' ? form.targetLabelKey || null : null,
        targetLabelValue: form.targetSelectorType === 'engine_label' ? form.targetLabelValue || null : null,
        ...(ssoHighRiskMappingRequiresAcknowledgement
          ? { riskAcknowledged: ssoHighRiskAcknowledged }
          : {}),
      };
      if (editing) {
        await updateM.mutateAsync({ id: editing.id, ...payload });
      } else {
        await createM.mutateAsync(payload);
      }
      setModalOpen(false);
      setSsoHighRiskAcknowledged(false);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to save SSO assignment mapping').message);
    }
  };

  const testAssignments = async () => {
    try {
      await testM.mutateAsync({ claims: JSON.parse(testClaims) });
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to test claims').message);
    }
  };

  const runSsoSyncDiagnostics = async () => {
    try {
      await runSsoSyncDiagnosticsM.mutateAsync({
        trigger: 'manual',
        includeProviderChecks: ssoDiagnosticsOptions.includeProviderChecks,
        includeSnapshotReplay: ssoDiagnosticsOptions.includeSnapshotReplay,
        refreshProviderClaims: ssoDiagnosticsOptions.includeSnapshotReplay && ssoDiagnosticsOptions.refreshProviderClaims,
        includeCleanup: ssoDiagnosticsOptions.includeCleanup,
      });
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to run SSO sync diagnostics').message);
    }
  };

  const openAuthzAuditReference = React.useCallback((entry: AuthzAuditEntry) => {
    setAuthzAuditFilter((current) => ({
      ...current,
      userId: entry.resourceType || entry.resourceId ? '' : entry.userId,
      resourceType: entry.resourceType || '',
      resourceId: entry.resourceId || '',
      decision: 'all',
      limit: Math.max(current.limit, 50),
    }));
    setSelectedTabId('audit');
  }, []);

  if (!hasVisibleTabs) {
    return (
      <PageLayout style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)' }}>
        <PageHeader
          icon={Security}
          title="Access Control"
          subtitle="Review system roles, permissions, effective access, and SSO engine assignments"
          gradient={PAGE_GRADIENTS.red}
        />
        <UnauthorizedEmptyState
          title="Access Control unavailable"
          reason="No Access Control read permissions are available for the current user."
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)' }}>
      <PageHeader
        icon={Security}
        title="Access Control"
        subtitle="Review system roles, permissions, effective access, and SSO engine assignments"
        gradient={PAGE_GRADIENTS.red}
      />

      {error && (
        <InlineNotification kind="error" title={error} onCloseButtonClick={() => setError(null)} lowContrast />
      )}

      <Tabs
        selectedIndex={selectedTabIndex}
        onChange={({ selectedIndex }: { selectedIndex: number }) => {
          const nextTabId = visibleTabIds[selectedIndex];
          if (nextTabId) setSelectedTabId(nextTabId);
        }}
      >
        <TabList aria-label="Access control tabs">
          {visibleTabIds.map((tabId) => <Tab key={tabId}>{ACCESS_CONTROL_TAB_LABELS[tabId]}</Tab>)}
        </TabList>
        <TabPanels>
          {rolesReadDecision.allowed && (
          <TabPanel>
            {rolesQ.isError ? (
              <InlineNotification kind="error" title="Unable to load roles" lowContrast />
            ) : (
              <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
                <RolesTable
                  roles={roles}
                  loading={rolesQ.isLoading}
                  onCreate={openCreateRole}
                  onEdit={openEditRole}
                  onDuplicate={openDuplicateRole}
                  onArchive={archiveRole}
                  canManage={canManageRoles}
                />
                <InlineNotification
                  kind="info"
                  lowContrast
                  hideCloseButton
                  title="Edit one role at a time"
                  subtitle="Use Edit for custom roles or Duplicate for system roles. The focused role editor keeps permissions scoped, avoids horizontal comparison tables, and requires acknowledgement for sensitive permissions."
                />
              </div>
            )}
          </TabPanel>
          )}
          {permissionsReadDecision.allowed && (
          <TabPanel>
            {permissionsQ.isError ? (
              <InlineNotification kind="error" title="Unable to load permissions" lowContrast />
            ) : (
              <PermissionsTable permissions={permissions} loading={permissionsQ.isLoading} onCreate={openCreatePermission} canManage={canManageRoles} />
            )}
          </TabPanel>
          )}
          {assignmentsReadDecision.allowed && (
          <TabPanel>
            {assignmentsQ.isError || groupsQ.isError ? (
              <InlineNotification kind="error" title="Unable to load role assignments" lowContrast />
            ) : (
              <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
              {assignmentWarnings.length > 0 && <InlineNotification kind="warning" lowContrast title="Broader engine access already applies" subtitle={assignmentWarnings.join(' ')} onCloseButtonClick={() => setAssignmentWarnings([])} />}
              <RoleAssignmentsPanel
                roles={roles}
                assignments={assignments}
                apiClients={apiClients}
                groups={groups}
                serviceAccounts={serviceAccounts}
                externalSystems={externalSystems}
                runtimeEngines={runtimeResourceEnginesQ.data || []}
                loading={assignmentsQ.isLoading || groupsQ.isLoading || serviceAccountsQ.isLoading}
                onAssign={assignRole}
                onRemove={removeAssignment}
                pending={assignRoleM.isPending || removeAssignmentM.isPending}
                canCreate={assignmentsCreateDecision.allowed}
                canDelete={assignmentsDeleteDecision.allowed}
              />
              </div>
            )}
          </TabPanel>
          )}
          {assignmentsReadDecision.allowed && (
          <TabPanel>
            {assignmentsQ.isError || (groupsReadDecision.allowed && (groupsQ.isError || groupMembershipsQ.isError)) ? (
              <InlineNotification kind="error" title="Unable to load principal access" lowContrast />
            ) : (
              <ByPrincipalPanel
                roles={roles}
                assignments={assignments}
                policies={policiesReadDecision.allowed ? policies : []}
                policyDataAvailable={policiesReadDecision.allowed}
                showPolicyInspection={selectedTabId === 'by_principal'}
                apiClients={apiClientsReadDecision.allowed ? apiClients : []}
                groups={groupsReadDecision.allowed ? groups : []}
                memberships={groupsReadDecision.allowed ? groupMemberships : []}
                serviceAccounts={serviceAccountsReadDecision.allowed ? serviceAccounts : []}
                externalSystems={externalSystemsReadDecision.allowed ? externalSystems : []}
                ssoGroupMappings={ssoGroupMappingsReadDecision.allowed ? ssoGroupMappings : []}
                ssoAssignmentMappings={ssoAssignmentsReadDecision.allowed ? mappings : []}
                auditEntries={auditReadDecision.allowed ? inspectionAuditEntries : []}
                onOpenAuditReference={auditReadDecision.allowed ? openAuthzAuditReference : undefined}
                loading={
                  assignmentsQ.isLoading ||
                  (groupsReadDecision.allowed && (groupsQ.isLoading || groupMembershipsQ.isLoading)) ||
                  (apiClientsReadDecision.allowed && apiClientsQ.isLoading) ||
                  (serviceAccountsReadDecision.allowed && serviceAccountsQ.isLoading) ||
                  (externalSystemsReadDecision.allowed && externalSystemsQ.isLoading) ||
                  (ssoGroupMappingsReadDecision.allowed && ssoGroupMappingsQ.isLoading) ||
                  (ssoAssignmentsReadDecision.allowed && mappingsQ.isLoading) ||
                  (policiesReadDecision.allowed && policiesQ.isLoading) ||
                  (auditReadDecision.allowed && inspectionAuditQ.isLoading)
                }
                groupDataAvailable={groupsReadDecision.allowed}
              />
            )}
          </TabPanel>
          )}
          {assignmentsReadDecision.allowed && (
          <TabPanel>
            {assignmentsQ.isError ? (
              <InlineNotification kind="error" title="Unable to load resource access" lowContrast />
            ) : (
              <ByResourcePanel
                roles={roles}
                assignments={assignments}
                policies={policiesReadDecision.allowed ? policies : []}
                policyDataAvailable={policiesReadDecision.allowed}
                showPolicyInspection={selectedTabId === 'by_resource'}
                apiClients={apiClientsReadDecision.allowed ? apiClients : []}
                groups={groupsReadDecision.allowed ? groups : []}
                serviceAccounts={serviceAccountsReadDecision.allowed ? serviceAccounts : []}
                externalSystems={externalSystemsReadDecision.allowed ? externalSystems : []}
                engineSets={engineSetsReadDecision.allowed ? engineSets : []}
                externalEngines={externalEnginesReadDecision.allowed ? externalEngines : []}
                projectTargets={projectTargetsReadDecision.allowed ? projectEngineTargets : []}
                ssoAssignmentMappings={ssoAssignmentsReadDecision.allowed ? mappings : []}
                auditEntries={auditReadDecision.allowed ? inspectionAuditEntries : []}
                onOpenAuditReference={auditReadDecision.allowed ? openAuthzAuditReference : undefined}
                loading={
                  assignmentsQ.isLoading ||
                  (apiClientsReadDecision.allowed && apiClientsQ.isLoading) ||
                  (groupsReadDecision.allowed && groupsQ.isLoading) ||
                  (serviceAccountsReadDecision.allowed && serviceAccountsQ.isLoading) ||
                  (externalSystemsReadDecision.allowed && externalSystemsQ.isLoading) ||
                  (engineSetsReadDecision.allowed && engineSetsQ.isLoading) ||
                  (externalEnginesReadDecision.allowed && externalEnginesQ.isLoading) ||
                  (projectTargetsReadDecision.allowed && projectEngineTargetsQ.isLoading) ||
                  (ssoAssignmentsReadDecision.allowed && mappingsQ.isLoading) ||
                  (policiesReadDecision.allowed && policiesQ.isLoading) ||
                  (auditReadDecision.allowed && inspectionAuditQ.isLoading)
                }
              />
            )}
          </TabPanel>
          )}
          {groupsReadDecision.allowed && (
          <TabPanel>
            {groupsQ.isError || groupMembershipsQ.isError ? (
              <InlineNotification kind="error" title="Unable to load authorization groups" lowContrast />
            ) : (
              <GroupsPanel
                groups={groups}
                memberships={groupMemberships}
                loading={groupsQ.isLoading}
                membershipsLoading={groupMembershipsQ.isLoading}
                pending={createGroupM.isPending || updateGroupM.isPending || deleteGroupM.isPending || addGroupMembershipM.isPending || removeGroupMembershipM.isPending}
                selectedGroupId={selectedGroupId}
                canManage={groupsManageDecision.allowed}
                onSelectGroup={setSelectedGroupId}
                onCreate={openCreateGroup}
                onEdit={openEditGroup}
                onArchive={archiveGroup}
                onAddMembership={addGroupMembership}
                onRemoveMembership={removeGroupMembership}
              />
            )}
          </TabPanel>
          )}
          {effectiveAccessDecision.allowed && (
          <TabPanel>
            <EffectiveAccess
              permissions={permissions}
              auditEntries={auditReadDecision.allowed ? inspectionAuditEntries : []}
              onOpenAuditReference={auditReadDecision.allowed ? openAuthzAuditReference : undefined}
            />
          </TabPanel>
          )}
          {showSsoMappingsTab && (
          <TabPanel>
            {ssoPlatformMappingsQ.isError || ssoGroupMappingsQ.isError ? (
              <InlineNotification kind="error" title="Unable to load SSO mappings" lowContrast />
            ) : (
              <SsoMappingsPanel
                platformMappings={ssoPlatformMappings}
                groupMappings={ssoGroupMappings}
                groups={groups}
                platformLoading={ssoPlatformMappingsQ.isLoading}
                groupLoading={ssoGroupMappingsQ.isLoading}
                testClaims={testClaims}
                platformTestResult={testSsoPlatformMappingM.data}
                groupTestResult={testSsoGroupMappingM.data}
                canReadPlatform={ssoPlatformMappingsReadDecision.allowed}
                canManagePlatform={ssoPlatformMappingsManageDecision.allowed}
                canReadGroups={ssoGroupMappingsReadDecision.allowed}
                canManageGroups={ssoGroupMappingsManageDecision.allowed}
                platformPending={createSsoPlatformMappingM.isPending || updateSsoPlatformMappingM.isPending || deleteSsoPlatformMappingM.isPending || testSsoPlatformMappingM.isPending}
                groupPending={createSsoGroupMappingM.isPending || updateSsoGroupMappingM.isPending || deleteSsoGroupMappingM.isPending || testSsoGroupMappingM.isPending}
                onTestClaimsChange={setTestClaims}
                onTestPlatform={testSsoPlatformMappings}
                onTestGroups={testSsoGroupMappings}
                onCreatePlatform={openCreateSsoPlatformMapping}
                onEditPlatform={openEditSsoPlatformMapping}
                onDeletePlatform={deleteSsoPlatformMapping}
                onCreateGroup={openCreateSsoGroupMapping}
                onEditGroup={openEditSsoGroupMapping}
                onDeleteGroup={deleteSsoGroupMapping}
              />
            )}
          </TabPanel>
          )}
          {ssoAssignmentsReadDecision.allowed && (
          <TabPanel>
            {mappingsQ.isLoading ? (
              <DataTableSkeleton headers={ssoAssignmentHeaders} rowCount={5} />
            ) : (
              <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
                {staleSsoAssignments.length > 0 && (
                  <InlineNotification
                    kind="warning"
                    title="Stale SSO assignments detected"
                    subtitle={`${staleSsoAssignments.length} SSO-managed assignment${staleSsoAssignments.length === 1 ? '' : 's'} reference missing mappings.`}
                    lowContrast
                  />
                )}
                <SsoAssignmentDiagnosticsPanel
                  diagnostics={ssoDiagnostics}
                  roles={roles}
                  testResult={testM.data}
                />
                <SsoSyncDiagnosticsPanel
                  runs={ssoSyncRuns}
                  events={ssoSyncEvents}
                  loading={ssoSyncRunsQ.isLoading}
                  eventsLoading={ssoSyncEventsQ.isLoading}
                  runsError={ssoSyncRunsQ.isError}
                  eventsError={ssoSyncEventsQ.isError}
                  selectedRunId={selectedSsoSyncRunId}
                  canRunDiagnostics={canManageSsoAssignments}
                  diagnosticsUnavailableReason={ssoAssignmentsManageUnavailableReason}
                  diagnosticsRunning={runSsoSyncDiagnosticsM.isPending}
                  lastDiagnosticsResult={runSsoSyncDiagnosticsM.data || null}
                  diagnosticsOptions={ssoDiagnosticsOptions}
                  onSelectRun={setSelectedSsoSyncRunId}
                  onRunDiagnostics={runSsoSyncDiagnostics}
                  onDiagnosticsOptionsChange={setSsoDiagnosticsOptions}
                />
                <SsoEngineAccessSnapshotsPanel
                  snapshots={ssoEngineAccessSnapshots}
                  roles={roles}
                  loading={ssoEngineAccessSnapshotsQ.isLoading}
                  error={ssoEngineAccessSnapshotsQ.isError}
                  canManageCleanup={canManageSsoAssignments}
                  cleanupUnavailableReason={ssoAssignmentsManageUnavailableReason}
                />
                <TableContainer>
                  <DataTable
                    rows={mappings.map((mapping) => ({
                      id: mapping.id,
                      claim: ssoClaimLabel(mapping),
                      target: selectorLabel(mapping),
                      role: roleLabel(mapping.targetRoleId, roles),
                      mode: mapping.syncMode,
                      status: mapping.isActive,
                      warning: getSsoAssignmentMappingWarning(mapping, externalEngines) || '',
                      actions: '',
                    }))}
                    headers={ssoAssignmentHeaders}
                  >
                    {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                      <>
                        <TableToolbar>
                          <TableToolbarContent>
                            <Button kind="ghost" size="sm" onClick={testAssignments} disabled={testM.isPending || !canManageSsoAssignments} title={ssoAssignmentsManageUnavailableReason}>
                              Test Claims
                            </Button>
                            <Button kind="primary" renderIcon={Add} onClick={openCreate} disabled={!canManageSsoAssignments} title={ssoAssignmentsManageUnavailableReason}>
                              Add Mapping
                            </Button>
                          </TableToolbarContent>
                        </TableToolbar>
                        <Table {...getTableProps()} size="md">
                          <TableHead>
                            <TableRow>
                              {headers.map((header) => (
                                <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                              ))}
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {rows.map((row) => {
                              const mapping = mappings.find((item) => item.id === row.id);
                              return (
                                <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                                  {row.cells.map((cell) => {
                                    if (cell.info.header === 'status') {
                                      return <TableCell key={cell.id}><Tag type={cell.value ? 'green' : 'gray'}>{cell.value ? 'Active' : 'Inactive'}</Tag></TableCell>;
                                    }
                                    if (cell.info.header === 'warning') {
                                      return <TableCell key={cell.id}>{cell.value ? <Tag type="gray">{cell.value}</Tag> : '-'}</TableCell>;
                                    }
                                    if (cell.info.header === 'actions') {
                                      return (
                                        <TableCell key={cell.id}>
                                          <Button kind="ghost" size="sm" disabled={!canManageSsoAssignments} title={ssoAssignmentsManageUnavailableReason} onClick={() => mapping && openEdit(mapping)}>Edit</Button>
                                          <Button kind="ghost" size="sm" disabled={!canManageSsoAssignments} title={ssoAssignmentsManageUnavailableReason} renderIcon={TrashCan} hasIconOnly iconDescription="Delete mapping" onClick={() => mapping && deleteM.mutate(mapping.id)} />
                                        </TableCell>
                                      );
                                    }
                                    return <TableCell key={cell.id}>{cell.value}</TableCell>;
                                  })}
                                </DataTableDataRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </>
                    )}
                  </DataTable>
                </TableContainer>
              </div>
            )}
            {testM.data && (
              <InlineNotification
                kind="info"
                title={`${(testM.data.assignments || []).length} assignment${(testM.data.assignments || []).length === 1 ? '' : 's'} would match`}
                subtitle={(testM.data.assignments || []).map((assignment) => `${assignment.roleId} -> ${assignment.resourceId || 'all engines'}`).join(', ') || 'No mappings matched'}
                lowContrast
              />
            )}
            <div style={{ marginTop: 'var(--spacing-4)' }}>
              <TextInput
                id="test-claims"
                labelText="Test claims JSON"
                value={testClaims}
                onChange={(event) => setTestClaims(event.target.value)}
              />
            </div>
          </TabPanel>
          )}
          {engineSetsReadDecision.allowed && (
          <TabPanel>
            {engineSetsQ.isError ? (
              <InlineNotification kind="error" title="Unable to load Engine Sets" lowContrast />
            ) : (
              <EngineSetsPanel
                engineSets={engineSets}
                selectedEngineSet={selectedEngineSetQ.data || null}
                assignments={assignments}
                apiClients={apiClients}
                groups={groups}
                serviceAccounts={serviceAccounts}
                auditEntries={selectedEngineSetAuditQ.data || []}
                loading={engineSetsQ.isLoading}
                detailLoading={selectedEngineSetQ.isLoading}
                assignmentLoading={assignmentsQ.isLoading}
                auditLoading={selectedEngineSetAuditQ.isLoading}
                materializeSummary={engineSetMaterializeSummary}
                onCreate={openCreateEngineSet}
                onEdit={openEditEngineSet}
                onArchive={archiveEngineSet}
                onMaterialize={materializeEngineSet}
                onSelect={setSelectedEngineSetId}
                pending={createEngineSetM.isPending || updateEngineSetM.isPending || archiveEngineSetM.isPending || materializeEngineSetM.isPending}
                canManage={engineSetsManageDecision.allowed}
                canReadAssignments={assignmentsReadDecision.allowed}
                canReadAudit={auditReadDecision.allowed}
                manageUnavailableReason={engineSetsManageUnavailableReason}
                assignmentsReadUnavailableReason={assignmentsReadUnavailableReason}
                auditReadUnavailableReason={auditReadUnavailableReason}
              />
            )}
          </TabPanel>
          )}
          {engineSetsReadDecision.allowed && (
          <TabPanel>
            <RuntimeResourcesPanel
              engines={runtimeResourceEnginesQ.data || []}
              selectedEngineId={selectedRuntimeEngineId}
              resources={runtimeResourcesQ.data || []}
              loading={runtimeResourceEnginesQ.isLoading || runtimeResourcesQ.isLoading}
              error={runtimeResourceEnginesQ.error || runtimeResourcesQ.error}
              canManage={engineSetsManageDecision.allowed}
              reconcilePending={reconcileRuntimeResourcesM.isPending}
              reconcileError={reconcileRuntimeResourcesM.error}
              reconcileResult={reconcileRuntimeResourcesM.data}
              onSelectEngine={setSelectedRuntimeEngineId}
              onReconcile={() => reconcileRuntimeResourcesM.mutate()}
            />
          </TabPanel>
          )}
          {projectTargetsReadDecision.allowed && (
          <TabPanel>
            {projectEngineTargetsQ.isError ? (
              <InlineNotification kind="error" title="Unable to load project-engine targets" lowContrast />
            ) : (
              <ProjectEngineTargetsPanel
                targets={projectEngineTargets}
                loading={projectEngineTargetsQ.isLoading}
                pending={createProjectEngineTargetM.isPending || updateProjectEngineTargetM.isPending || archiveProjectEngineTargetM.isPending || syncLegacyProjectEngineTargetsM.isPending || evaluateDeploymentEligibilityM.isPending}
                syncSummary={projectTargetSyncSummary}
                eligibilityResult={deploymentEligibilityResult}
                onCreate={openCreateProjectTarget}
                onEdit={openEditProjectTarget}
                onArchive={archiveProjectTarget}
                onSyncLegacy={syncLegacyProjectTargets}
                onEvaluate={evaluateProjectTargetEligibility}
                canManage={projectTargetsManageDecision.allowed}
                canEvaluate={deploymentEligibilityDecision.allowed}
                manageUnavailableReason={projectTargetsManageUnavailableReason}
                evaluateUnavailableReason={deploymentEligibilityUnavailableReason}
                externalProjectTargetApiUpsertDecision={externalProjectTargetApiUpsertDecision}
                externalProjectTargetApiDecommissionDecision={externalProjectTargetApiDecommissionDecision}
              />
            )}
          </TabPanel>
          )}
          {policiesReadDecision.allowed && (
          <TabPanel>
            {policiesQ.isError ? (
              <InlineNotification kind="error" title="Unable to load authorization policies" lowContrast />
            ) : (
              <PoliciesPanel
                policies={policies}
                loading={policiesQ.isLoading}
                pending={createPolicyM.isPending || updatePolicyM.isPending || deletePolicyM.isPending}
                canManage={policiesManageDecision.allowed}
                manageUnavailableReason={policiesManageUnavailableReason}
                onCreate={openCreatePolicy}
                onEdit={openEditPolicy}
                onToggle={togglePolicy}
                onDelete={deletePolicy}
              />
            )}
          </TabPanel>
          )}
          {auditReadDecision.allowed && (
          <TabPanel>
            {authzAuditQ.isError ? (
              <InlineNotification kind="error" title="Unable to load authorization audit events" lowContrast />
            ) : (
              <AuthzAuditPanel
                entries={authzAuditEntries}
                loading={authzAuditQ.isLoading}
                filters={authzAuditFilter}
                onFiltersChange={(patch) => setAuthzAuditFilter((current) => ({ ...current, ...patch }))}
                onClearFilters={() => setAuthzAuditFilter(DEFAULT_AUTHZ_AUDIT_FILTER)}
              />
            )}
          </TabPanel>
          )}
          {showExternalRegistrationTab && (
          <TabPanel>
            {apiClientsQ.isError || serviceAccountsQ.isError || externalSystemsQ.isError || externalEnginesQ.isError ? (
              <InlineNotification kind="error" title="Unable to load external registration data" lowContrast />
            ) : (
              <ApiClientsPanel
                clients={apiClients}
                serviceAccounts={serviceAccounts}
                loading={apiClientsQ.isLoading}
                serviceAccountsLoading={serviceAccountsQ.isLoading}
                pending={createApiClientM.isPending || createServiceAccountM.isPending || createExternalSystemM.isPending || updateExternalSystemM.isPending || archiveExternalSystemM.isPending || rotateApiClientM.isPending || rotateServiceAccountM.isPending || revokeApiClientM.isPending || revokeServiceAccountM.isPending || decommissionExternalEngineM.isPending || reactivateExternalEngineM.isPending || reconcileExternalEngineM.isPending}
                generatedToken={apiClientToken}
                generatedServiceAccountToken={serviceAccountToken}
                externalSystems={externalSystems}
                externalSystemsLoading={externalSystemsQ.isLoading}
                externalEngines={externalEngines}
                externalEnginesLoading={externalEnginesQ.isLoading}
	                selectedEngineId={selectedExternalEngineId}
	                auditFilter={externalEngineAuditFilter}
	                reconcileSummary={externalEngineReconcileSummary}
	                auditEntries={externalEngineAudit}
	                auditLoading={externalEngineAuditQ.isLoading}
	                machineAuditEntries={auditReadDecision.allowed ? inspectionAuditEntries : []}
	                machineAuditLoading={auditReadDecision.allowed && inspectionAuditQ.isLoading}
	                roleAssignments={assignmentsReadDecision.allowed ? assignments : []}
	                roleAssignmentsLoading={assignmentsReadDecision.allowed && assignmentsQ.isLoading}
	                onCreate={createApiClient}
                onCreateServiceAccount={createServiceAccount}
                onRotate={rotateApiClient}
                onRotateServiceAccount={rotateServiceAccount}
                onRevoke={revokeApiClient}
                onRevokeServiceAccount={revokeServiceAccount}
                onCreateExternalSystem={createExternalSystem}
                onUpdateExternalSystem={updateExternalSystem}
                onArchiveExternalSystem={archiveExternalSystem}
	                onSelectEngine={setSelectedExternalEngineId}
	                onReconcileEngine={reconcileExternalEngine}
	                onDecommissionEngine={decommissionExternalEngine}
	                onReactivateEngine={reactivateExternalEngine}
	                onAuditFilterChange={setExternalEngineAuditFilter}
	                onOpenMachineAuditReference={auditReadDecision.allowed ? openAuthzAuditReference : undefined}
	                canManageApiClients={apiClientsManageDecision.allowed}
	                canManageServiceAccounts={serviceAccountsManageDecision.allowed}
	                canManageExternalSystems={externalSystemsManageDecision.allowed}
	                canReadRoleAssignments={assignmentsReadDecision.allowed}
	                canReadAuthzAudit={auditReadDecision.allowed}
                canReadExternalEngineAudit={externalEngineAuditReadDecision.allowed}
                canReconcileExternalEngine={externalEngineReconcileDecision.allowed}
                canManageExternalEngineLifecycle={externalEngineLifecycleDecision.allowed}
                apiClientsManageUnavailableReason={apiClientsManageUnavailableReason}
                serviceAccountsManageUnavailableReason={serviceAccountsManageUnavailableReason}
                externalSystemsManageUnavailableReason={externalSystemsManageUnavailableReason}
                externalEngineAuditReadUnavailableReason={externalEngineAuditReadUnavailableReason}
                externalEngineReconcileUnavailableReason={externalEngineReconcileUnavailableReason}
                externalEngineLifecycleUnavailableReason={externalEngineLifecycleUnavailableReason}
                externalEngineApiUpsertDecision={externalEngineApiUpsertDecision}
                externalEngineApiDecommissionDecision={externalEngineApiDecommissionDecision}
              />
            )}
          </TabPanel>
          )}
        </TabPanels>
      </Tabs>

      <Modal
        open={permissionModalOpen}
        onRequestClose={() => setPermissionModalOpen(false)}
        onRequestSubmit={submitPermission}
        modalHeading="Create Custom Permission"
        primaryButtonText="Create"
        secondaryButtonText="Cancel"
        primaryButtonDisabled={
          !canManageRoles ||
          !permissionForm.key ||
          !customPermissionKeyValid ||
          !permissionForm.category ||
          !permissionForm.label ||
          createPermissionM.isPending
        }
      >
        <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
          <Dropdown
            id="custom-permission-scope"
            titleText="Scope"
            label="Select scope"
            items={[
              { id: 'platform', label: 'Platform' },
              { id: 'project', label: 'Project' },
              { id: 'engine', label: 'Engine' },
            ]}
            itemToString={(item) => item?.label || ''}
            selectedItem={selectedPermissionScope}
            onChange={({ selectedItem }) => {
              const scope = (selectedItem?.id || 'project') as AuthzResourceType;
              setPermissionForm((current) => ({ ...current, scope }));
            }}
          />
          <TextInput
            id="custom-permission-key"
            labelText="Permission key"
            value={permissionForm.key}
            invalid={Boolean(permissionForm.key) && !customPermissionKeyValid}
            invalidText={`Use ${permissionForm.scope}:custom:...`}
            onChange={(event) => setPermissionForm((current) => ({ ...current, key: event.target.value }))}
          />
          <TextInput
            id="custom-permission-category"
            labelText="Category"
            value={permissionForm.category}
            onChange={(event) => setPermissionForm((current) => ({ ...current, category: event.target.value }))}
          />
          <TextInput
            id="custom-permission-label"
            labelText="Label"
            value={permissionForm.label}
            onChange={(event) => setPermissionForm((current) => ({ ...current, label: event.target.value }))}
          />
          <TextInput
            id="custom-permission-description"
            labelText="Description"
            value={permissionForm.description}
            onChange={(event) => setPermissionForm((current) => ({ ...current, description: event.target.value }))}
          />
        </div>
      </Modal>

      <Modal
        open={groupModalOpen}
        onRequestClose={() => {
          setGroupModalOpen(false);
          setEditingGroup(null);
        }}
        onRequestSubmit={submitGroup}
        modalHeading={editingGroup ? 'Edit Group' : 'Create Group'}
        primaryButtonText={editingGroup ? 'Save' : 'Create'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={
          !groupsManageDecision.allowed ||
          !groupForm.name.trim() ||
          createGroupM.isPending ||
          updateGroupM.isPending
        }
      >
        <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
          <TextInput
            id="authz-group-key"
            labelText="Group key"
            helperText="Leave empty to generate a key from the group name."
            value={groupForm.key}
            disabled={Boolean(editingGroup)}
            onChange={(event) => setGroupForm((current) => ({ ...current, key: event.target.value }))}
          />
          <TextInput
            id="authz-group-name"
            labelText="Group name"
            value={groupForm.name}
            onChange={(event) => setGroupForm((current) => ({ ...current, name: event.target.value }))}
          />
          <TextArea
            id="authz-group-description"
            labelText="Description"
            value={groupForm.description}
            rows={3}
            onChange={(event) => setGroupForm((current) => ({ ...current, description: event.target.value }))}
          />
        </div>
      </Modal>

      <Modal
        open={roleModalOpen}
        onRequestClose={() => {
          setRoleModalOpen(false);
          setEditingRole(null);
          setDuplicatingRole(null);
          setRoleRiskAcknowledged(false);
        }}
        onRequestSubmit={submitRole}
        modalHeading={editingRole ? 'Edit Custom Role' : duplicatingRole ? 'Duplicate System Role' : 'Create Custom Role'}
        primaryButtonText={editingRole ? 'Save' : 'Create'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={
          !canManageRoles ||
          !roleForm.name ||
          roleForm.permissionIds.length === 0 ||
          (selectedRiskyRolePermissions.length > 0 && !roleRiskAcknowledged) ||
          createRoleM.isPending ||
          updateRoleM.isPending ||
          roleDetailQ.isLoading
        }
      >
        <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
          <TextInput
            id="custom-role-name"
            labelText="Role name"
            value={roleForm.name}
            onChange={(event) => setRoleForm((current) => ({ ...current, name: event.target.value }))}
          />
          <TextInput
            id="custom-role-description"
            labelText="Description"
            value={roleForm.description}
            onChange={(event) => setRoleForm((current) => ({ ...current, description: event.target.value }))}
          />
          <Dropdown
            id="custom-role-scope"
            titleText="Scope"
            label="Select scope"
            disabled={Boolean(editingRole || duplicatingRole)}
            items={[
              { id: 'platform', label: 'Platform' },
              { id: 'project', label: 'Project' },
              { id: 'engine', label: 'Engine' },
            ]}
            itemToString={(item) => item?.label || ''}
            selectedItem={selectedRoleScope}
            onChange={({ selectedItem }) => {
              const scope = (selectedItem?.id || 'engine') as AuthzResourceType;
              setRoleForm((current) => ({ ...current, scope, permissionIds: [] }));
            }}
          />
          <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
            <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>Permissions</div>
            <div style={{ display: 'grid', gap: 'var(--spacing-3)', maxHeight: 280, overflow: 'auto', padding: 'var(--spacing-3)', border: '1px solid var(--cds-border-subtle)' }}>
              {roleScopePermissions.map((permission) => (
                <Checkbox
                  key={permission.key}
                  id={`role-permission-${permission.key}`}
                  labelText={`${permission.label} (${permission.key})`}
                  checked={roleForm.permissionIds.includes(permission.key)}
                  onChange={(_event, { checked }) => toggleRolePermission(permission.key, Boolean(checked))}
                />
              ))}
            </div>
          </div>
          {selectedRiskyRolePermissions.length > 0 && (
            <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
              <InlineNotification
                kind="warning"
                title="Sensitive permissions selected"
                subtitle={selectedRiskyRolePermissions.map((permission) => permission.key).join(', ')}
                lowContrast
              />
              <Checkbox
                id="custom-role-risk-acknowledged"
                labelText="I understand this role includes sensitive permissions."
                checked={roleRiskAcknowledged}
                onChange={(_event, { checked }) => setRoleRiskAcknowledged(Boolean(checked))}
              />
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={engineSetModalOpen}
        onRequestClose={() => {
          setEngineSetModalOpen(false);
          setEditingEngineSet(null);
          setEngineSetRiskAcknowledged(false);
          previewEngineSetM.reset();
        }}
        onRequestSubmit={submitEngineSet}
        modalHeading={editingEngineSet ? 'Edit Engine Set' : 'Create Engine Set'}
        primaryButtonText={editingEngineSet ? 'Save' : 'Create'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={
          !engineSetsManageDecision.allowed ||
          !engineSetForm.name.trim() ||
          !engineSetSelectorValid ||
          (engineSetHighRiskSelectorSelected && !engineSetRiskAcknowledged) ||
          createEngineSetM.isPending ||
          updateEngineSetM.isPending
        }
      >
        <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
          <TextInput
            id="engine-set-key"
            labelText="Engine Set key"
            helperText="Leave empty to generate a key from the name."
            value={engineSetForm.key}
            disabled={Boolean(editingEngineSet)}
            onChange={(event) => setEngineSetForm((current) => ({ ...current, key: event.target.value }))}
          />
          <TextInput
            id="engine-set-name"
            labelText="Engine Set name"
            value={engineSetForm.name}
            onChange={(event) => setEngineSetForm((current) => ({ ...current, name: event.target.value }))}
          />
          <TextInput
            id="engine-set-description"
            labelText="Description"
            value={engineSetForm.description}
            onChange={(event) => setEngineSetForm((current) => ({ ...current, description: event.target.value }))}
          />
          <Dropdown
            id="engine-set-selector-mode"
            titleText="Selector"
            label="Select selector"
            items={[
              { id: 'labels', label: 'Label selector' },
              { id: 'engine_ids', label: 'Engine IDs' },
              { id: 'all', label: 'All engines' },
            ]}
            itemToString={(item) => item?.label || ''}
            selectedItem={[
              { id: 'labels', label: 'Label selector' },
              { id: 'engine_ids', label: 'Engine IDs' },
              { id: 'all', label: 'All engines' },
            ].find((item) => item.id === engineSetForm.selectorMode)}
            onChange={({ selectedItem }) => {
              const selectorMode = (selectedItem?.id || 'labels') as EngineSetSelectorMode;
              setEngineSetRiskAcknowledged(false);
              previewEngineSetM.reset();
              setEngineSetForm((current) => ({ ...current, selectorMode }));
            }}
          />
          <TextInput
            id="engine-set-engine-ids"
            labelText="Engine IDs"
            helperText="Comma-separated engine ids."
            disabled={engineSetForm.selectorMode !== 'engine_ids'}
            value={engineSetForm.engineIds}
            onChange={(event) => {
              setEngineSetRiskAcknowledged(false);
              previewEngineSetM.reset();
              setEngineSetForm((current) => ({ ...current, engineIds: event.target.value }));
            }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--spacing-4)' }}>
            <TextInput
              id="engine-set-label-key"
              labelText="Label key"
              disabled={engineSetForm.selectorMode !== 'labels'}
              value={engineSetForm.labelKey}
              onChange={(event) => {
                setEngineSetRiskAcknowledged(false);
                previewEngineSetM.reset();
                setEngineSetForm((current) => ({ ...current, labelKey: event.target.value }));
              }}
            />
            <TextInput
              id="engine-set-label-value"
              labelText="Label value"
              disabled={engineSetForm.selectorMode !== 'labels'}
              value={engineSetForm.labelValue}
              onChange={(event) => {
                setEngineSetRiskAcknowledged(false);
                previewEngineSetM.reset();
                setEngineSetForm((current) => ({ ...current, labelValue: event.target.value }));
              }}
            />
          </div>
          <Dropdown
            id="engine-set-label-match"
            titleText="Label match"
            label="Label match"
            disabled={engineSetForm.selectorMode !== 'labels'}
            items={[
              { id: 'all', label: 'All labels' },
              { id: 'any', label: 'Any label' },
            ]}
            itemToString={(item) => item?.label || ''}
            selectedItem={[
              { id: 'all', label: 'All labels' },
              { id: 'any', label: 'Any label' },
            ].find((item) => item.id === engineSetForm.labelMatch)}
            onChange={({ selectedItem }) => {
              setEngineSetRiskAcknowledged(false);
              previewEngineSetM.reset();
              setEngineSetForm((current) => ({ ...current, labelMatch: (selectedItem?.id || 'all') as 'all' | 'any' }));
            }}
          />
          {engineSetHighRiskSelectorSelected && (
            <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
              <InlineNotification
                kind="warning"
                title="Broad Engine Set selector"
                subtitle={engineSetSelectorRiskReasons.map(engineSetSelectorRiskDescription).join(' ')}
                lowContrast
              />
              <Checkbox
                id="engine-set-risk-acknowledged"
                labelText="I understand this selector can grant access across a broad set of engines."
                checked={engineSetRiskAcknowledged}
                onChange={(_event, { checked }) => setEngineSetRiskAcknowledged(Boolean(checked))}
              />
            </div>
          )}
          <div>
            <Button kind="ghost" size="sm" disabled={!engineSetsManageDecision.allowed || !engineSetSelectorValid || previewEngineSetM.isPending} title={engineSetsManageUnavailableReason} onClick={previewEngineSet}>
              Preview Selector
            </Button>
          </div>
          {previewEngineSetM.data?.warnings?.length ? (
            <InlineNotification
              kind="warning"
              title="Selector breadth warning"
              subtitle={previewEngineSetM.data.warnings.join(' ')}
              lowContrast
            />
          ) : null}
          {previewEngineSetM.data && (
            <InlineNotification
              kind="info"
              title={`${(previewEngineSetM.data.matchedEngines || []).length} engine${(previewEngineSetM.data.matchedEngines || []).length === 1 ? '' : 's'} match`}
              subtitle={(previewEngineSetM.data.matchedEngines || []).map((engine) => engine.engineName || engine.engineId).join(', ') || 'No engines matched the selector.'}
              lowContrast
            />
          )}
        </div>
      </Modal>

      <Modal
        open={projectTargetModalOpen}
        onRequestClose={() => {
          setProjectTargetModalOpen(false);
          setEditingProjectTarget(null);
        }}
        onRequestSubmit={submitProjectTarget}
        modalHeading={editingProjectTarget ? 'Edit Project Target' : 'Create Project Target'}
        primaryButtonText={editingProjectTarget ? 'Save' : 'Create'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={
          !projectTargetsManageDecision.allowed ||
          !projectTargetFormValid ||
          createProjectEngineTargetM.isPending ||
          updateProjectEngineTargetM.isPending
        }
      >
        <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-4)' }}>
            <TextInput
              id="project-target-project-id"
              labelText="Project ID"
              disabled={Boolean(editingProjectTarget)}
              value={projectTargetForm.projectId}
              onChange={(event) => setProjectTargetForm((current) => ({ ...current, projectId: event.target.value }))}
            />
            <TextInput
              id="project-target-engine-id"
              labelText="Engine ID"
              disabled={Boolean(editingProjectTarget)}
              value={projectTargetForm.engineId}
              onChange={(event) => setProjectTargetForm((current) => ({ ...current, engineId: event.target.value }))}
            />
            <Dropdown
              id="project-target-status"
              titleText="Status"
              label="Status"
              items={PROJECT_ENGINE_TARGET_STATUSES}
              itemToString={(item) => item?.label || ''}
              selectedItem={selectedProjectTargetStatus}
              onChange={({ selectedItem }) => setProjectTargetForm((current) => ({ ...current, status: (selectedItem?.id || 'active') as ProjectEngineTargetStatus }))}
            />
          </div>

          <div style={{ display: 'flex', gap: 'var(--spacing-4)', flexWrap: 'wrap' }}>
            <Checkbox id="project-target-allow-manual" labelText="Manual deploy" checked={projectTargetForm.allowManualDeploy} onChange={(_event, { checked }) => setProjectTargetForm((current) => ({ ...current, allowManualDeploy: Boolean(checked) }))} />
            <Checkbox id="project-target-allow-ci" labelText="CI deploy" checked={projectTargetForm.allowCiDeploy} onChange={(_event, { checked }) => setProjectTargetForm((current) => ({ ...current, allowCiDeploy: Boolean(checked) }))} />
            <Checkbox id="project-target-allow-api" labelText="API deploy" checked={projectTargetForm.allowApiDeploy} onChange={(_event, { checked }) => setProjectTargetForm((current) => ({ ...current, allowApiDeploy: Boolean(checked) }))} />
            <Checkbox id="project-target-allow-import" labelText="Import" checked={projectTargetForm.allowImport} onChange={(_event, { checked }) => setProjectTargetForm((current) => ({ ...current, allowImport: Boolean(checked) }))} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-4)' }}>
            <TextInput
              id="project-target-source-ref"
              labelText="Source reference"
              value={projectTargetForm.sourceRef}
              onChange={(event) => setProjectTargetForm((current) => ({ ...current, sourceRef: event.target.value }))}
            />
            <TextInput
              id="project-target-external-system-id"
              labelText="External system ID"
              value={projectTargetForm.externalSystemId}
              onChange={(event) => setProjectTargetForm((current) => ({ ...current, externalSystemId: event.target.value }))}
            />
            <TextInput
              id="project-target-external-project-id"
              labelText="External project ID"
              value={projectTargetForm.externalProjectId}
              onChange={(event) => setProjectTargetForm((current) => ({ ...current, externalProjectId: event.target.value }))}
            />
            <TextInput
              id="project-target-external-engine-id"
              labelText="External engine ID"
              value={projectTargetForm.externalEngineId}
              onChange={(event) => setProjectTargetForm((current) => ({ ...current, externalEngineId: event.target.value }))}
            />
            <TextInput
              id="project-target-external-target-id"
              labelText="External target ID"
              value={projectTargetForm.externalTargetId}
              onChange={(event) => setProjectTargetForm((current) => ({ ...current, externalTargetId: event.target.value }))}
            />
            <TextInput
              id="project-target-policy-tags"
              labelText="Policy tags"
              helperText="Comma-separated tags."
              value={projectTargetForm.policyTags}
              onChange={(event) => setProjectTargetForm((current) => ({ ...current, policyTags: event.target.value }))}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={policyModalOpen}
        onRequestClose={() => {
          setPolicyModalOpen(false);
          setEditingPolicy(null);
        }}
        onRequestSubmit={submitPolicy}
        modalHeading={editingPolicy ? 'Edit Policy' : 'Add Policy'}
        primaryButtonText={editingPolicy ? 'Save' : 'Create'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={
          !policiesManageDecision.allowed ||
          !policyForm.name.trim() ||
          !policyConditionsJsonValid ||
          createPolicyM.isPending ||
          updatePolicyM.isPending
        }
        size="lg"
      >
        <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
          <TextInput
            id="policy-name"
            labelText="Policy name"
            value={policyForm.name}
            onChange={(event) => setPolicyForm((current) => ({ ...current, name: event.target.value }))}
          />
          <TextArea
            id="policy-description"
            labelText="Description"
            value={policyForm.description}
            rows={2}
            onChange={(event) => setPolicyForm((current) => ({ ...current, description: event.target.value }))}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-4)' }}>
            <Dropdown
              id="policy-effect"
              titleText="Effect"
              label="Effect"
              items={POLICY_EFFECTS}
              itemToString={(item) => item?.label || ''}
              selectedItem={selectedPolicyEffect}
              onChange={({ selectedItem }) => setPolicyForm((current) => ({ ...current, effect: selectedItem?.id || 'deny' }))}
            />
            <NumberInput
              id="policy-priority"
              label="Priority"
              min={0}
              max={1000}
              value={policyForm.priority}
              onChange={(_event, { value }) => setPolicyForm((current) => ({ ...current, priority: Number(value) || 0 }))}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-4)' }}>
            <Dropdown
              id="policy-resource-type"
              titleText="Resource"
              label="Resource"
              items={POLICY_RESOURCE_TYPES}
              itemToString={(item) => item?.label || ''}
              selectedItem={selectedPolicyResourceType}
              onChange={({ selectedItem }) => setPolicyForm((current) => ({ ...current, resourceType: selectedItem?.id || '' }))}
            />
            <TextInput
              id="policy-action"
              labelText="Action or permission"
              helperText="Leave empty to match all actions on the selected resource type."
              value={policyForm.action}
              onChange={(event) => setPolicyForm((current) => ({ ...current, action: event.target.value }))}
            />
          </div>
          <TextArea
            id="policy-conditions"
            labelText="Conditions JSON"
            value={policyConditionsJson}
            rows={8}
            invalid={!policyConditionsJsonValid}
            invalidText="Conditions must be valid JSON."
            onChange={(event) => setPolicyConditionsJson(event.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={ssoPlatformModalOpen}
        onRequestClose={() => {
          setSsoPlatformModalOpen(false);
          setEditingSsoPlatformMapping(null);
          setSsoPlatformRiskAcknowledged(false);
        }}
        onRequestSubmit={submitSsoPlatformMapping}
        modalHeading={editingSsoPlatformMapping ? 'Edit Platform Role SSO Mapping' : 'Add Platform Role SSO Mapping'}
        primaryButtonText={editingSsoPlatformMapping ? 'Save' : 'Create'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={
          !ssoPlatformMappingsManageDecision.allowed ||
          !ssoPlatformForm.claimKey.trim() ||
          (ssoClaimOperatorRequiresValue(ssoPlatformForm.claimOperator || null) && !ssoPlatformForm.claimValue.trim()) ||
          (ssoPlatformRegexRequiresAcknowledgement && !ssoPlatformRiskAcknowledged) ||
          ssoPlatformRegexBlockedBySettings ||
          createSsoPlatformMappingM.isPending ||
          updateSsoPlatformMappingM.isPending
        }
      >
        <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
          <TextInput
            id="sso-platform-provider-id"
            labelText="Provider ID"
            helperText="Leave empty to match any SSO provider."
            value={ssoPlatformForm.providerId}
            onChange={(event) => setSsoPlatformForm((current) => ({ ...current, providerId: event.target.value }))}
          />
          <Dropdown
            id="sso-platform-claim-type"
            titleText="Claim type"
            label="Select claim type"
            items={CLAIM_TYPES}
            itemToString={(item) => item?.label || ''}
            selectedItem={CLAIM_TYPES.find((item) => item.id === ssoPlatformForm.claimType)}
            onChange={({ selectedItem }) => {
              const claimType = (selectedItem?.id || 'group') as SsoClaimsMapping['claimType'];
              setSsoPlatformForm((current) => ({
                ...current,
                claimType,
                claimKey: ssoClaimDefaultKey(claimType) || current.claimKey,
              }));
            }}
          />
          <TextInput
            id="sso-platform-claim-key"
            labelText="Claim key"
            value={ssoPlatformForm.claimKey}
            onChange={(event) => setSsoPlatformForm((current) => ({ ...current, claimKey: event.target.value }))}
          />
          <Dropdown
            id="sso-platform-claim-operator"
            titleText="Claim operator"
            label="Select operator"
            items={CLAIM_OPERATORS}
            itemToString={(item) => item?.label || ''}
            selectedItem={CLAIM_OPERATORS.find((item) => item.id === ssoPlatformForm.claimOperator) || CLAIM_OPERATORS[0]}
            onChange={({ selectedItem }) => {
              setSsoPlatformRiskAcknowledged(false);
              setSsoPlatformForm((current) => ({
                ...current,
                claimOperator: selectedItem?.id || '',
              }));
            }}
          />
          <TextInput
            id="sso-platform-claim-value"
            labelText="Claim value"
            disabled={!ssoClaimOperatorRequiresValue(ssoPlatformForm.claimOperator || null)}
            value={ssoPlatformForm.claimValue}
            onChange={(event) => setSsoPlatformForm((current) => ({ ...current, claimValue: event.target.value }))}
          />
          {ssoPlatformRegexOperatorSelected && (
            <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
              <InlineNotification
                kind={ssoPlatformRegexBlockedBySettings ? 'error' : 'warning'}
                title="Regex claim mapping"
                subtitle={ssoPlatformRegexBlockedBySettings
                  ? 'Platform settings currently block active regex SSO claim mappings. Disable this mapping or enable the platform setting before saving.'
                  : 'Regex claim matching can grant platform roles broadly if the expression is too broad.'}
                lowContrast
              />
              {ssoPlatformRegexRequiresAcknowledgement && (
                <Checkbox
                  id="sso-platform-regex-risk-acknowledged"
                  labelText="I understand this mapping uses regex claim matching."
                  checked={ssoPlatformRiskAcknowledged}
                  onChange={(_event, { checked }) => setSsoPlatformRiskAcknowledged(Boolean(checked))}
                />
              )}
            </div>
          )}
          <Dropdown
            id="sso-platform-target-role"
            titleText="Target platform role"
            label="Select role"
            items={SSO_PLATFORM_TARGET_ROLES}
            itemToString={(item) => item?.label || ''}
            selectedItem={SSO_PLATFORM_TARGET_ROLES.find((item) => item.id === ssoPlatformForm.targetRole)}
            onChange={({ selectedItem }) => setSsoPlatformForm((current) => ({ ...current, targetRole: (selectedItem?.id || 'user') as SsoClaimsMapping['targetRole'] }))}
          />
          <NumberInput
            id="sso-platform-priority"
            label="Priority"
            value={ssoPlatformForm.priority}
            min={0}
            max={1000}
            onChange={(_event, { value }) => setSsoPlatformForm((current) => ({ ...current, priority: Number(value) || 0 }))}
          />
          <Toggle
            id="sso-platform-active"
            labelText="Active"
            labelA="Inactive"
            labelB="Active"
            toggled={ssoPlatformForm.isActive}
            onToggle={(checked) => setSsoPlatformForm((current) => ({ ...current, isActive: checked }))}
          />
        </div>
      </Modal>

      <Modal
        open={ssoGroupModalOpen}
        onRequestClose={() => {
          setSsoGroupModalOpen(false);
          setEditingSsoGroupMapping(null);
          setSsoGroupRiskAcknowledged(false);
        }}
        onRequestSubmit={submitSsoGroupMapping}
        modalHeading={editingSsoGroupMapping ? 'Edit SSO Group Mapping' : 'Add SSO Group Mapping'}
        primaryButtonText={editingSsoGroupMapping ? 'Save' : 'Create'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={
          !ssoGroupMappingsManageDecision.allowed ||
          !ssoGroupForm.claimKey.trim() ||
          (ssoClaimOperatorRequiresValue(ssoGroupForm.claimOperator || null) && !ssoGroupForm.claimValue.trim()) ||
          !ssoGroupForm.targetGroupId ||
          (ssoGroupRegexRequiresAcknowledgement && !ssoGroupRiskAcknowledged) ||
          ssoGroupRegexBlockedBySettings ||
          createSsoGroupMappingM.isPending ||
          updateSsoGroupMappingM.isPending
        }
      >
        <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
          <TextInput
            id="sso-group-provider-id"
            labelText="Provider ID"
            helperText="Leave empty to match any SSO provider."
            value={ssoGroupForm.providerId}
            onChange={(event) => setSsoGroupForm((current) => ({ ...current, providerId: event.target.value }))}
          />
          <Dropdown
            id="sso-group-claim-type"
            titleText="Claim type"
            label="Select claim type"
            items={CLAIM_TYPES}
            itemToString={(item) => item?.label || ''}
            selectedItem={CLAIM_TYPES.find((item) => item.id === ssoGroupForm.claimType)}
            onChange={({ selectedItem }) => {
              const claimType = (selectedItem?.id || 'group') as SsoGroupMapping['claimType'];
              setSsoGroupForm((current) => ({
                ...current,
                claimType,
                claimKey: ssoClaimDefaultKey(claimType) || current.claimKey,
              }));
            }}
          />
          <TextInput
            id="sso-group-claim-key"
            labelText="Claim key"
            value={ssoGroupForm.claimKey}
            onChange={(event) => setSsoGroupForm((current) => ({ ...current, claimKey: event.target.value }))}
          />
          <Dropdown
            id="sso-group-claim-operator"
            titleText="Claim operator"
            label="Select operator"
            items={CLAIM_OPERATORS}
            itemToString={(item) => item?.label || ''}
            selectedItem={CLAIM_OPERATORS.find((item) => item.id === ssoGroupForm.claimOperator) || CLAIM_OPERATORS[0]}
            onChange={({ selectedItem }) => {
              setSsoGroupRiskAcknowledged(false);
              setSsoGroupForm((current) => ({
                ...current,
                claimOperator: selectedItem?.id || '',
              }));
            }}
          />
          <TextInput
            id="sso-group-claim-value"
            labelText="Claim value"
            disabled={!ssoClaimOperatorRequiresValue(ssoGroupForm.claimOperator || null)}
            value={ssoGroupForm.claimValue}
            onChange={(event) => setSsoGroupForm((current) => ({ ...current, claimValue: event.target.value }))}
          />
          {ssoGroupRegexOperatorSelected && (
            <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
              <InlineNotification
                kind={ssoGroupRegexBlockedBySettings ? 'error' : 'warning'}
                title="Regex claim mapping"
                subtitle={ssoGroupRegexBlockedBySettings
                  ? 'Platform settings currently block active regex SSO claim mappings. Disable this mapping or enable the platform setting before saving.'
                  : 'Regex claim matching can add users to groups broadly if the expression is too broad.'}
                lowContrast
              />
              {ssoGroupRegexRequiresAcknowledgement && (
                <Checkbox
                  id="sso-group-regex-risk-acknowledged"
                  labelText="I understand this mapping uses regex claim matching."
                  checked={ssoGroupRiskAcknowledged}
                  onChange={(_event, { checked }) => setSsoGroupRiskAcknowledged(Boolean(checked))}
                />
              )}
            </div>
          )}
          <Dropdown
            id="sso-group-target-group"
            titleText="Target group"
            label="Select group"
            items={groups.filter((group) => !group.isArchived)}
            itemToString={(item) => item?.name || ''}
            selectedItem={groups.find((group) => group.id === ssoGroupForm.targetGroupId) || null}
            onChange={({ selectedItem }) => setSsoGroupForm((current) => ({ ...current, targetGroupId: selectedItem?.id || '' }))}
          />
          <Dropdown
            id="sso-group-sync-mode"
            titleText="Sync mode"
            label="Select sync mode"
            items={SYNC_MODES}
            itemToString={(item) => item?.label || ''}
            selectedItem={SYNC_MODES.find((item) => item.id === ssoGroupForm.syncMode)}
            onChange={({ selectedItem }) => setSsoGroupForm((current) => ({ ...current, syncMode: (selectedItem?.id || 'authoritative') as SsoGroupMapping['syncMode'] }))}
          />
          <NumberInput
            id="sso-group-priority"
            label="Priority"
            value={ssoGroupForm.priority}
            min={0}
            max={1000}
            onChange={(_event, { value }) => setSsoGroupForm((current) => ({ ...current, priority: Number(value) || 0 }))}
          />
          <Toggle
            id="sso-group-active"
            labelText="Active"
            labelA="Inactive"
            labelB="Active"
            toggled={ssoGroupForm.isActive}
            onToggle={(checked) => setSsoGroupForm((current) => ({ ...current, isActive: checked }))}
          />
        </div>
      </Modal>

      <Modal
        open={modalOpen}
        onRequestClose={() => {
          setModalOpen(false);
          setSsoHighRiskAcknowledged(false);
        }}
        onRequestSubmit={submit}
        modalHeading={editing ? 'Edit SSO Engine Assignment' : 'Add SSO Engine Assignment'}
        primaryButtonText={editing ? 'Save' : 'Create'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={
          !canManageSsoAssignments ||
          (ssoClaimOperatorRequiresValue(form.claimOperator || null) && !form.claimValue.trim()) ||
          (form.targetSelectorType === 'engine_id' && !form.targetEngineId) ||
          (form.targetSelectorType === 'external_engine_id' && !form.targetExternalEngineId) ||
          (form.targetSelectorType === 'engine_label' && (!form.targetLabelKey || !form.targetLabelValue)) ||
          (ssoHighRiskMappingRequiresAcknowledgement && !ssoHighRiskAcknowledged) ||
          ssoAllEnginesBlockedBySettings ||
          ssoGovernanceRoleBlockedBySettings ||
          ssoRegexOperatorBlockedBySettings ||
          ssoSensitivePermissionRoleBlockedBySettings ||
          Boolean(ssoSelectedTargetRoleId && ssoSelectedTargetRoleDetailQ.isLoading) ||
          createM.isPending ||
          updateM.isPending
        }
      >
        <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
          <TextInput
            id="provider-id"
            labelText="Provider ID"
            helperText="Leave empty to match provider-agnostic mappings."
            value={form.providerId}
            onChange={(event) => setForm((current) => ({ ...current, providerId: event.target.value }))}
          />
          <Dropdown
            id="claim-type"
            titleText="Claim type"
            label="Select claim type"
            items={CLAIM_TYPES}
            itemToString={(item) => item?.label || ''}
            selectedItem={CLAIM_TYPES.find((item) => item.id === form.claimType)}
            onChange={({ selectedItem }) => {
              const claimType = (selectedItem?.id || 'group') as SsoAssignmentMapping['claimType'];
              setForm((current) => ({
                ...current,
                claimType,
                claimKey: claimType === 'group' ? 'groups' : claimType === 'role' ? 'roles' : claimType === 'email_domain' ? 'email' : current.claimKey,
              }));
            }}
          />
          <TextInput id="claim-key" labelText="Claim key" value={form.claimKey} onChange={(event) => setForm((current) => ({ ...current, claimKey: event.target.value }))} />
          <Dropdown
            id="claim-operator"
            titleText="Claim operator"
            label="Select operator"
            items={CLAIM_OPERATORS}
            itemToString={(item) => item?.label || ''}
            selectedItem={CLAIM_OPERATORS.find((item) => item.id === form.claimOperator) || CLAIM_OPERATORS[0]}
            onChange={({ selectedItem }) => {
              setSsoHighRiskAcknowledged(false);
              setForm((current) => ({
                ...current,
                claimOperator: selectedItem?.id || '',
              }));
            }}
          />
          <TextInput id="claim-value" labelText="Claim value" disabled={!ssoClaimOperatorRequiresValue(form.claimOperator || null)} value={form.claimValue} onChange={(event) => setForm((current) => ({ ...current, claimValue: event.target.value }))} />
          <Dropdown
            id="target-selector"
            titleText="Target selector"
            label="Select target"
            items={ssoTargetSelectors}
            itemToString={(item) => item?.label || ''}
            selectedItem={ssoTargetSelectors.find((item) => item.id === form.targetSelectorType)}
            onChange={({ selectedItem }) => {
              const targetSelectorType = (selectedItem?.id || 'engine_id') as SsoAssignmentMapping['targetSelectorType'];
              setSsoHighRiskAcknowledged(false);
              setForm((current) => ({ ...current, targetSelectorType }));
            }}
          />
          {ssoHighRiskMappingSelected && (
            <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
              {form.targetSelectorType === 'all_engines' && (
                <InlineNotification
                  kind={ssoAllEnginesBlockedBySettings ? 'error' : 'warning'}
                  title="All-engine assignment mapping"
                  subtitle={ssoAllEnginesBlockedBySettings
                    ? 'Platform settings currently block active all-engine SSO mappings. Disable this mapping or enable the platform setting before saving.'
                    : 'This mapping can grant the selected engine role on every active engine that SSO reconciliation sees.'}
                  lowContrast
                />
              )}
              {ssoGovernanceRoleSelected && (
                <InlineNotification
                  kind={ssoGovernanceRoleBlockedBySettings ? 'error' : 'warning'}
                  title="Engine governance assignment mapping"
                  subtitle={ssoGovernanceRoleBlockedBySettings
                    ? 'Platform settings currently block active SSO mappings to this engine governance role. Disable this mapping or enable the platform setting before saving.'
                    : 'This mapping creates effective engine owner or delegate grants from SSO claims. It does not change accountable owner metadata.'}
                  lowContrast
                />
              )}
              {ssoRegexOperatorSelected && (
                <InlineNotification
                  kind={ssoRegexOperatorBlockedBySettings ? 'error' : 'warning'}
                  title="Regex claim mapping"
                  subtitle={ssoRegexOperatorBlockedBySettings
                    ? 'Platform settings currently block active regex SSO claim mappings. Disable this mapping or enable the platform setting before saving.'
                    : 'Regex claim matching can grant engine roles broadly if the expression is too broad.'}
                  lowContrast
                />
              )}
              {ssoSensitivePermissionRoleSelected && (
                <InlineNotification
                  kind={ssoSensitivePermissionRoleBlockedBySettings ? 'error' : 'warning'}
                  title="Sensitive permission assignment mapping"
                  subtitle={ssoSensitivePermissionRoleBlockedBySettings
                    ? `Platform settings currently block active SSO mappings to custom roles with ${ssoSensitivePermissionRiskLabels.join(', ')}. Disable this mapping or enable the matching platform setting before saving.`
                    : `This mapping can grant ${ssoSensitivePermissionRiskLabels.join(', ')} from SSO claims through the selected custom role.`}
                  lowContrast
                />
              )}
              {ssoHighRiskMappingRequiresAcknowledgement && (
                <Checkbox
                  id="sso-high-risk-acknowledged"
                  labelText={ssoSensitivePermissionRoleSelected
                    ? `I understand this mapping can grant ${ssoSensitivePermissionRiskLabels.join(', ')} from SSO claims.`
                    : ssoRegexOperatorSelected
                    ? 'I understand this mapping uses regex claim matching.'
                    : 'I understand this mapping can grant access to all active engines.'}
                  checked={ssoHighRiskAcknowledged}
                  onChange={(_event, { checked }) => setSsoHighRiskAcknowledged(Boolean(checked))}
                />
              )}
            </div>
          )}
          <TextInput
            id="target-engine-id"
            labelText="Target engine ID"
            disabled={form.targetSelectorType !== 'engine_id'}
            value={form.targetEngineId}
            onChange={(event) => setForm((current) => ({ ...current, targetEngineId: event.target.value }))}
          />
          <TextInput
            id="target-external-engine-id"
            labelText="External engine ID"
            disabled={form.targetSelectorType !== 'external_engine_id'}
            value={form.targetExternalEngineId}
            onChange={(event) => setForm((current) => ({ ...current, targetExternalEngineId: event.target.value }))}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--spacing-4)' }}>
            <TextInput
              id="target-label-key"
              labelText="Label key"
              disabled={form.targetSelectorType !== 'engine_label'}
              value={form.targetLabelKey}
              onChange={(event) => setForm((current) => ({ ...current, targetLabelKey: event.target.value }))}
            />
            <TextInput
              id="target-label-value"
              labelText="Label value"
              disabled={form.targetSelectorType !== 'engine_label'}
              value={form.targetLabelValue}
              onChange={(event) => setForm((current) => ({ ...current, targetLabelValue: event.target.value }))}
            />
          </div>
          <Dropdown
            id="target-role"
            titleText="Target role"
            label="Select role"
            items={ssoTargetRoleOptions}
            itemToString={(item) => item?.label || ''}
            selectedItem={ssoTargetRoleOptions.find((item) => item.id === form.targetRoleId)}
            onChange={({ selectedItem }) => {
              setSsoHighRiskAcknowledged(false);
              setForm((current) => ({ ...current, targetRoleId: selectedItem?.id || 'system.engine.operator' }));
            }}
          />
          <Dropdown
            id="sync-mode"
            titleText="Sync mode"
            label="Select sync mode"
            items={SYNC_MODES}
            itemToString={(item) => item?.label || ''}
            selectedItem={SYNC_MODES.find((item) => item.id === form.syncMode)}
            onChange={({ selectedItem }) => setForm((current) => ({ ...current, syncMode: (selectedItem?.id || 'authoritative') as SsoAssignmentMapping['syncMode'] }))}
          />
          <NumberInput id="priority" label="Priority" value={form.priority} min={0} max={1000} onChange={(_event, { value }) => setForm((current) => ({ ...current, priority: Number(value) || 0 }))} />
          <Toggle
            id="mapping-active"
            labelText="Active"
            labelA="Inactive"
            labelB="Active"
            toggled={form.isActive}
            onToggle={(checked) => {
              setSsoHighRiskAcknowledged(false);
              setForm((current) => ({ ...current, isActive: checked }));
            }}
          />
        </div>
      </Modal>
    </PageLayout>
  );
}
