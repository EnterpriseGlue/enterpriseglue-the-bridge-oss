import type { AssignmentPrincipalType } from './assignmentFormOptions';
import type {
  ApiClient,
  AuthzGroup,
  AuthzGroupMembership,
  AuthzResourceType,
  EngineSetSummary,
  ExternalEngineRegistration,
  ExternalEngineSystem,
  ProjectEngineTarget,
  RoleAssignment,
  ServiceAccount,
} from '../../hooks/useAuthzApi';

export type PrincipalSummaryStatus = 'active' | 'archived' | 'revoked' | 'unknown';

export interface PrincipalSummary {
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

export interface ResourceSummary {
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

function principalKey(type: AssignmentPrincipalType, id: string) {
  return `${type}:${id}`;
}

export function getAssignmentPrincipalType(assignment: RoleAssignment): AssignmentPrincipalType {
  return (assignment.principalType || 'user') as AssignmentPrincipalType;
}

export function getAssignmentPrincipalId(assignment: RoleAssignment) {
  return assignment.principalId || assignment.userId;
}

export function principalTypeLabel(type: AssignmentPrincipalType) {
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

export function isMembershipEffective(membership: AuthzGroupMembership, now = Date.now()) {
  return !membership.expiresAt || membership.expiresAt > now;
}

export function roleAssignmentPrincipalMatches(assignment: RoleAssignment, type: AssignmentPrincipalType, id: string) {
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

export function getAssignmentResourceType(assignment: RoleAssignment): AuthzResourceType {
  return (assignment.scopeType || assignment.resourceType || 'platform') as AuthzResourceType;
}

export function getAssignmentResourceId(assignment: RoleAssignment) {
  return assignment.scopeId || assignment.resourceId || '';
}

export function authzResourceTypeLabel(type: AuthzResourceType) {
  if (type === 'engine_set') return 'Engine Set';
  if (type === 'project_engine_target') return 'Project target';
  if (type === 'external_engine_system') return 'External system';
  if (type === 'api_client') return 'API client';
  if (type === 'sso_mapping') return 'SSO mapping';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function getResourceLabel(type: AuthzResourceType, id: string, externalSystems: ExternalEngineSystem[], engineSets: EngineSetSummary[], externalEngines: ExternalEngineRegistration[], projectTargets: ProjectEngineTarget[]) {
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

function getResourceDetail(type: AuthzResourceType, id: string, externalSystems: ExternalEngineSystem[], engineSets: EngineSetSummary[], externalEngines: ExternalEngineRegistration[], projectTargets: ProjectEngineTarget[]) {
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

function getResourceStatus(type: AuthzResourceType, id: string, externalSystems: ExternalEngineSystem[], engineSets: EngineSetSummary[], externalEngines: ExternalEngineRegistration[], projectTargets: ProjectEngineTarget[]) {
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

export function buildResourceSummaries(assignments: RoleAssignment[], externalSystems: ExternalEngineSystem[], engineSets: EngineSetSummary[], externalEngines: ExternalEngineRegistration[], projectTargets: ProjectEngineTarget[]): ResourceSummary[] {
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
    const resourceAssignments = assignments.filter((assignment) => getAssignmentResourceType(assignment) === summary.type && getAssignmentResourceId(assignment) === summary.id);
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

export function assignmentResourceMatches(assignment: RoleAssignment, resource: ResourceSummary) {
  return getAssignmentResourceType(assignment) === resource.type && getAssignmentResourceId(assignment) === resource.id;
}
