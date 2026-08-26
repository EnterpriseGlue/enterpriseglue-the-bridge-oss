import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantDatabaseContext {
  tenantId: string;
  tenantSlug: string;
}

const storage = new AsyncLocalStorage<TenantDatabaseContext>();

export function getTenantDatabaseContext(): TenantDatabaseContext | undefined {
  return storage.getStore();
}

export function runWithTenantDatabaseContext<T>(
  context: TenantDatabaseContext,
  callback: () => T,
): T {
  return storage.run(context, callback);
}
