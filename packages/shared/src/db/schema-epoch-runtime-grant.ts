import type { DataSource, QueryRunner } from 'typeorm';

const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const EXPECTED_PRIVILEGES = ['INSERT', 'SELECT', 'UPDATE'];

const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, '""')}"`;

/** Grant only the exact DML needed by the 0131 cohort protocol. This does not
 * invoke the generic grant refresh, alter default privileges, or touch any
 * pre-existing table. */
export async function grantSchemaEpochReleaseEffectCohortRuntimePrivileges(
  dataSource: DataSource,
  queryRunner: QueryRunner,
  runtimeRole: string,
): Promise<void> {
  const { table, role } = await verifyRuntimeRoleAndTable(dataSource, queryRunner, runtimeRole);
  await queryRunner.query(`REVOKE ALL PRIVILEGES ON TABLE ${table} FROM ${role}`);
  await queryRunner.query(`GRANT SELECT, INSERT, UPDATE ON TABLE ${table} TO ${role}`);
  await verifySchemaEpochReleaseEffectCohortRuntimePrivileges(dataSource, queryRunner, runtimeRole);
}

async function verifyRuntimeRoleAndTable(
  dataSource: DataSource,
  queryRunner: QueryRunner,
  runtimeRole: string,
): Promise<{ table: string; role: string }> {
  if (!ROLE_PATTERN.test(runtimeRole)) throw new Error('Schema-epoch runtime role is invalid');
  const schema = String(
    (dataSource.options as typeof dataSource.options & { schema?: string }).schema || 'public',
  );
  const metadata = dataSource.getMetadata('ReleaseEffectCohort');
  if ((metadata.schema || schema) !== schema || !await queryRunner.hasTable(metadata.tablePath)) {
    throw new Error('Schema-epoch release-effect cohort table is not the exact owner-schema relation');
  }

  const roles: Array<{ safe: boolean; schema_usage: boolean }> = await queryRunner.query(`SELECT
    NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication)
      AND r.rolname<>current_user
      AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner=r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relowner=r.oid) AS safe,
    has_schema_privilege(r.rolname, $2, 'USAGE') AS schema_usage
    FROM pg_roles r WHERE r.rolname=$1`, [runtimeRole, schema]);
  if (roles.length !== 1 || roles[0].safe !== true || roles[0].schema_usage !== true) {
    throw new Error('Schema-epoch runtime role must be restricted, nonowning, membership-free, and have schema USAGE');
  }

  return {
    table: metadata.tablePath.split('.').map(quoteIdentifier).join('.'),
    role: quoteIdentifier(runtimeRole),
  };
}

/** Read-only preflight for the exact configured role and 0131 table grant. */
export async function verifySchemaEpochReleaseEffectCohortRuntimePrivileges(
  dataSource: DataSource,
  queryRunner: QueryRunner,
  runtimeRole: string,
): Promise<void> {
  await verifyRuntimeRoleAndTable(dataSource, queryRunner, runtimeRole);
  const schema = String(
    (dataSource.options as typeof dataSource.options & { schema?: string }).schema || 'public',
  );
  const metadata = dataSource.getMetadata('ReleaseEffectCohort');

  const grants: Array<{ privilege_type: string }> = await queryRunner.query(
    `SELECT privilege_type FROM information_schema.role_table_grants
      WHERE grantee=$1 AND table_schema=$2 AND table_name=$3 ORDER BY privilege_type`,
    [runtimeRole, schema, metadata.tableName],
  );
  if (JSON.stringify(grants.map((row) => row.privilege_type)) !== JSON.stringify(EXPECTED_PRIVILEGES)) {
    throw new Error('Schema-epoch runtime role did not receive the exact release-effect cohort privileges');
  }
  const effective: Array<{
    select_ok: boolean; insert_ok: boolean; update_ok: boolean;
    delete_ok: boolean; truncate_ok: boolean; references_ok: boolean; trigger_ok: boolean;
  }> = await queryRunner.query(`SELECT
    has_table_privilege($1, $2, 'SELECT') AS select_ok,
    has_table_privilege($1, $2, 'INSERT') AS insert_ok,
    has_table_privilege($1, $2, 'UPDATE') AS update_ok,
    has_table_privilege($1, $2, 'DELETE') AS delete_ok,
    has_table_privilege($1, $2, 'TRUNCATE') AS truncate_ok,
    has_table_privilege($1, $2, 'REFERENCES') AS references_ok,
    has_table_privilege($1, $2, 'TRIGGER') AS trigger_ok`, [runtimeRole, metadata.tablePath]);
  if (
    effective.length !== 1
    || effective[0].select_ok !== true
    || effective[0].insert_ok !== true
    || effective[0].update_ok !== true
    || effective[0].delete_ok !== false
    || effective[0].truncate_ok !== false
    || effective[0].references_ok !== false
    || effective[0].trigger_ok !== false
  ) throw new Error('Schema-epoch runtime role has unexpected effective release-effect cohort privileges');
}
