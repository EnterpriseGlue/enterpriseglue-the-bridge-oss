import {
  getAuthzActionDefinition,
  getAuthzResourceResolver,
  toOpenApiAuthzExtension,
  type AuthzOpenApiExtension,
} from '@enterpriseglue/shared/authz/permission-actions.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import type {
  EnterpriseBackendPlugin,
  EnterpriseAuthzBackendRouteMethod,
  EnterpriseBackendRequireDeclaredActionOptions,
  EnterpriseBackendRouteAuthz,
} from '@enterpriseglue/enterprise-plugin-api/backend';

const noopPlugin: EnterpriseBackendPlugin = {};
const routeMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export interface EnterpriseBackendRouteOpenApiAuthzMetadata {
  method: EnterpriseAuthzBackendRouteMethod;
  path: string;
  actionId: string;
  openApiOperationId?: string;
  openApi?: boolean;
  extension: AuthzOpenApiExtension;
}

function isMissingEnterprisePlugin(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'ERR_MODULE_NOT_FOUND') {
    return true;
  }

  const message = (error as { message?: string } | null)?.message ?? '';
  return (
    message.includes('@enterpriseglue/enterprise-backend') &&
    (
      message.includes('Cannot find module') ||
      message.includes('Cannot resolve module') ||
      message.includes('Failed to load url')
    )
  );
}

function assertValidPluginShape(plugin: Record<string, unknown>): void {
  const optionalHookNames: Array<keyof EnterpriseBackendPlugin> = [
    'registerRoutes',
    'migrateEnterpriseDatabase',
    'getNotificationTenantResolver',
  ];

  const invalidHooks = optionalHookNames.filter((hookName) => {
    const hook = plugin[hookName as string];
    return hook !== undefined && typeof hook !== 'function';
  });

  if (invalidHooks.length > 0) {
    throw new Error(
      `[Enterprise] Invalid backend plugin export: ${invalidHooks.join(', ')} must be function(s) when provided`
    );
  }

  assertValidBackendRouteAuthzManifest(plugin.authzRoutes);
}

function assertStringArray(value: unknown, field: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
    throw new Error(`[Enterprise] Invalid backend plugin export: ${field} must be an array of non-empty strings when provided`);
  }
}

function assertOptionalString(value: unknown, field: string): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`[Enterprise] Invalid backend plugin export: ${field} must be a non-empty string when provided`);
  }
}

function assertOptionalBoolean(value: unknown, field: string): void {
  if (value === undefined) return;
  if (typeof value !== 'boolean') {
    throw new Error(`[Enterprise] Invalid backend plugin export: ${field} must be a boolean when provided`);
  }
}

function assertRouteObject(value: unknown, field: string): asserts value is Partial<EnterpriseBackendRouteAuthz> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[Enterprise] Invalid backend plugin export: ${field} must be an object`);
  }
}

function assertValidBackendRouteAuthzManifest(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new Error('[Enterprise] Invalid backend plugin export: authzRoutes must be an array when provided');
  }

  const seenRoutes = new Set<string>();

  value.forEach((route, index) => {
    const field = `authzRoutes[${index}]`;
    assertRouteObject(route, field);

    const method = route.method;
    if (typeof method !== 'string' || !routeMethods.has(method.trim().toUpperCase())) {
      throw new Error(`[Enterprise] Invalid backend plugin export: ${field}.method must be one of ${Array.from(routeMethods).join(', ')}`);
    }

    const path = route.path;
    if (typeof path !== 'string' || !path.trim().startsWith('/')) {
      throw new Error(`[Enterprise] Invalid backend plugin export: ${field}.path must start with /`);
    }

    const actionId = route.actionId;
    if (typeof actionId !== 'string' || actionId.trim() === '') {
      throw new Error(`[Enterprise] Invalid backend plugin export: ${field}.actionId must be a non-empty string`);
    }

    const action = getAuthzActionDefinition(actionId);
    if (!action) {
      throw new Error(`[Enterprise] Invalid backend plugin export: ${field}.actionId references unknown action id ${actionId}`);
    }

    const resourceResolver = route.resourceResolver;
    if (typeof resourceResolver !== 'string' || resourceResolver.trim() === '') {
      throw new Error(`[Enterprise] Invalid backend plugin export: ${field}.resourceResolver must be a non-empty string`);
    }

    const resolver = getAuthzResourceResolver(resourceResolver);
    if (!resolver) {
      throw new Error(`[Enterprise] Invalid backend plugin export: ${field}.resourceResolver references unknown resolver ${resourceResolver}`);
    }
    if (resolver.resourceType !== action.resourceType) {
      throw new Error(
        `[Enterprise] Invalid backend plugin export: ${field}.resourceResolver resolves ${resolver.resourceType}, ` +
        `but action ${actionId} requires ${action.resourceType}`
      );
    }

    assertStringArray(route.additionalChecks, `${field}.additionalChecks`);
    assertOptionalString(route.openApiOperationId, `${field}.openApiOperationId`);
    assertOptionalBoolean(route.openApi, `${field}.openApi`);

    const routeKey = `${method.trim().toUpperCase()} ${path.trim()} ${actionId}`;
    if (seenRoutes.has(routeKey)) {
      throw new Error(`[Enterprise] Invalid backend plugin export: duplicate authz route ${routeKey}`);
    }
    seenRoutes.add(routeKey);
  });
}

function normalizeRouteMethod(method: string): EnterpriseAuthzBackendRouteMethod {
  return method.trim().toUpperCase() as EnterpriseAuthzBackendRouteMethod;
}

function normalizeManifestRoutePath(path: string): string {
  const normalized = path
    .trim()
    .replace(/\/+/g, '/')
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}');
  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

export function findEnterpriseBackendRouteAuthz(
  authzRoutes: EnterpriseBackendRouteAuthz[] | undefined,
  method: EnterpriseAuthzBackendRouteMethod,
  path: string
): EnterpriseBackendRouteAuthz {
  assertValidBackendRouteAuthzManifest(authzRoutes);
  const methodKey = normalizeRouteMethod(method);
  const pathKey = normalizeManifestRoutePath(path);
  const route = authzRoutes?.find((candidate) =>
    normalizeRouteMethod(candidate.method) === methodKey &&
    normalizeManifestRoutePath(candidate.path) === pathKey
  );
  if (!route) {
    throw new Error(`[Enterprise] Backend plugin route authz manifest has no entry for ${methodKey} ${pathKey}`);
  }
  return route;
}

export function requireDeclaredEnterpriseBackendRouteAction(
  authzRoutes: EnterpriseBackendRouteAuthz[] | undefined,
  method: EnterpriseAuthzBackendRouteMethod,
  path: string,
  options: EnterpriseBackendRequireDeclaredActionOptions = {}
) {
  const route = findEnterpriseBackendRouteAuthz(authzRoutes, method, path);
  return requireAction(route.actionId, {
    ...options,
    resourceResolver: route.resourceResolver,
  });
}

export function buildEnterpriseBackendRouteOpenApiAuthzMetadata(
  authzRoutes: EnterpriseBackendRouteAuthz[] | undefined,
  options: { includeInternal?: boolean } = {}
): EnterpriseBackendRouteOpenApiAuthzMetadata[] {
  assertValidBackendRouteAuthzManifest(authzRoutes);
  if (!authzRoutes?.length) return [];

  return authzRoutes
    .filter((route) => options.includeInternal || route.openApi !== false)
    .map((route) => {
      const action = getAuthzActionDefinition(route.actionId);
      if (!action) {
        throw new Error(`[Enterprise] Invalid backend plugin export: route action id disappeared after validation: ${route.actionId}`);
      }
      return {
        method: normalizeRouteMethod(route.method),
        path: route.path.trim(),
        actionId: route.actionId,
        ...(route.openApiOperationId !== undefined ? { openApiOperationId: route.openApiOperationId } : {}),
        ...(route.openApi !== undefined ? { openApi: route.openApi } : {}),
        extension: toOpenApiAuthzExtension(action, {
          method: normalizeRouteMethod(route.method),
          route: route.path.trim(),
          resourceResolver: route.resourceResolver,
          additionalChecks: route.additionalChecks,
          openApiOperationId: route.openApiOperationId,
          openApi: route.openApi,
        }),
      };
    });
}

export const __enterpriseBackendPluginTestUtils = {
  isMissingEnterprisePlugin,
  assertValidPluginShape,
  assertValidBackendRouteAuthzManifest,
  buildEnterpriseBackendRouteOpenApiAuthzMetadata,
  findEnterpriseBackendRouteAuthz,
  requireDeclaredEnterpriseBackendRouteAction,
};

async function dynamicImport(specifier: string): Promise<any> {
  return import(specifier);
}

/**
 * Load the enterprise backend plugin if available.
 * 
 * Auto-detection: No ENTERPRISE_ENABLED flag needed.
 * - OSS repo: Plugin package doesn't exist → Returns noop plugin (OSS mode)
 * - EE repo: Plugin package exists → Loads and returns plugin
 * 
 * Feature flags: Individual features can be controlled via env vars.
 * - MULTI_TENANT=true/false → Enable/disable multi-tenant mode
 * - (Add more feature flags as needed)
 */
export async function loadEnterpriseBackendPlugin(): Promise<EnterpriseBackendPlugin> {
  try {
    const mod = await dynamicImport('@enterpriseglue/enterprise-backend');
    const plugin = mod?.default ?? mod?.enterpriseBackendPlugin ?? mod?.plugin ?? mod;

    if (plugin && typeof plugin === 'object') {
      assertValidPluginShape(plugin as Record<string, unknown>);
      console.log('[Enterprise] Backend plugin loaded');
      return plugin as EnterpriseBackendPlugin;
    }

    return noopPlugin;
  } catch (error) {
    if (isMissingEnterprisePlugin(error)) {
      // Plugin package not installed (expected OSS mode).
      return noopPlugin;
    }

    console.error('[Enterprise] Backend plugin failed to load:', error);
    throw error;
  }
}
