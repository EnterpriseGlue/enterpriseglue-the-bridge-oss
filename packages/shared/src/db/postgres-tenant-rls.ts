import type { QueryRunner } from 'typeorm';

import {
  assertTenantPersistenceOwnershipV1,
  POSTGRES_TENANT_RLS_TABLES,
} from './tenant-ownership-inventory.js';

export { POSTGRES_TENANT_RLS_TABLES } from './tenant-ownership-inventory.js';

export async function verifyPostgresTenantRls(queryRunner: QueryRunner): Promise<{ expected: number; enforced: number }> {
  if (queryRunner.connection.options.type !== 'postgres') return { expected: 0, enforced: 0 };
  assertTenantPersistenceOwnershipV1(queryRunner.connection.entityMetadatas);
  let expected = 0;
  let enforced = 0;
  for (const metadata of queryRunner.connection.entityMetadatas) {
    if (!POSTGRES_TENANT_RLS_TABLES.has(metadata.tableName) || !metadata.columns.some((column) => column.databaseName === 'tenant_id')) continue;
    if (!await queryRunner.hasTable(metadata.tablePath)) continue;
    expected += 1;
    const schema = metadata.schema || String((queryRunner.connection.options as { schema?: string }).schema || 'public');
    const rows: Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean; policy_count: string | number }> = await queryRunner.query(
      "SELECT c.relrowsecurity, c.relforcerowsecurity, COUNT(p.policyname) AS policy_count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname WHERE n.nspname = $1 AND c.relname = $2 GROUP BY c.relrowsecurity, c.relforcerowsecurity",
      [schema, metadata.tableName],
    );
    const row = rows[0];
    if (row?.relrowsecurity && row.relforcerowsecurity && Number(row.policy_count) > 0) enforced += 1;
  }
  return { expected, enforced };
}

export async function verifyPostgresTenantRlsRole(queryRunner: QueryRunner): Promise<{
  role: string;
  superuser: boolean;
  bypassRls: boolean;
}> {
  if (queryRunner.connection.options.type !== 'postgres') {
    return { role: '', superuser: false, bypassRls: false };
  }
  const rows: Array<{ role: string; rolsuper: boolean; rolbypassrls: boolean }> = await queryRunner.query(
    'SELECT current_user AS role, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user',
  );
  const row = rows[0];
  if (!row) throw new Error('Unable to verify the PostgreSQL application role for pooled tenancy.');
  return { role: row.role, superuser: row.rolsuper, bypassRls: row.rolbypassrls };
}
