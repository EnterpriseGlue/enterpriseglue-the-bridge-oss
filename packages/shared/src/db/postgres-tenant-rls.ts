import type { QueryRunner } from 'typeorm';
import { getPlatformDatabaseCapability } from '../services/platform-database-context.js';
import {
  LEGACY_POSTGRES_TENANT_POLICY_SOURCE,
  POSTGRES_TENANT_POLICY_COMMANDS,
  postgresTenantPolicyAttestationMatches,
  readPostgresTenantPolicyCatalog,
} from './postgres-tenant-policy.js';

import {
  assertTenantPersistenceOwnershipV1,
  POSTGRES_TENANT_RLS_TABLES,
} from './tenant-ownership-inventory.js';

export { POSTGRES_TENANT_RLS_TABLES } from './tenant-ownership-inventory.js';

export type PostgresTenantPolicyProfile =
  | 'legacy-tenant-context/v1'
  | 'dual-context-compatibility/v1'
  | 'explicit-context/v1';

interface LegacyPostgresTenantPolicyCatalogRow {
  policy_name: string;
  command: string;
  permissive: string;
  roles: string[];
  using_expression: string | null;
  check_expression: string | null;
}

interface PostgresTableIdentity {
  tableName: string;
  tablePath: string;
  schema?: string;
}

export type PostgresTableExistenceProbe = (
  queryRunner: QueryRunner,
  table: PostgresTableIdentity,
) => Promise<boolean>;

const typeormTableExists: PostgresTableExistenceProbe = (queryRunner, table) =>
  queryRunner.hasTable(table.tablePath);

/** Detect an owner-schema table without requiring privileges on its rows. */
export const postgresCatalogTableExists: PostgresTableExistenceProbe = async (
  queryRunner: QueryRunner,
  table: PostgresTableIdentity,
): Promise<boolean> => {
  // information_schema hides relations from the membership-free preflight
  // login because it deliberately has no business-table grants. pg_catalog
  // exposes relation metadata without granting any table data access.
  const schema = table.schema
    || String((queryRunner.connection.options as { schema?: string }).schema || 'public');
  const rows: Array<{ relation_exists: boolean }> = await queryRunner.query(
    `SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1 AND c.relname=$2 AND c.relkind IN ('r','p')
    ) AS relation_exists`,
    [schema, table.tableName],
  );
  if (rows.length !== 1 || typeof rows[0]?.relation_exists !== 'boolean') {
    throw new Error('PostgreSQL table catalog probe returned an invalid result');
  }
  return rows[0].relation_exists;
};

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
  const expected = normalizeLegacyPostgresTenantPolicyExpression(LEGACY_POSTGRES_TENANT_POLICY_SOURCE);
  return normalizeLegacyPostgresTenantPolicyExpression(row.using_expression) === expected
    && normalizeLegacyPostgresTenantPolicyExpression(row.check_expression) === expected;
}

async function verifyLegacyPostgresTenantRls(
  queryRunner: QueryRunner,
  tableExists: PostgresTableExistenceProbe,
): Promise<{ expected: number; enforced: number }> {
  assertTenantPersistenceOwnershipV1(queryRunner.connection.entityMetadatas);
  let expected = 0;
  let enforced = 0;
  for (const metadata of queryRunner.connection.entityMetadatas) {
    if (!POSTGRES_TENANT_RLS_TABLES.has(metadata.tableName) || !metadata.columns.some((column) => column.databaseName === 'tenant_id')) continue;
    if (!await tableExists(queryRunner, metadata)) continue;
    const schema = metadata.schema || String((queryRunner.connection.options as { schema?: string }).schema || 'public');
    expected += 1;
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
  tableExists: PostgresTableExistenceProbe = typeormTableExists,
): Promise<{ expected: number; enforced: number }> {
  if (queryRunner.connection.options.type !== 'postgres') return { expected: 0, enforced: 0 };
  return profile === 'legacy-tenant-context/v1'
    ? verifyLegacyPostgresTenantRls(queryRunner, tableExists)
    : verifyPostgresTenantRls(queryRunner, profile, tableExists);
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

export async function verifyPostgresTenantRls(
  queryRunner: QueryRunner,
  profile: Exclude<PostgresTenantPolicyProfile, 'legacy-tenant-context/v1'> = 'explicit-context/v1',
  tableExists: PostgresTableExistenceProbe = typeormTableExists,
): Promise<{ expected: number; enforced: number }> {
  if (queryRunner.connection.options.type !== 'postgres') return { expected: 0, enforced: 0 };
  assertTenantPersistenceOwnershipV1(queryRunner.connection.entityMetadatas);
  let expected = 0;
  let enforced = 0;
  for (const metadata of queryRunner.connection.entityMetadatas) {
    if (!POSTGRES_TENANT_RLS_TABLES.has(metadata.tableName) || !metadata.columns.some((column) => column.databaseName === 'tenant_id')) continue;
    if (!await tableExists(queryRunner, metadata)) continue;
    const schema = metadata.schema || String((queryRunner.connection.options as { schema?: string }).schema || 'public');
    expected += 1;
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
        return policy && postgresTenantPolicyAttestationMatches(schema, metadata.tableName, command, policy, profile);
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
