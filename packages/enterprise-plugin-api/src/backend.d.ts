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

export interface EnterpriseBackendContext {
  connectionPool: ConnectionPool;
  config: unknown;
}

export interface EnterpriseBackendPlugin {
  registerRoutes?: (app: unknown, ctx: EnterpriseBackendContext) => void | Promise<void>;
  migrateEnterpriseDatabase?: (ctx: EnterpriseBackendContext) => void | Promise<void>;
  getNotificationTenantResolver?: (
    ctx: EnterpriseBackendContext,
  ) => NotificationTenantResolver | undefined | Promise<NotificationTenantResolver | undefined>;
}
