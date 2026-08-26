import type { MigrationInterface, QueryRunner } from 'typeorm';
import { POSTGRES_TENANT_RLS_TABLES } from '../postgres-tenant-rls.js';

function tableRef(queryRunner: QueryRunner, tablePath: string): string {
  return tablePath.split('.').map((part) => queryRunner.connection.driver.escape(part)).join('.');
}

const predicate = "COALESCE(NULLIF(current_setting('enterpriseglue.tenancy_mode', true), ''), 'single') <> 'pooled' OR tenant_id = NULLIF(current_setting('enterpriseglue.tenant_id', true), '')";

export class AddPostgresTenantRls1700000000126 implements MigrationInterface {
  name = 'AddPostgresTenantRls1700000000126';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;
    for (const metadata of queryRunner.connection.entityMetadatas) {
      if (!POSTGRES_TENANT_RLS_TABLES.has(metadata.tableName) || !metadata.columns.some((column) => column.databaseName === 'tenant_id')) continue;
      if (!await queryRunner.hasTable(metadata.tablePath)) continue;
      const table = tableRef(queryRunner, metadata.tablePath);
      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`DROP POLICY IF EXISTS eg_tenant_isolation ON ${table}`);
      await queryRunner.query(`CREATE POLICY eg_tenant_isolation ON ${table} USING (${predicate}) WITH CHECK (${predicate})`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;
    for (const metadata of queryRunner.connection.entityMetadatas) {
      if (!POSTGRES_TENANT_RLS_TABLES.has(metadata.tableName) || !await queryRunner.hasTable(metadata.tablePath)) continue;
      const table = tableRef(queryRunner, metadata.tablePath);
      await queryRunner.query(`DROP POLICY IF EXISTS eg_tenant_isolation ON ${table}`);
      await queryRunner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    }
  }
}
