import type { MigrationInterface, QueryRunner } from 'typeorm';
import { POSTGRES_TENANT_RLS_TABLES } from '../postgres-tenant-rls.js';
import { applyPostgresTenantPolicies } from '../postgres-tenant-policy.js';

function tableRef(queryRunner: QueryRunner, tablePath: string): string {
  return tablePath.split('.').map((part) => queryRunner.connection.driver.escape(part)).join('.');
}

export class AddPostgresTenantRls1700000000126 implements MigrationInterface {
  name = 'AddPostgresTenantRls1700000000126';

  async up(queryRunner: QueryRunner): Promise<void> {
    await applyPostgresTenantPolicies(queryRunner);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;
    for (const metadata of queryRunner.connection.entityMetadatas) {
      if (!POSTGRES_TENANT_RLS_TABLES.has(metadata.tableName) || !await queryRunner.hasTable(metadata.tablePath)) continue;
      const table = tableRef(queryRunner, metadata.tablePath);
      await queryRunner.query(`DROP POLICY IF EXISTS eg_tenant_isolation ON ${table}`);
      for (const command of ['select', 'insert', 'update', 'delete']) {
        await queryRunner.query(`DROP POLICY IF EXISTS eg_tenant_isolation_${command} ON ${table}`);
      }
      await queryRunner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    }
  }
}
