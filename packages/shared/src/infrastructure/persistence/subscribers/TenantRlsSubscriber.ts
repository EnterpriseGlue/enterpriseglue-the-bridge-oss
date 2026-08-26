import type { EntitySubscriberInterface } from 'typeorm';
import type { AfterQueryEvent, BeforeQueryEvent } from 'typeorm/subscriber/event/QueryEvent.js';
import type { QueryRunner } from 'typeorm';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getTenantDatabaseContext } from '@enterpriseglue/shared/services/tenant-database-context.js';

/**
 * Applies and clears the PostgreSQL tenant setting on the same pooled
 * connection that executes each TypeORM query. RLS policies use the setting
 * as a database-enforced second boundary. The guard prevents the SET queries
 * themselves from recursively invoking the subscriber.
 */
export class TenantRlsSubscriber implements EntitySubscriberInterface {
  private readonly internal = new WeakSet<QueryRunner>();
  private readonly applied = new WeakSet<QueryRunner>();

  async beforeQuery(event: BeforeQueryEvent<unknown>): Promise<void> {
    if (config.tenancyMode !== 'pooled' || config.databaseType !== 'postgres' || this.internal.has(event.queryRunner)) {
      return;
    }

    const tenantId = getTenantDatabaseContext()?.tenantId || '';
    this.internal.add(event.queryRunner);
    try {
      await event.queryRunner.query(
        "SELECT set_config('enterpriseglue.tenancy_mode', 'pooled', false), set_config('enterpriseglue.tenant_id', $1, false)",
        [tenantId],
      );
      this.applied.add(event.queryRunner);
    } finally {
      this.internal.delete(event.queryRunner);
    }
  }

  async afterQuery(event: AfterQueryEvent<unknown>): Promise<void> {
    if (!this.applied.has(event.queryRunner) || this.internal.has(event.queryRunner)) return;
    this.applied.delete(event.queryRunner);
    this.internal.add(event.queryRunner);
    try {
      await event.queryRunner.query(
        "SELECT set_config('enterpriseglue.tenant_id', '', false), set_config('enterpriseglue.tenancy_mode', '', false)",
      );
    } finally {
      this.internal.delete(event.queryRunner);
    }
  }
}
