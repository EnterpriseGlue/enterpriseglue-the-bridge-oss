import type { DataSource, QueryRunner } from 'typeorm';
import {
  applySchemaEpochRuntimeTablePrivileges,
  inspectSchemaEpochRuntimeRole,
  readSchemaEpochRuntimeDirectTablePrivileges,
  readSchemaEpochRuntimeEffectiveTablePrivileges,
} from './postgres-runtime-grants.js';

const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const EXPECTED_PRIVILEGES = ['INSERT', 'SELECT', 'UPDATE'];

/** Grant only the exact DML needed by the 0131 cohort protocol. This does not
 * invoke the generic grant refresh, alter default privileges, or touch any
 * pre-existing table. */
export async function grantSchemaEpochReleaseEffectCohortRuntimePrivileges(
  dataSource: DataSource,
  queryRunner: QueryRunner,
  runtimeRole: string,
): Promise<void> {
  const { schema, tableName } = await verifyRuntimeRoleAndTable(dataSource, queryRunner, runtimeRole);
  await applySchemaEpochRuntimeTablePrivileges(queryRunner, schema, tableName, runtimeRole);
  await verifySchemaEpochReleaseEffectCohortRuntimePrivileges(dataSource, queryRunner, runtimeRole);
}

async function verifyRuntimeRoleAndTable(
  dataSource: DataSource,
  queryRunner: QueryRunner,
  runtimeRole: string,
): Promise<{ schema: string; tableName: string }> {
  if (!ROLE_PATTERN.test(runtimeRole)) throw new Error('Schema-epoch runtime role is invalid');
  const schema = String(
    (dataSource.options as typeof dataSource.options & { schema?: string }).schema || 'public',
  );
  const metadata = dataSource.getMetadata('ReleaseEffectCohort');
  if ((metadata.schema || schema) !== schema || !await queryRunner.hasTable(metadata.tablePath)) {
    throw new Error('Schema-epoch release-effect cohort table is not the exact owner-schema relation');
  }

  const roles = await inspectSchemaEpochRuntimeRole(queryRunner, runtimeRole, schema);
  if (roles.length !== 1 || roles[0].safe !== true || roles[0].schema_usage !== true) {
    throw new Error('Schema-epoch runtime role must be restricted, nonowning, membership-free, and have schema USAGE');
  }

  return {
    schema,
    tableName: metadata.tableName,
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

  // information_schema.role_table_grants deliberately hides grants from a
  // membership-free preflight login that is neither grantor nor grantee. Read
  // the relation ACL itself so that a distinct, restricted verifier observes
  // the exact direct grant without acquiring membership in the runtime role.
  const grants = await readSchemaEpochRuntimeDirectTablePrivileges(
    queryRunner,
    runtimeRole,
    schema,
    metadata.tableName,
  );
  if (JSON.stringify(grants.map((row) => row.privilege_type)) !== JSON.stringify(EXPECTED_PRIVILEGES)) {
    throw new Error('Schema-epoch runtime role did not receive the exact release-effect cohort privileges');
  }
  const effective = await readSchemaEpochRuntimeEffectiveTablePrivileges(
    queryRunner,
    runtimeRole,
    schema,
    metadata.tableName,
  );
  if (
    effective.length !== 1
    || effective[0].select_ok !== true
    || effective[0].insert_ok !== true
    || effective[0].update_ok !== true
    || effective[0].delete_ok !== false
    || effective[0].truncate_ok !== false
    || effective[0].references_ok !== false
    || effective[0].trigger_ok !== false
    || effective[0].public_grant !== false
  ) throw new Error('Schema-epoch runtime role has unexpected effective release-effect cohort privileges');
}
