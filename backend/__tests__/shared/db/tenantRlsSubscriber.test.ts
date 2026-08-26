import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '@enterpriseglue/shared/config/index.js';
import { BackfillNativeTenantOwnership1700000000125 } from '@enterpriseglue/shared/db/migrations/1700000000125-backfill-native-tenant-ownership.js';
import { TenantRlsSubscriber } from '@enterpriseglue/shared/infrastructure/persistence/subscribers/TenantRlsSubscriber.js';
import { runWithTenantDatabaseContext } from '@enterpriseglue/shared/services/tenant-database-context.js';
import { POSTGRES_TENANT_RLS_TABLES, verifyPostgresTenantRlsRole } from '@enterpriseglue/shared/db/postgres-tenant-rls.js';

describe('TenantRlsSubscriber', () => {
  const originalMode = config.tenancyMode;
  const originalDatabase = config.databaseType;

  afterEach(() => {
    (config as any).tenancyMode = originalMode;
    (config as any).databaseType = originalDatabase;
  });

  it('sets and clears the tenant on the same query runner', async () => {
    (config as any).tenancyMode = 'pooled';
    (config as any).databaseType = 'postgres';
    const subscriber = new TenantRlsSubscriber();
    const queryRunner = { query: vi.fn().mockResolvedValue([]) } as any;
    const event = { queryRunner, query: 'SELECT * FROM projects' } as any;

    await runWithTenantDatabaseContext({ tenantId: 'tenant-a', tenantSlug: 'a' }, async () => {
      await subscriber.beforeQuery(event);
      await subscriber.afterQuery({ ...event, success: true });
    });

    expect(queryRunner.query).toHaveBeenNthCalledWith(1,
      expect.stringContaining("set_config('enterpriseglue.tenant_id', $1"), ['tenant-a']);
    expect(queryRunner.query).toHaveBeenNthCalledWith(2,
      expect.stringContaining("set_config('enterpriseglue.tenant_id', '', false)"));
  });
});

describe('pooled PostgreSQL role verification', () => {
  it('backfills and protects the canonical authorization audit table', async () => {
    expect(POSTGRES_TENANT_RLS_TABLES).toContain('authz_audit_log');
    expect(POSTGRES_TENANT_RLS_TABLES).not.toContain('authz_audit_logs');

    const query = vi.fn().mockResolvedValue([]);
    const queryRunner = {
      connection: {
        entityMetadatas: [{
          tableName: 'authz_audit_log',
          tablePath: 'main.authz_audit_log',
          columns: [{ databaseName: 'tenant_id' }],
        }],
        driver: { escape: (value: string) => `"${value}"` },
      },
      hasTable: vi.fn().mockResolvedValue(true),
      query,
    } as any;

    await new BackfillNativeTenantOwnership1700000000125().up(queryRunner);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE "main"."authz_audit_log"'));
  });

  it('keeps the timestamped TypeORM migration module constructor-only', async () => {
    const migrationModule = await import('@enterpriseglue/shared/db/migrations/1700000000126-add-postgres-tenant-rls.js');
    expect(Object.keys(migrationModule)).toEqual(['AddPostgresTenantRls1700000000126']);
  });

  it('reports whether the application role can bypass row security', async () => {
    const queryRunner = {
      connection: { options: { type: 'postgres' } },
      query: vi.fn().mockResolvedValue([{
        role: 'enterpriseglue_app',
        rolsuper: false,
        rolbypassrls: false,
      }]),
    } as any;

    await expect(verifyPostgresTenantRlsRole(queryRunner)).resolves.toEqual({
      role: 'enterpriseglue_app',
      superuser: false,
      bypassRls: false,
    });
  });
});
