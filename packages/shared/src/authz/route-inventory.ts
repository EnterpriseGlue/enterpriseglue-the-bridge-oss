import {
  AUTHZ_OPENAPI_EXTENSION_KEY,
  AUTHZ_RESOURCE_RESOLVERS,
  getAuthzActionDefinition,
  listAuthzActions,
  toOpenApiAuthzExtension,
  type AuthzOpenApiExtension,
  type AuthzRouteMetadata,
} from './permission-actions.js';
import {
  AUTHZ_OPENAPI_EXEMPTION_KEY,
  listAuthzRouteExemptions,
  toOpenApiAuthzExemption,
  type AuthzOpenApiExemption,
  type AuthzRouteExemption,
} from './route-exemptions.js';

const OPENAPI_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']);

export type AuthzRouteInventoryIssueCode =
  | 'action.duplicate'
  | 'action.missing-ui'
  | 'action.route.invalid'
  | 'action.route.unknown-resolver'
  | 'action.route.missing-openapi'
  | 'exemption.duplicate'
  | 'exemption.route.invalid'
  | 'exemption.conflicts-with-action'
  | 'openapi.unknown-action'
  | 'openapi.route-not-registered'
  | 'openapi.extension-mismatch'
  | 'openapi.unknown-exemption'
  | 'openapi.exemption-mismatch'
  | 'openapi.authz-conflict';

export interface AuthzRouteInventoryIssue {
  code: AuthzRouteInventoryIssueCode;
  message: string;
  actionId?: string;
  method?: string;
  route?: string;
  openApiPath?: string;
  field?: string;
  expected?: unknown;
  actual?: unknown;
}

export interface AuthzRouteInventoryValidationOptions {
  /**
   * Current migration mode validates OpenAPI operations that already declare
   * authz metadata. Enable this once the route inventory is complete to fail
   * action-registry routes that do not have OpenAPI operations yet.
   */
  requireOpenApiForActionRoutes?: boolean;
}

export interface AuthzRouteInventoryValidationResult {
  valid: boolean;
  issues: AuthzRouteInventoryIssue[];
}

type OpenApiOperation = Record<string, unknown>;

interface ActionRouteEntry {
  actionId: string;
  route: AuthzRouteMetadata;
}

function routeKey(method: string, route: string): string {
  return `${method.trim().toUpperCase()} ${normalizeAuthzRoutePath(route)}`;
}

export function normalizeAuthzRoutePath(route: string): string {
  const normalized = route
    .trim()
    .replace(/\/+/g, '/')
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}');
  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = (value as Record<string, unknown>)[key];
        return acc;
      }, {}));
  }
  return JSON.stringify(value);
}

function valuesEqual(expected: unknown, actual: unknown): boolean {
  if (typeof expected === 'undefined' && typeof actual === 'undefined') return true;
  return sortedJson(expected) === sortedJson(actual);
}

function addMismatch(
  issues: AuthzRouteInventoryIssue[],
  input: {
    actionId: string;
    method: string;
    openApiPath: string;
    field: keyof AuthzOpenApiExtension;
    expected: unknown;
    actual: unknown;
  }
): void {
  if (valuesEqual(input.expected, input.actual)) return;
  issues.push({
    code: 'openapi.extension-mismatch',
    message: `OpenAPI authz metadata mismatch for ${input.method} ${input.openApiPath}: ${input.field}`,
    actionId: input.actionId,
    method: input.method,
    openApiPath: input.openApiPath,
    field: input.field,
    expected: input.expected,
    actual: input.actual,
  });
}

function addExemptionMismatch(
  issues: AuthzRouteInventoryIssue[],
  input: {
    method: string;
    openApiPath: string;
    field: keyof AuthzOpenApiExemption;
    expected: unknown;
    actual: unknown;
  }
): void {
  if (valuesEqual(input.expected, input.actual)) return;
  issues.push({
    code: 'openapi.exemption-mismatch',
    message: `OpenAPI authz exemption metadata mismatch for ${input.method} ${input.openApiPath}: ${input.field}`,
    method: input.method,
    openApiPath: input.openApiPath,
    field: input.field,
    expected: input.expected,
    actual: input.actual,
  });
}

function buildActionRouteIndex(issues: AuthzRouteInventoryIssue[]): Map<string, ActionRouteEntry[]> {
  const routeIndex = new Map<string, ActionRouteEntry[]>();
  const actionIds = new Set<string>();
  const resolverIds = new Set(AUTHZ_RESOURCE_RESOLVERS.map((resolver) => resolver.id));

  for (const action of listAuthzActions()) {
    if (actionIds.has(action.actionId)) {
      issues.push({
        code: 'action.duplicate',
        message: `Duplicate authorization action id: ${action.actionId}`,
        actionId: action.actionId,
      });
    }
    actionIds.add(action.actionId);

    if (!Array.isArray(action.ui) || action.ui.length === 0) {
      issues.push({
        code: 'action.missing-ui',
        message: `Authorization action has no frontend surface metadata: ${action.actionId}`,
        actionId: action.actionId,
      });
    }

    for (const route of action.routes || []) {
      const method = route.method?.trim().toUpperCase();
      if (!method || !route.route?.startsWith('/')) {
        issues.push({
          code: 'action.route.invalid',
          message: `Authorization route metadata is invalid for action ${action.actionId}`,
          actionId: action.actionId,
          method,
          route: route.route,
        });
        continue;
      }

      if (!resolverIds.has(route.resourceResolver)) {
        issues.push({
          code: 'action.route.unknown-resolver',
          message: `Authorization route references unknown resolver: ${route.resourceResolver}`,
          actionId: action.actionId,
          method,
          route: route.route,
        });
      }

      const key = routeKey(method, route.route);
      const entries = routeIndex.get(key) || [];
      entries.push({ actionId: action.actionId, route });
      routeIndex.set(key, entries);
    }
  }

  return routeIndex;
}

function buildExemptionRouteIndex(issues: AuthzRouteInventoryIssue[]): Map<string, AuthzRouteExemption[]> {
  const routeIndex = new Map<string, AuthzRouteExemption[]>();

  for (const exemption of listAuthzRouteExemptions()) {
    const method = exemption.method?.trim().toUpperCase();
    if (!method || !exemption.route?.startsWith('/')) {
      issues.push({
        code: 'exemption.route.invalid',
        message: `Authorization route exemption is invalid for ${method || 'unknown'} ${exemption.route || 'unknown'}`,
        method,
        route: exemption.route,
      });
      continue;
    }

    const key = routeKey(method, exemption.route);
    const entries = routeIndex.get(key) || [];
    if (entries.length > 0) {
      issues.push({
        code: 'exemption.duplicate',
        message: `Duplicate authorization route exemption: ${method} ${exemption.route}`,
        method,
        route: exemption.route,
      });
    }
    entries.push(exemption);
    routeIndex.set(key, entries);
  }

  return routeIndex;
}

function buildOpenApiOperationIndex(openApiDocument: unknown): Map<string, OpenApiOperation> {
  const paths = (openApiDocument as { paths?: Record<string, Record<string, unknown>> })?.paths || {};
  const operations = new Map<string, OpenApiOperation>();

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      const methodLower = method.toLowerCase();
      if (!OPENAPI_METHODS.has(methodLower) || !operation || typeof operation !== 'object') continue;
      operations.set(routeKey(methodLower, path), operation as OpenApiOperation);
    }
  }

  return operations;
}

export function validateAuthzRouteInventory(
  openApiDocument: unknown,
  options: AuthzRouteInventoryValidationOptions = {}
): AuthzRouteInventoryValidationResult {
  const issues: AuthzRouteInventoryIssue[] = [];
  const actionRoutes = buildActionRouteIndex(issues);
  const exemptionRoutes = buildExemptionRouteIndex(issues);
  const openApiOperations = buildOpenApiOperationIndex(openApiDocument);

  for (const [key, exemptions] of exemptionRoutes.entries()) {
    const entries = actionRoutes.get(key);
    if (!entries?.length) continue;
    const [method, route] = key.split(' ');
    for (const exemption of exemptions) {
      for (const entry of entries) {
        issues.push({
          code: 'exemption.conflicts-with-action',
          message: `Authorization route exemption conflicts with registered action ${entry.actionId}: ${method} ${route}`,
          actionId: entry.actionId,
          method,
          route: exemption.route,
        });
      }
    }
  }

  if (options.requireOpenApiForActionRoutes) {
    for (const [key, entries] of actionRoutes.entries()) {
      if (openApiOperations.has(key)) continue;
      for (const entry of entries) {
        if (entry.route.openApi === false) continue;
        issues.push({
          code: 'action.route.missing-openapi',
          message: `Authorization action route is missing from OpenAPI: ${entry.route.method} ${entry.route.route}`,
          actionId: entry.actionId,
          method: entry.route.method,
          route: entry.route.route,
        });
      }
    }
  }

  for (const [key, operation] of openApiOperations.entries()) {
    const extension = operation[AUTHZ_OPENAPI_EXTENSION_KEY] as Partial<AuthzOpenApiExtension> | undefined;
    const [method, openApiPath] = key.split(' ');
    const exemptionExtension = operation[AUTHZ_OPENAPI_EXEMPTION_KEY] as Partial<AuthzOpenApiExemption> | undefined;

    if (extension && exemptionExtension) {
      issues.push({
        code: 'openapi.authz-conflict',
        message: `OpenAPI operation cannot declare both authz action metadata and authz exemption metadata: ${method} ${openApiPath}`,
        actionId: String(extension.actionId || ''),
        method,
        openApiPath,
      });
    }

    if (extension) {
      const actionId = String(extension.actionId || '');
      const action = getAuthzActionDefinition(actionId);
      if (!action) {
        issues.push({
          code: 'openapi.unknown-action',
          message: `OpenAPI authz metadata references unknown action id: ${actionId}`,
          actionId,
          method,
          openApiPath,
        });
      } else {
        const candidateRoutes = actionRoutes.get(key)?.filter((entry) => entry.actionId === actionId) || [];
        if (candidateRoutes.length === 0) {
          issues.push({
            code: 'openapi.route-not-registered',
            message: `OpenAPI authz metadata is not registered in the action route inventory: ${method} ${openApiPath}`,
            actionId,
            method,
            openApiPath,
          });
        } else {
          const expected = toOpenApiAuthzExtension(action, candidateRoutes[0].route);
          addMismatch(issues, { actionId, method, openApiPath, field: 'actionId', expected: expected.actionId, actual: extension.actionId });
          addMismatch(issues, { actionId, method, openApiPath, field: 'permission', expected: expected.permission, actual: extension.permission });
          addMismatch(issues, { actionId, method, openApiPath, field: 'resourceResolver', expected: expected.resourceResolver, actual: extension.resourceResolver });
          addMismatch(issues, { actionId, method, openApiPath, field: 'additionalChecks', expected: expected.additionalChecks, actual: extension.additionalChecks });
          addMismatch(issues, { actionId, method, openApiPath, field: 'risk', expected: expected.risk, actual: extension.risk });
          addMismatch(issues, { actionId, method, openApiPath, field: 'audit', expected: expected.audit, actual: extension.audit });
          addMismatch(issues, { actionId, method, openApiPath, field: 'uiBehavior', expected: expected.uiBehavior, actual: extension.uiBehavior });
        }
      }
    }

    if (exemptionExtension) {
      const candidateExemptions = exemptionRoutes.get(key) || [];
      if (candidateExemptions.length === 0) {
        issues.push({
          code: 'openapi.unknown-exemption',
          message: `OpenAPI authz exemption metadata is not registered in the exemption inventory: ${method} ${openApiPath}`,
          method,
          openApiPath,
        });
      } else {
        const expected = toOpenApiAuthzExemption(candidateExemptions[0]);
        addExemptionMismatch(issues, { method, openApiPath, field: 'kind', expected: expected.kind, actual: exemptionExtension.kind });
        addExemptionMismatch(issues, { method, openApiPath, field: 'reason', expected: expected.reason, actual: exemptionExtension.reason });
        addExemptionMismatch(issues, { method, openApiPath, field: 'risk', expected: expected.risk, actual: exemptionExtension.risk });
        addExemptionMismatch(issues, { method, openApiPath, field: 'owner', expected: expected.owner, actual: exemptionExtension.owner });
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export function assertAuthzRouteInventory(
  openApiDocument: unknown,
  options: AuthzRouteInventoryValidationOptions = {}
): void {
  const result = validateAuthzRouteInventory(openApiDocument, options);
  if (result.valid) return;

  const detail = result.issues
    .map((issue) => `- [${issue.code}] ${issue.message}`)
    .join('\n');
  throw new Error(`Authorization route inventory validation failed:\n${detail}`);
}
