import type { DataSource, EntityTarget, QueryRunner } from 'typeorm';
import { CloudEmailSignup } from '../infrastructure/persistence/entities/CloudEmailSignup.js';
import { CloudPasskey } from '../infrastructure/persistence/entities/CloudPasskey.js';
import { CloudPasskeyChallenge } from '../infrastructure/persistence/entities/CloudPasskeyChallenge.js';
import {
  applySchemaEpochRuntimeTablePrivileges,
  inspectSchemaEpochRuntimeRole,
  readSchemaEpochRuntimeDirectTablePrivileges,
  readSchemaEpochRuntimeEffectiveTablePrivileges,
  readSchemaEpochRuntimeTableColumns,
} from './postgres-runtime-grants.js';

type DmlPrivilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

const tables: ReadonlyArray<{ entity: EntityTarget<unknown>; privileges: readonly DmlPrivilege[] }> = [
  { entity: CloudEmailSignup, privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] },
  { entity: CloudPasskey, privileges: ['SELECT', 'INSERT', 'UPDATE'] },
  { entity: CloudPasskeyChallenge, privileges: ['SELECT', 'INSERT', 'DELETE'] },
];

async function inspectRelations(dataSource: DataSource, runner: QueryRunner, runtimeRole: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole) || runtimeRole.startsWith('pg_')) {
    throw new Error('Cloud passkey runtime role is invalid');
  }
  if (runner.connection.options.type !== 'postgres') {
    throw new Error('Cloud passkey runtime grants require PostgreSQL');
  }
  const schema = String((dataSource.options as typeof dataSource.options & { schema?: string }).schema || 'public');
  const roles = await inspectSchemaEpochRuntimeRole(runner, runtimeRole, schema);
  if (roles.length !== 1 || roles[0].safe !== true || roles[0].schema_usage !== true) {
    throw new Error('Cloud passkey runtime role must be restricted, nonowning, membership-free, and have schema USAGE');
  }
  return Promise.all(tables.map(async ({ entity, privileges }) => {
    const metadata = dataSource.getMetadata(entity);
    if ((metadata.schema || schema) !== schema) {
      throw new Error('Cloud passkey table is not in the exact owner schema');
    }
    const actualColumns = (await readSchemaEpochRuntimeTableColumns(runner, schema, metadata.tableName))
      .map((column) => column.name).sort();
    const expectedColumns = metadata.columns.map((column) => column.databaseName).sort();
    if (JSON.stringify(actualColumns) !== JSON.stringify(expectedColumns)) {
      throw new Error(`Cloud passkey table ${metadata.tableName} differs from the signed entity columns`);
    }
    return { schema, tableName: metadata.tableName, privileges };
  }));
}

/** Grant only the DML used by the three signed 0133 account-authentication tables. */
export async function grantSchemaEpochCloudPasskeyRuntimePrivileges(
  dataSource: DataSource,
  runner: QueryRunner,
  runtimeRole: string,
): Promise<void> {
  const relations = await inspectRelations(dataSource, runner, runtimeRole);
  for (const relation of relations) {
    await applySchemaEpochRuntimeTablePrivileges(
      runner, relation.schema, relation.tableName, runtimeRole, relation.privileges,
    );
  }
  await verifySchemaEpochCloudPasskeyRuntimePrivileges(dataSource, runner, runtimeRole);
}

/** Read-only preflight rejects omitted, inherited, PUBLIC, or excess grants. */
export async function verifySchemaEpochCloudPasskeyRuntimePrivileges(
  dataSource: DataSource,
  runner: QueryRunner,
  runtimeRole: string,
): Promise<void> {
  const relations = await inspectRelations(dataSource, runner, runtimeRole);
  for (const relation of relations) {
    const direct = await readSchemaEpochRuntimeDirectTablePrivileges(
      runner, runtimeRole, relation.schema, relation.tableName,
    );
    const expected = [...relation.privileges].sort();
    if (JSON.stringify(direct.map((row) => row.privilege_type)) !== JSON.stringify(expected)) {
      throw new Error(`Cloud passkey runtime role has incorrect direct ${relation.tableName} privileges`);
    }
    const effective = await readSchemaEpochRuntimeEffectiveTablePrivileges(
      runner, runtimeRole, relation.schema, relation.tableName,
    );
    if (effective.length !== 1
      || effective[0].select_ok !== relation.privileges.includes('SELECT')
      || effective[0].insert_ok !== relation.privileges.includes('INSERT')
      || effective[0].update_ok !== relation.privileges.includes('UPDATE')
      || effective[0].delete_ok !== relation.privileges.includes('DELETE')
      || effective[0].truncate_ok !== false
      || effective[0].references_ok !== false
      || effective[0].trigger_ok !== false
      || effective[0].public_grant !== false
      || effective[0].column_grant !== false) {
      throw new Error(`Cloud passkey runtime role has unexpected effective ${relation.tableName} privileges`);
    }
  }
}
