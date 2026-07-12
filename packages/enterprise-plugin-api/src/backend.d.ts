/**
 * Database-agnostic connection pool interface
 */
export interface ConnectionPool {
  query<T = unknown>(
    sql: string,
    params?: ReadonlyArray<unknown> | Record<string, unknown>
  ): Promise<{ rows: T[]; rowCount: number }>;
  close(): Promise<void>;
  getNativePool(): unknown;
}

export interface NotificationTenantResolveContext {
  req?: unknown;
  user?: { userId?: string };
  query?: Record<string, string>;
}

export interface NotificationTenantResolver {
  resolve(context: NotificationTenantResolveContext): {
    tenantId: string | null;
    userId: string;
  };
}

export type EnterpriseAuthzBackendRouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface EnterpriseBackendRouteAuthz {
  /** HTTP method for the plugin route. */
  method: EnterpriseAuthzBackendRouteMethod;
  /** Express/OpenAPI-style route path, starting with `/`. */
  path: string;
  /** Shared authorization action id required by this route. */
  actionId: string;
  /** Shared authorization resource resolver id used by the backend guard. */
  resourceResolver: string;
  /** Extra contextual checks enforced by the route, if any. */
  additionalChecks?: string[];
  /** Optional OpenAPI operation id for generated docs parity. */
  openApiOperationId?: string;
  /** Set to false only for intentionally undocumented internal routes. */
  openApi?: boolean;
}

export type EnterpriseBackendResourceIdLocation = 'params' | 'body' | 'query' | 'any';
export type EnterpriseBackendCompositeActionKind = 'deployment';
export type EnterpriseBackendDeploymentMode = 'manual' | 'ci' | 'api' | 'import';
export type EnterpriseBackendMiddleware = (...args: any[]) => any;

export interface EnterpriseBackendRequireActionOptions {
  resourceResolver?: string;
  resourceIdFrom?: EnterpriseBackendResourceIdLocation;
  resourceIdKey?: string;
  collectionIdsFrom?: EnterpriseBackendResourceIdLocation;
  collectionIdsKey?: string;
  acceptedPermissions?: string[];
}

export interface EnterpriseBackendRequireCompositeActionOptions {
  kind?: EnterpriseBackendCompositeActionKind;
  projectIdFrom?: EnterpriseBackendResourceIdLocation;
  projectIdKey?: string;
  engineIdFrom?: EnterpriseBackendResourceIdLocation;
  engineIdKey?: string;
  mode?: EnterpriseBackendDeploymentMode;
  optionalWhenMissingEngineId?: boolean;
  legacyAutoGrant?: boolean;
  attachDeployContext?: boolean;
  hideUnauthorizedEngine?: boolean;
}

export interface EnterpriseBackendRequireDeclaredActionOptions {
  resourceIdFrom?: EnterpriseBackendResourceIdLocation;
  resourceIdKey?: string;
  collectionIdsFrom?: EnterpriseBackendResourceIdLocation;
  collectionIdsKey?: string;
  acceptedPermissions?: string[];
}

export interface EnterpriseBackendRouteOpenApiAuthzExtension {
  actionId: string;
  permission: string;
  resourceResolver: string;
  additionalChecks?: string[];
  risk: 'low' | 'medium' | 'high' | 'critical';
  audit: boolean;
  uiBehavior: 'hide' | 'disable' | 'redact' | 'deny-route' | 'diagnostic';
}

export interface EnterpriseBackendRouteOpenApiAuthzMetadata {
  method: EnterpriseAuthzBackendRouteMethod;
  path: string;
  actionId: string;
  openApiOperationId?: string;
  openApi?: boolean;
  extension: EnterpriseBackendRouteOpenApiAuthzExtension;
}

export interface EnterpriseBackendAuthzContext {
  requireAction(actionId: string, options?: EnterpriseBackendRequireActionOptions): EnterpriseBackendMiddleware;
  requireCompositeAction(actionId: string, options?: EnterpriseBackendRequireCompositeActionOptions): EnterpriseBackendMiddleware;
  requireDeclaredAction(
    authzRoutes: EnterpriseBackendRouteAuthz[] | undefined,
    method: EnterpriseAuthzBackendRouteMethod,
    path: string,
    options?: EnterpriseBackendRequireDeclaredActionOptions
  ): EnterpriseBackendMiddleware;
  buildOpenApiAuthzMetadata(
    authzRoutes?: EnterpriseBackendRouteAuthz[],
    options?: { includeInternal?: boolean }
  ): EnterpriseBackendRouteOpenApiAuthzMetadata[];
}

export interface EnterpriseBackendContext {
  connectionPool: ConnectionPool;
  config: unknown;
  authz: EnterpriseBackendAuthzContext;
}

export interface EnterpriseBackendPlugin {
  registerRoutes?: (app: unknown, ctx: EnterpriseBackendContext) => void | Promise<void>;
  authzRoutes?: EnterpriseBackendRouteAuthz[];
  migrateEnterpriseDatabase?: (ctx: EnterpriseBackendContext) => void | Promise<void>;
  getNotificationTenantResolver?: (
    ctx: EnterpriseBackendContext,
  ) => NotificationTenantResolver | undefined | Promise<NotificationTenantResolver | undefined>;
}
