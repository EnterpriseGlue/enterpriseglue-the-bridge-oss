import { ENGINE_AUTHZ_ACTIONS } from './permission-action-definitions/engine.js';
import { PLATFORM_AUTHZ_ACTIONS } from './permission-action-definitions/platform.js';
import { PROJECT_AUTHZ_ACTIONS } from './permission-action-definitions/project.js';

export const AUTHZ_OPENAPI_EXTENSION_KEY = 'x-enterpriseglue-authz' as const;

export const AUTHZ_RESOURCE_TYPES = [
  'platform',
  'tenant',
  'project',
  'engine',
  'engine_set',
  'engine_runtime_resource',
  'engine_runtime_resource_set',
  'project_engine_target',
  'external_engine_system',
  'api_client',
  'sso_mapping',
  'extension',
] as const;

export type AuthzResourceType = typeof AUTHZ_RESOURCE_TYPES[number];

export const AUTHZ_PRINCIPAL_TYPES = [
  'user',
  'group',
  'api_client',
  'service_account',
] as const;

export type AuthzPrincipalType = typeof AUTHZ_PRINCIPAL_TYPES[number];

export const AUTHZ_ACTION_RISKS = ['low', 'medium', 'high', 'critical'] as const;
export type AuthzActionRisk = typeof AUTHZ_ACTION_RISKS[number];

export const AUTHZ_UI_BEHAVIORS = [
  'hide',
  'disable',
  'redact',
  'deny-route',
  'diagnostic',
] as const;

export type AuthzUiBehavior = typeof AUTHZ_UI_BEHAVIORS[number];

export const AUTHZ_SURFACE_COVERAGE = [
  'frontend',
  'api-only',
  // The backend resolves and evaluates an exact runtime resource before it
  // returns a collection or row. A coarse client permission snapshot must not
  // hide that resource-aware surface.
  'runtime-enforced',
] as const;

export type AuthzSurfaceCoverage = typeof AUTHZ_SURFACE_COVERAGE[number];

export const AUTHZ_OPERATIONS = [
  'read',
  'create',
  'update',
  'delete',
  'execute',
  'manage',
  'evaluate',
  'sync',
  'reveal',
] as const;

export type AuthzOperation = typeof AUTHZ_OPERATIONS[number];

export interface AuthzResourceRef {
  type: AuthzResourceType;
  id?: string | null;
  tenantId?: string | null;
  attributes?: Record<string, unknown>;
}

export interface AuthzResourceResolverDefinition {
  id: string;
  resourceType: AuthzResourceType;
  requiredParams: string[];
  description: string;
  failureMode: 'deny';
}

export interface AuthzRouteMetadata {
  method: string;
  route: string;
  resourceResolver: string;
  additionalChecks?: string[];
  openApiOperationId?: string;
  openApi?: boolean;
}

export interface AuthzFrontendSurface {
  surfaceId: string;
  behavior: AuthzUiBehavior;
  coverage?: AuthzSurfaceCoverage;
  resourceType?: AuthzResourceType;
  label?: string;
}

export interface AuthzActionDefinition {
  actionId: string;
  permissionId: string;
  resourceType: AuthzResourceType;
  operation: AuthzOperation;
  risk: AuthzActionRisk;
  audit: boolean;
  category: string;
  description: string;
  ui: AuthzFrontendSurface[];
  routes?: AuthzRouteMetadata[];
}

export interface AuthzOpenApiExtension {
  actionId: string;
  permission: string;
  resourceResolver: string;
  additionalChecks?: string[];
  risk: AuthzActionRisk;
  audit: boolean;
  uiBehavior: AuthzUiBehavior;
}

export interface UiAuthzDecision {
  actionId: string;
  permissionId?: string;
  resourceType: AuthzResourceType;
  resourceId?: string | null;
  allowed: boolean;
  state: 'allowed' | 'hidden' | 'disabled' | 'redacted' | 'denied';
  reason: string;
  reasonCode?: string;
  managementSource?: 'configuration' | 'external_api' | 'sso' | 'platform_policy' | 'system';
  sourceRef?: string | null;
  diagnostics?: {
    explainUrl?: string;
    remediation?: string[];
  };
}

export const AUTHZ_RESOURCE_RESOLVERS: AuthzResourceResolverDefinition[] = [
  {
    id: 'platform.self',
    resourceType: 'platform',
    requiredParams: [],
    description: 'Resolve the singleton platform resource.',
    failureMode: 'deny',
  },
  {
    id: 'tenant.fromContext',
    resourceType: 'tenant',
    requiredParams: ['tenantId'],
    description: 'Resolve the active tenant from authenticated request context.',
    failureMode: 'deny',
  },
  {
    id: 'project.byId',
    resourceType: 'project',
    requiredParams: ['projectId'],
    description: 'Resolve a project by route or request project id.',
    failureMode: 'deny',
  },
  {
    id: 'project.visibleCollection',
    resourceType: 'project',
    requiredParams: [],
    description: 'Resolve the collection of projects visible to the current principal.',
    failureMode: 'deny',
  },
  {
    id: 'project.byFileId',
    resourceType: 'project',
    requiredParams: ['fileId'],
    description: 'Resolve a project from a Starbase file id.',
    failureMode: 'deny',
  },
  {
    id: 'project.byFolderId',
    resourceType: 'project',
    requiredParams: ['folderId'],
    description: 'Resolve a project from a Starbase folder id.',
    failureMode: 'deny',
  },
  {
    id: 'project.byVersionId',
    resourceType: 'project',
    requiredParams: ['versionId'],
    description: 'Resolve a project from a Starbase file version id.',
    failureMode: 'deny',
  },
  {
    id: 'project.byGitRepositoryId',
    resourceType: 'project',
    requiredParams: ['id'],
    description: 'Resolve a project from a Git repository id.',
    failureMode: 'deny',
  },
  {
    id: 'project.byGitDeploymentId',
    resourceType: 'project',
    requiredParams: ['id'],
    description: 'Resolve a project from a Git deployment id.',
    failureMode: 'deny',
  },
  {
    id: 'project.byGitLockId',
    resourceType: 'project',
    requiredParams: ['lockId'],
    description: 'Resolve a project from a Git file lock id.',
    failureMode: 'deny',
  },
  {
    id: 'engine.byId',
    resourceType: 'engine',
    requiredParams: ['engineId'],
    description: 'Resolve an engine by route or request engine id.',
    failureMode: 'deny',
  },
  {
    id: 'engine.visibleCollection',
    resourceType: 'engine',
    requiredParams: [],
    description: 'Resolve the collection of engines visible to the current principal.',
    failureMode: 'deny',
  },
  {
    id: 'engine.bySavedFilterId',
    resourceType: 'engine',
    requiredParams: ['id'],
    description: 'Resolve the engine associated with a saved filter id.',
    failureMode: 'deny',
  },
  {
    id: 'engineSet.byId',
    resourceType: 'engine_set',
    requiredParams: ['engineSetId'],
    description: 'Resolve an Engine Set by id and tenant boundary.',
    failureMode: 'deny',
  },
  {
    id: 'projectEngineTarget.byId',
    resourceType: 'project_engine_target',
    requiredParams: ['projectEngineTargetId'],
    description: 'Resolve a project-to-engine deployment target by id.',
    failureMode: 'deny',
  },
  {
    id: 'projectEngineTarget.fromProjectAndEngine',
    resourceType: 'project_engine_target',
    requiredParams: ['projectId', 'engineId'],
    description: 'Resolve the active project-to-engine deployment target for composite deployment checks.',
    failureMode: 'deny',
  },
  {
    id: 'projectEngineTarget.byProjectAndEngine',
    resourceType: 'project_engine_target',
    requiredParams: ['projectId', 'engineId'],
    description: 'Resolve a project-to-engine target candidate from project and engine ids.',
    failureMode: 'deny',
  },
  {
    id: 'externalEngineSystem.byId',
    resourceType: 'external_engine_system',
    requiredParams: ['externalSystemId'],
    description: 'Resolve an external engine source system by id and tenant boundary.',
    failureMode: 'deny',
  },
  {
    id: 'apiClient.byId',
    resourceType: 'api_client',
    requiredParams: ['apiClientId'],
    description: 'Resolve an API client by id and tenant boundary.',
    failureMode: 'deny',
  },
  {
    id: 'ssoMapping.byId',
    resourceType: 'sso_mapping',
    requiredParams: ['mappingId'],
    description: 'Resolve an SSO mapping by id and tenant boundary.',
    failureMode: 'deny',
  },
];

export const AUTHZ_ACTIONS = [
  ...PLATFORM_AUTHZ_ACTIONS,
  ...ENGINE_AUTHZ_ACTIONS,
  ...PROJECT_AUTHZ_ACTIONS,
] satisfies AuthzActionDefinition[];

export function validateAuthzActionRegistry(
  actions: readonly AuthzActionDefinition[] = AUTHZ_ACTIONS,
  resolvers: readonly AuthzResourceResolverDefinition[] = AUTHZ_RESOURCE_RESOLVERS,
): string[] {
  const errors: string[] = [];
  const actionIds = new Set<string>();
  const resolverIds = new Set<string>();

  for (const resolver of resolvers) {
    if (resolverIds.has(resolver.id)) errors.push(`Duplicate authorization resource resolver id: ${resolver.id}`);
    resolverIds.add(resolver.id);
  }

  for (const action of actions) {
    if (actionIds.has(action.actionId)) errors.push(`Duplicate authorization action id: ${action.actionId}`);
    actionIds.add(action.actionId);
    if (action.ui.length === 0) errors.push(`Authorization action has no frontend surface: ${action.actionId}`);
    for (const route of action.routes || []) {
      if (!resolverIds.has(route.resourceResolver)) {
        errors.push(`Authorization action ${action.actionId} references unknown resource resolver: ${route.resourceResolver}`);
      }
    }
  }

  return errors;
}

const authzActionRegistryErrors = validateAuthzActionRegistry();
if (authzActionRegistryErrors.length > 0) {
  throw new Error(`Invalid authorization action registry:\n${authzActionRegistryErrors.join('\n')}`);
}

const authzActionsById = new Map(AUTHZ_ACTIONS.map((action) => [action.actionId, action]));
const authzResourceResolversById = new Map(AUTHZ_RESOURCE_RESOLVERS.map((resolver) => [resolver.id, resolver]));

export function listAuthzActions(): AuthzActionDefinition[] {
  return [...AUTHZ_ACTIONS];
}

export interface PermissionResourceCompatibilityDescriptor {
  key: string;
  scope: AuthzResourceType;
  tenantSafe?: boolean;
}

const ENGINE_PERMISSION_RESOURCE_TYPES = new Set<AuthzResourceType>([
  'engine',
  'engine_set',
  'engine_runtime_resource',
  'engine_runtime_resource_set',
]);

/**
 * Defines which effective-access and policy resource selectors may be paired
 * with a permission. Engine Sets and runtime-resource scopes deliberately use
 * engine permissions because they narrow where an engine role applies; they
 * do not introduce a second permission namespace.
 */
export function isPermissionCompatibleWithResourceType(
  permission: PermissionResourceCompatibilityDescriptor,
  resourceType: AuthzResourceType,
): boolean {
  if (permission.scope === resourceType) return true;
  if (resourceType === 'tenant') return permission.tenantSafe === true;
  if (ENGINE_PERMISSION_RESOURCE_TYPES.has(resourceType) && permission.scope === 'engine') return true;
  return AUTHZ_ACTIONS.some((action) =>
    action.permissionId === permission.key && action.resourceType === resourceType,
  );
}

export function getAuthzActionDefinition(actionId: string): AuthzActionDefinition | undefined {
  return authzActionsById.get(actionId);
}

export function assertKnownAuthzAction(actionId: string): AuthzActionDefinition {
  const action = getAuthzActionDefinition(actionId);
  if (!action) {
    throw new Error(`Unknown authorization action id: ${actionId}`);
  }
  return action;
}

export function getAuthzResourceResolver(resolverId: string): AuthzResourceResolverDefinition | undefined {
  return authzResourceResolversById.get(resolverId);
}

export function isAuthzResourceType(value: string | null | undefined): value is AuthzResourceType {
  return Boolean(value && (AUTHZ_RESOURCE_TYPES as readonly string[]).includes(value));
}

export function isAuthzPrincipalType(value: string | null | undefined): value is AuthzPrincipalType {
  return Boolean(value && (AUTHZ_PRINCIPAL_TYPES as readonly string[]).includes(value));
}

export function toOpenApiAuthzExtension(action: AuthzActionDefinition, route: AuthzRouteMetadata): AuthzOpenApiExtension {
  const primarySurface = action.ui[0];
  return {
    actionId: action.actionId,
    permission: action.permissionId,
    resourceResolver: route.resourceResolver,
    additionalChecks: route.additionalChecks,
    risk: action.risk,
    audit: action.audit,
    uiBehavior: primarySurface?.behavior ?? 'disable',
  };
}
