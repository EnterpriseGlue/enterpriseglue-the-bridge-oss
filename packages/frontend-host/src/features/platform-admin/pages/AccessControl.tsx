import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
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
import type { UiAuthzDecision } from '@enterpriseglue/shared/authz/permission-actions.js';
import {
  formatCapabilityDiagnostics,
  formatEngineSetMatchedBy,
  formatEngineSetSelector,
  formatFieldOwnership,
  formatLabels,
  formatReconcileSummary,
  formatStatusLabel,
} from './accessControlPresentation';
import {
  AuthzAuditPanel,
  AssignmentSourceTag,
  DEFAULT_AUTHZ_AUDIT_FILTER,
  EffectiveAccessPanel,
  PolicyInspectionTable,
  type AuthzAuditFilterState,
} from './access-control';
import { effectiveAccessSourceHeaders, type CoreAssignmentResourceType } from './access-control/effectiveAccessPresentation';
import { accessControlTabFromSearchParams, type AccessControlTabId } from './access-control/accessControlTabPresentation';
import { getAssignableRolesForPrincipal, type AssignmentPrincipalType } from './access-control/assignmentFormOptions';
import { DataTableDataRow, DataTableHeaderCell, dataTableHeaderKey } from './access-control/dataTablePrimitives';
import { findIdentityEntitlementMappingForMembership, joinLineageParts } from './access-control/inspectionLineage';
import {
  AuditReferenceLinks,
  findAssignmentAuditEntries,
  findMachineIdentityAuditEntries,
  findMembershipAuditEntries,
  formatAuditReferences,
} from './access-control/auditReferences';
import { PermissionCatalogPanel, RoleCatalogPanel } from './access-control/RoleCatalogPanels';
import { RuntimeResourcesPanel } from './access-control/RuntimeResourcesPanel';
import { getAccessibleEngines } from '../../mission-control/engines/api/engines';
import { PoliciesPanel } from './access-control/PoliciesPanel';
import { GroupsPanel } from './access-control/GroupsPanel';
import { EngineSetsPanel } from './access-control/EngineSetsPanel';
import { ProjectEngineTargetsTab } from './access-control/ProjectEngineTargetsTab';
import { RoleAssignmentsPanel } from './access-control/RoleAssignmentsPanel';
import { ByPrincipalPanel, ByResourcePanel } from './access-control/PrincipalResourcePanels';
import { ExternalRegistrationTab } from './access-control/ExternalRegistrationTab';
import type { ResourceSummary } from './access-control/principalResourcePresentation';
import {
  filterPermissions,
  getPermissionImplications,
  getPermissionRisk,
} from './access-control/rolePermissionPresentation';
import type { RoleScopeFilter } from './access-control/roleScopePresentation';
export { getAssignableRolesForPrincipal } from './access-control/assignmentFormOptions';
export { filterPermissions, getPermissionImplications, getPermissionRisk } from './access-control/rolePermissionPresentation';
export { buildPrincipalSummaries, buildResourceSummaries } from './access-control/principalResourcePresentation';
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
  useDeletePolicy,
  useDecommissionExternalEngine,
  useDeleteAuthzGroup,
  useEngineSet,
  useEngineSets,
  useEvaluateDeploymentEligibility,
  useExternalEngineSystems,
  useExternalEngineAudit,
  useExternalEngines,
  useIdentityEntitlementMappings,
  useArchiveEngineSet,
  usePermissionCatalog,
  useMaterializeEngineSet,
  usePreviewEngineSetSelector,
  useProjectEngineTargets,
  useRbacRoles,
  useReactivateExternalEngine,
  useReconcileExternalEngine,
  useReconcileRuntimeResources,
  useRevokeApiClient,
  useRevokeServiceAccount,
  useRotateApiClient,
  useRotateServiceAccount,
  useRemoveAuthzGroupMembership,
  useRemoveRoleAssignment,
  useRoleAssignments,
  useRoleDetail,
  useServiceAccounts,
  useUpdateCustomRole,
  useUpdateAuthzGroup,
  useUpdateEngineSet,
  useUpdateExternalEngineSystem,
  useUpdatePolicy,
  useUpdateProjectEngineTarget,
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
  type ExternalEngineRegistrationAuditEntry,
  type ExternalEngineSystem,
  type ExternalEngineSystemCreatePayload,
  type ExternalEngineSystemUpdatePayload,
  type EngineSetDetail,
  type EngineSetSelector,
  type EngineSetSummary,
  type EngineFieldOwnership,
  type EngineManagementMode,
  type IdentityEntitlementMapping,
  type ProjectEngineTarget,
  type ProjectEngineTargetMode,
  type ProjectEngineTargetStatus,
  type PolicyCondition,
  type RoleAssignment,
  type RoleSummary,
  type RuntimeResource,
  type ServiceAccount,
  type AuthzResourceType,
} from '../hooks/useAuthzApi';

function unavailableReason(decision: UiAuthzDecision, fallback: string): string | undefined {
  return decision.allowed ? undefined : decision.reason || fallback;
}


const roleAssignmentHeaders = [
  { key: 'principal', header: 'Principal' },
  { key: 'role', header: 'Role' },
  { key: 'resource', header: 'Resource' },
  { key: 'source', header: 'Source' },
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

const ACCESS_CONTROL_TAB_LABELS: Record<AccessControlTabId, string> = {
  roles: 'Roles',
  permissions: 'Permissions',
  assignments: 'Assignments',
  by_principal: 'By Principal',
  by_resource: 'By Resource',
  groups: 'Groups',
  effective_access: 'Effective Access',
  engine_sets: 'Engine Sets',
  runtime_resources: 'Runtime Resources',
  project_targets: 'Project Targets',
  policies: 'Policies',
  audit: 'Audit',
  external_registration: 'External Registration',
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

function scopeTag(scope: string) {
  if (scope === 'platform') return <Tag type="purple">Platform</Tag>;
  if (scope === 'tenant') return <Tag type="magenta">Tenant</Tag>;
  if (scope === 'project') return <Tag type="blue">Project</Tag>;
  if (scope === 'external_engine_system') return <Tag type="cyan">External system</Tag>;
  return <Tag type="teal">Engine</Tag>;
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


function formatTimestamp(value: number | null | undefined) {
  return value ? new Date(value).toLocaleString() : '-';
}

function formatAssignmentPrincipal(
  assignment: RoleAssignment,
  apiClients: ApiClient[],
  groups: AuthzGroup[],
  serviceAccounts: ServiceAccount[],
) {
  const principalType = assignment.principalType || 'user';
  const principalId = assignment.principalId || assignment.userId;
  if (principalType === 'api_client') return `API client: ${apiClients.find((item) => item.id === principalId)?.name || principalId}`;
  if (principalType === 'group') return `Group: ${groups.find((item) => item.id === principalId)?.name || principalId}`;
  if (principalType === 'service_account') return `Service account: ${serviceAccounts.find((item) => item.id === principalId)?.name || principalId}`;
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

function isMembershipEffective(membership: AuthzGroupMembership, now = Date.now()) {
  return !membership.expiresAt || membership.expiresAt > now;
}

function roleAssignmentPrincipalMatches(assignment: RoleAssignment, type: AssignmentPrincipalType, id: string) {
  return getAssignmentPrincipalType(assignment) === type && getAssignmentPrincipalId(assignment) === id;
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

function assignmentResourceMatches(assignment: RoleAssignment, resource: ResourceSummary) {
  return getAssignmentResourceType(assignment) === resource.type && getAssignmentResourceId(assignment) === resource.id;
}

function formatIdentityEntitlementMappingForInspection(mapping: IdentityEntitlementMapping) {
  const value = mapping.matchOperator === 'exists' ? 'any value' : mapping.externalId || '-';
  return `Identity mapping: ${mapping.providerKey} ${mapping.entitlementType} ${mapping.matchOperator} ${value} -> ${mapping.targetGroupKey} (${mapping.syncMode})`;
}


function formatAssignmentLineage(
  assignment: RoleAssignment,
  roles: RoleSummary[] = [],
) {
  const parts = [
    assignment.sourceRef ? `ref=${assignment.sourceRef}` : '',
    assignment.createdById ? `createdBy=${assignment.createdById}` : '',
    assignment.lastSeenAt ? `lastSeen=${formatTimestamp(assignment.lastSeenAt)}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join('; ') : '-';
}

function formatMembershipLineage(membership: AuthzGroupMembership, identityEntitlementMappings: IdentityEntitlementMapping[] = []) {
  const identityMapping = findIdentityEntitlementMappingForMembership(membership, identityEntitlementMappings);
  const parts = [
    identityMapping ? formatIdentityEntitlementMappingForInspection(identityMapping) : '',
    membership.sourceRef ? `ref=${membership.sourceRef}` : '',
    membership.createdById ? `createdBy=${membership.createdById}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join('; ') : '-';
}

const principalResourcePanelHelpers = {
  formatAssignmentResource,
  formatAssignmentLineage,
  formatMembershipLineage,
  formatTimestamp,
  formatAssignmentPrincipal,
  getAssignmentPrincipalType,
  getAssignmentPrincipalId,
  principalTypeLabel,
  isMembershipEffective,
  roleAssignmentPrincipalMatches,
  authzResourceTypeLabel,
  assignmentResourceMatches,
  getPolicyInspectionRowsForAssignments,
  getPolicyInspectionRowsForResource,
};

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


export default function AccessControl() {
  const [searchParams, setSearchParams] = useSearchParams();
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
  const identityEntitlementMappingsQ = useIdentityEntitlementMappings();
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
  const [apiClientToken, setApiClientToken] = React.useState<string | null>(null);
  const [serviceAccountToken, setServiceAccountToken] = React.useState<string | null>(null);
  const [selectedExternalEngineId, setSelectedExternalEngineId] = React.useState('');
  const [externalEngineAuditFilter, setExternalEngineAuditFilter] = React.useState<ExternalEngineAuditAction>('all');
  const [authzAuditFilter, setAuthzAuditFilter] = React.useState<AuthzAuditFilterState>(DEFAULT_AUTHZ_AUDIT_FILTER);
  const [externalEngineReconcileSummary, setExternalEngineReconcileSummary] = React.useState<string | null>(null);
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
    queryFn: getAccessibleEngines,
  });
  const runtimeResourcesQ = useQuery({
    queryKey: ['authz-runtime-resources', selectedRuntimeEngineId],
    enabled: engineSetsReadDecision.allowed && Boolean(selectedRuntimeEngineId),
    queryFn: () => apiClient.get<RuntimeResource[]>(`/api/authz/runtime-resources?engineId=${encodeURIComponent(selectedRuntimeEngineId)}`),
  });
  const reconcileRuntimeResourcesM = useReconcileRuntimeResources();
  const assignmentsReadUnavailableReason = unavailableReason(assignmentsReadDecision, 'Missing permission platform:authz:roles:view');
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
  const showExternalRegistrationTab = apiClientsReadDecision.allowed || serviceAccountsReadDecision.allowed || externalSystemsReadDecision.allowed || externalEnginesReadDecision.allowed;
  const hasVisibleTabs = rolesReadDecision.allowed ||
    permissionsReadDecision.allowed ||
    assignmentsReadDecision.allowed ||
    groupsReadDecision.allowed ||
    effectiveAccessDecision.allowed ||
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
    engineSetsReadDecision.allowed,
    projectTargetsReadDecision.allowed,
    policiesReadDecision.allowed,
    auditReadDecision.allowed,
    showExternalRegistrationTab,
  ]);
  const [selectedTabId, setSelectedTabId] = React.useState<AccessControlTabId>(() => (
    accessControlTabFromSearchParams(searchParams) || 'roles'
  ));
  const selectedTabIndex = Math.max(0, visibleTabIds.indexOf(selectedTabId));

  React.useEffect(() => {
    const requestedTabId = accessControlTabFromSearchParams(searchParams);
    if (requestedTabId && visibleTabIds.includes(requestedTabId) && requestedTabId !== selectedTabId) {
      setSelectedTabId(requestedTabId);
    }
  }, [searchParams, selectedTabId, visibleTabIds]);

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
  const identityEntitlementMappings = identityEntitlementMappingsQ.data || [];

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

  const createExternalSystem = async (payload: ExternalEngineSystemCreatePayload) => {
    try {
      await createExternalSystemM.mutateAsync(payload);
      setError(null);
    } catch (e) {
      setError(parseApiError(e, 'Unable to create external engine system').message);
    }
  };

  const updateExternalSystem = async (id: string, payload: ExternalEngineSystemUpdatePayload) => {
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

  const roleScopePermissions = permissions.filter((permission) =>
    permission.scope === roleForm.scope || (roleForm.scope === 'tenant' && permission.tenantSafe));
  const selectedRiskyRolePermissions = roleScopePermissions.filter(
    (permission) => roleForm.permissionIds.includes(permission.key) && getPermissionRisk(permission)
  );
  const selectedRoleScope = [
    { id: 'platform', label: 'Platform' },
    { id: 'tenant', label: 'Tenant' },
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
          if (!nextTabId) return;
          setSelectedTabId(nextTabId);
          const nextSearchParams = new URLSearchParams(searchParams);
          nextSearchParams.set('tab', nextTabId.replace(/_/g, '-'));
          setSearchParams(nextSearchParams, { replace: true });
        }}
      >
        <TabList aria-label="Access control tabs">
          {visibleTabIds.map((tabId) => <Tab key={tabId}>{ACCESS_CONTROL_TAB_LABELS[tabId]}</Tab>)}
        </TabList>
        <TabPanels>
          {rolesReadDecision.allowed && (
          <TabPanel>
            <RoleCatalogPanel roles={roles} loading={rolesQ.isLoading} failed={rolesQ.isError} onCreate={openCreateRole} onEdit={openEditRole} onDuplicate={openDuplicateRole} onArchive={archiveRole} canManage={canManageRoles} filterRoles={filterRoles} />
          </TabPanel>
          )}
          {permissionsReadDecision.allowed && (
          <TabPanel>
            <PermissionCatalogPanel permissions={permissions} loading={permissionsQ.isLoading} failed={permissionsQ.isError} onCreate={openCreatePermission} canManage={canManageRoles} filterPermissions={filterPermissions} getPermissionImplications={getPermissionImplications} getPermissionRisk={getPermissionRisk} />
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
                identityEntitlementMappings={identityEntitlementMappings}
                auditEntries={auditReadDecision.allowed ? inspectionAuditEntries : []}
                onOpenAuditReference={auditReadDecision.allowed ? openAuthzAuditReference : undefined}
                helpers={principalResourcePanelHelpers}
                loading={
                  assignmentsQ.isLoading ||
                  (groupsReadDecision.allowed && (groupsQ.isLoading || groupMembershipsQ.isLoading)) ||
                  (apiClientsReadDecision.allowed && apiClientsQ.isLoading) ||
                  (serviceAccountsReadDecision.allowed && serviceAccountsQ.isLoading) ||
                  (externalSystemsReadDecision.allowed && externalSystemsQ.isLoading) ||
                  identityEntitlementMappingsQ.isLoading ||
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
                auditEntries={auditReadDecision.allowed ? inspectionAuditEntries : []}
                onOpenAuditReference={auditReadDecision.allowed ? openAuthzAuditReference : undefined}
                helpers={principalResourcePanelHelpers}
                loading={
                  assignmentsQ.isLoading ||
                  (apiClientsReadDecision.allowed && apiClientsQ.isLoading) ||
                  (groupsReadDecision.allowed && groupsQ.isLoading) ||
                  (serviceAccountsReadDecision.allowed && serviceAccountsQ.isLoading) ||
                  (externalSystemsReadDecision.allowed && externalSystemsQ.isLoading) ||
                  (engineSetsReadDecision.allowed && engineSetsQ.isLoading) ||
                  (externalEnginesReadDecision.allowed && externalEnginesQ.isLoading) ||
                  (projectTargetsReadDecision.allowed && projectEngineTargetsQ.isLoading) ||
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
            <EffectiveAccessPanel
              permissions={permissions}
              auditEntries={auditReadDecision.allowed ? inspectionAuditEntries : []}
              onOpenAuditReference={auditReadDecision.allowed ? openAuthzAuditReference : undefined}
            />
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
              onReconcile={() => reconcileRuntimeResourcesM.mutate(selectedRuntimeEngineId)}
            />
          </TabPanel>
          )}
          {projectTargetsReadDecision.allowed && (
          <TabPanel>
            <ProjectEngineTargetsTab
              failed={projectEngineTargetsQ.isError}
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
                formatConditions={formatPolicyConditions}
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
              <ExternalRegistrationTab
                failed={apiClientsQ.isError || serviceAccountsQ.isError || externalSystemsQ.isError || externalEnginesQ.isError}
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
              { id: 'tenant', label: 'Tenant' },
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
    </PageLayout>
  );
}
