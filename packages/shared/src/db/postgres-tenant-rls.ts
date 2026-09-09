import type { QueryRunner } from 'typeorm';
import { getPlatformDatabaseCapability } from '../services/platform-database-context.js';
import { POSTGRES_TENANT_POLICY_COMMANDS, postgresTenantPolicyAttestationMatches, readPostgresTenantPolicyCatalog } from './postgres-tenant-policy.js';

import {
  assertTenantPersistenceOwnershipV1,
  POSTGRES_TENANT_RLS_TABLES,
} from './tenant-ownership-inventory.js';

export { POSTGRES_TENANT_RLS_TABLES } from './tenant-ownership-inventory.js';

export type PostgresTenantPolicyProfile =
  | 'legacy-explicit-runtime-compatible/v1'
  | 'explicit-context/v1';

interface LegacyPostgresTenantPolicyCatalogRow {
  policy_name: string;
  command: string;
  permissive: string;
  roles: string[];
  using_expression: string | null;
  check_expression: string | null;
}

const legacyTenantPolicySource = "COALESCE(NULLIF(current_setting('enterpriseglue.tenancy_mode', true), ''), 'single') <> 'pooled' OR tenant_id = NULLIF(current_setting('enterpriseglue.tenant_id', true), '')";

/** PostgreSQL adds harmless text casts and parentheses while deparsing. Strip
 * only those two presentation details; all function, setting, literal,
 * operator and column tokens remain byte-sensitive. */
export function normalizeLegacyPostgresTenantPolicyExpression(expression: string): string {
  return expression
    .replace(/::(?:pg_catalog\.)?text/g, '')
    .replace(/[()\s]/g, '');
}

export function legacyPostgresTenantPolicyMatches(row: LegacyPostgresTenantPolicyCatalogRow): boolean {
  if (
    row.policy_name !== 'eg_tenant_isolation'
    || row.command !== 'ALL'
    || row.permissive !== 'PERMISSIVE'
    || row.roles.length !== 1
    || row.roles[0] !== 'public'
    || typeof row.using_expression !== 'string'
    || typeof row.check_expression !== 'string'
  ) return false;
  const expected = normalizeLegacyPostgresTenantPolicyExpression(legacyTenantPolicySource);
  return normalizeLegacyPostgresTenantPolicyExpression(row.using_expression) === expected
    && normalizeLegacyPostgresTenantPolicyExpression(row.check_expression) === expected;
}

async function verifyLegacyPostgresTenantRls(queryRunner: QueryRunner): Promise<{ expected: number; enforced: number }> {
  assertTenantPersistenceOwnershipV1(queryRunner.connection.entityMetadatas);
  let expected = 0;
  let enforced = 0;
  for (const metadata of queryRunner.connection.entityMetadatas) {
    if (!POSTGRES_TENANT_RLS_TABLES.has(metadata.tableName) || !metadata.columns.some((column) => column.databaseName === 'tenant_id')) continue;
    if (!await queryRunner.hasTable(metadata.tablePath)) continue;
    expected += 1;
    const schema = metadata.schema || String((queryRunner.connection.options as { schema?: string }).schema || 'public');
    const rows: Array<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      policies: LegacyPostgresTenantPolicyCatalogRow[];
    }> = await queryRunner.query(
      `SELECT c.relrowsecurity,c.relforcerowsecurity,COALESCE(json_agg(json_build_object(
          'policy_name',p.policyname,'command',p.cmd,'permissive',p.permissive,'roles',p.roles,
          'using_expression',p.qual,'check_expression',p.with_check
        )) FILTER (WHERE p.policyname IS NOT NULL),'[]'::json) AS policies
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_policies p ON p.schemaname=n.nspname AND p.tablename=c.relname
        WHERE n.nspname=$1 AND c.relname=$2 GROUP BY c.relrowsecurity,c.relforcerowsecurity`,
      [schema, metadata.tableName],
    );
    const row = rows[0];
    if (
      row?.relrowsecurity
      && row.relforcerowsecurity
      && Array.isArray(row.policies)
      && row.policies.length === 1
      && legacyPostgresTenantPolicyMatches(row.policies[0])
    ) enforced += 1;
  }
  return { expected, enforced };
}

export async function verifyPostgresTenantRlsForPolicyProfile(
  queryRunner: QueryRunner,
  profile: PostgresTenantPolicyProfile,
): Promise<{ expected: number; enforced: number }> {
  if (queryRunner.connection.options.type !== 'postgres') return { expected: 0, enforced: 0 };
  return profile === 'legacy-explicit-runtime-compatible/v1'
    ? verifyLegacyPostgresTenantRls(queryRunner)
    : verifyPostgresTenantRls(queryRunner);
}

/** Runtime verification is independent of the optional migration grant hook. */
export async function assertRestrictedPostgresRuntimeRole(queryRunner: QueryRunner): Promise<void> {
  if (queryRunner.connection.options.type !== 'postgres') return;
  const schema = (queryRunner.connection.options as {schema?:string}).schema || 'public';
  const rows: Array<{safe:boolean}> = await queryRunner.query(`SELECT
    NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication)
    AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid)
    AND NOT EXISTS (SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=r.oid AND deptype='o')
    AND NOT has_schema_privilege(r.oid,$1,'CREATE')
    AND NOT has_database_privilege(r.oid,current_database(),'CREATE') AS safe
    FROM pg_roles r WHERE r.rolname=current_user`, [schema]);
  if (rows.length !== 1 || rows[0].safe !== true) throw new Error('Pooled PostgreSQL runtime requires a restricted nonowning role without memberships or CREATE privileges');
}

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
    const capability = getPlatformDatabaseCapability();
    const migrationLease = capability?.kind === 'migration-execution' && capability.schema === schema;
    const rows: Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean; policy_count: string | number; expected_count: string | number }> = await queryRunner.query(
      `SELECT c.relrowsecurity,c.relforcerowsecurity,
        COUNT(p.policyname) FILTER (WHERE NOT (p.policyname='eg_migration_execution' AND $3
          AND n.nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))) AS policy_count,
        COUNT(p.policyname) FILTER (WHERE p.policyname='eg_tenant_isolation_' || lower(p.cmd)
          AND p.cmd IN ('SELECT','INSERT','UPDATE','DELETE') AND p.permissive='PERMISSIVE'
          AND p.roles=ARRAY['public']::name[]
          AND (p.cmd='INSERT' OR p.qual IS NOT NULL)
          AND (p.cmd IN ('SELECT','DELETE') OR p.with_check IS NOT NULL)) AS expected_count
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_policies p ON p.schemaname=n.nspname AND p.tablename=c.relname
        WHERE n.nspname=$1 AND c.relname=$2 GROUP BY c.relrowsecurity,c.relforcerowsecurity`,
      [schema, metadata.tableName, migrationLease],
    );
    const row = rows[0];
    if (row?.relrowsecurity && row.relforcerowsecurity && Number(row.policy_count) === 4 && Number(row.expected_count) === 4) {
      const catalog = await readPostgresTenantPolicyCatalog(queryRunner, schema, metadata.tableName);
      if (Array.isArray(catalog) && catalog.length === 4 && POSTGRES_TENANT_POLICY_COMMANDS.every(command => {
        const policy = catalog.find(item => item.policy_name === `eg_tenant_isolation_${command.toLowerCase()}`);
        return policy && postgresTenantPolicyAttestationMatches(schema, metadata.tableName, command, policy);
      })) enforced += 1;
    }
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
