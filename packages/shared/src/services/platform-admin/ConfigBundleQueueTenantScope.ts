import { config } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Tenant } from '@enterpriseglue/shared/infrastructure/persistence/entities/Tenant.js';
import { getPlatformDatabaseCapability } from '../platform-database-context.js';
import { getTenantDatabaseContext, runWithTenantDatabaseContext } from '../tenant-database-context.js';

function rejectGlobalCapability(): void {
  if (getPlatformDatabaseCapability()) throw new Error('Global config continuation queues are unsupported in pooled mode');
}

/** Targeted operations never infer a global queue from a missing tenant. */
export async function inConfigQueueTenant<T>(tenantId: string | null | undefined, work: (id: string | null | undefined) => Promise<T>): Promise<T> {
  if (config.tenancyMode !== 'pooled') return work(tenantId);
  rejectGlobalCapability();
  const current = getTenantDatabaseContext();
  const id = tenantId === undefined ? current?.tenantId : tenantId;
  if (!id || (current && current.tenantId !== id)) throw new Error('Config continuation requires the bound tenant; global queues are unsupported');
  const tenant = await (await getDataSource()).getRepository(Tenant).findOne({ where: { id } });
  if (!tenant || tenant.status !== 'active') throw new Error('Config continuation tenant is not active');
  return runWithTenantDatabaseContext({ tenantId: tenant.id, tenantSlug: tenant.slug }, () => work(tenant.id));
}

/** Explicit predicates supplement RLS and prevent accidental unscoped scans. */
export function configQueueTenantFilter(): { tenantId?: string } {
  if (config.tenancyMode !== 'pooled') return {};
  const tenantId = getTenantDatabaseContext()?.tenantId;
  if (!tenantId) throw new Error('Config continuation queue has no tenant context');
  return { tenantId };
}

export function assertConfigQueueRowTenant(row: { tenantId: string | null }): void {
  const { tenantId } = configQueueTenantFilter();
  if (tenantId && row.tenantId !== tenantId) throw new Error('Config continuation queue returned a different tenant');
}

export interface ConfigQueueScanCursor { lastTenantId?: string }

/** Discover only registry tenants, never an RLS-protected queue without ALS.
 * One unit per tenant per round keeps a busy tenant from consuming the batch.
 * A queue-owned cursor rotates subsequent ticks during this process lifetime;
 * restart resets it. This is not durable or cross-replica scheduler fairness.
 * Historical global queue rows intentionally remain unsupported.
 */
export async function runConfigQueueBatch<T>(maxTasks: number, work: () => Promise<T | null>, targeted = false, cursor?: ConfigQueueScanCursor): Promise<T[]> {
  let tenantIds: Array<string | undefined> = [undefined];
  let fanout = false;
  if (config.tenancyMode === 'pooled') {
    rejectGlobalCapability();
    const current = getTenantDatabaseContext();
    fanout = !current;
    if (!current && targeted) throw new Error('Targeted config continuation requires a tenant context; global queues are unsupported');
    tenantIds = current ? [current.tenantId] : (await (await getDataSource()).getRepository(Tenant).find({
      where: { status: 'active' }, order: { id: 'ASC' },
    })).filter(tenant => tenant.status === 'active').map(tenant => tenant.id);
    if (fanout && cursor?.lastTenantId && tenantIds.length) {
      const after = tenantIds.findIndex(id => id! > cursor.lastTenantId!);
      if (after > 0) tenantIds = [...tenantIds.slice(after), ...tenantIds.slice(0, after)];
    }
  }
  const results: T[] = [];
  while (results.length < maxTasks) {
    let progressed = false;
    for (const tenantId of tenantIds) {
      if (fanout && cursor && tenantId) cursor.lastTenantId = tenantId;
      const result = await inConfigQueueTenant(tenantId, work);
      if (result !== null) {
        results.push(result);
        progressed = true;
      }
      if (results.length >= maxTasks) break;
    }
    if (!progressed) break;
  }
  return results;
}
