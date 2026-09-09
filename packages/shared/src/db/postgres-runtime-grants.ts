import type { QueryRunner } from 'typeorm';

const identifier = (value: string): string => `"${value.replace(/"/g, '""')}"`;

/** PostgreSQL ACLs have no portable TypeORM API; keep this SQL at the DB boundary. */
async function quarantinedPostgresSQL<T = unknown[]>(runner: QueryRunner, sql: string, parameters?: unknown[]): Promise<T> {
  return runner.query(sql, parameters);
}

/** Apply only after owner migrations, in a single transaction. Never creates or alters roles. */
export async function refreshPostgresRuntimeGrants(runner: QueryRunner, runtimeRole: string): Promise<void> {
  if (runner.connection.options.type !== 'postgres') throw new Error('EG_POSTGRES_RUNTIME_ROLE requires PostgreSQL');
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole) || runtimeRole.startsWith('pg_')) {
    throw new Error('EG_POSTGRES_RUNTIME_ROLE must be a non-system PostgreSQL role identifier');
  }
  const options = runner.connection.options as { schema?: string; migrationsTableName?: string };
  const schema = options.schema || 'public';
  const ledger = options.migrationsTableName || 'migrations';
  const role = identifier(runtimeRole);
  const schemaRef = identifier(schema);
  if (runner.isTransactionActive) throw new Error('Runtime grant refresh requires its own transaction');
  await runner.startTransaction();
  try {
    const rows = await quarantinedPostgresSQL<Array<{ safe: boolean }>>(runner, `
      SELECT NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
        AND r.rolcanlogin AND r.rolname <> current_user
        AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid)
        AND NOT EXISTS (SELECT 1 FROM pg_shdepend d WHERE d.refclassid = 'pg_authid'::regclass AND d.refobjid = r.oid AND d.deptype = 'o')
        AND NOT has_schema_privilege(r.oid, $2, 'CREATE')
        AND NOT has_database_privilege(r.oid, current_database(), 'CREATE') AS safe
      FROM pg_roles r WHERE r.rolname = $1`, [runtimeRole, schema]);
    if (!rows[0]?.safe) throw new Error('Runtime role must exist, allow login, and have no ownership, memberships, administrative or CREATE privileges');
    // Schema-local REVOKE cannot subtract a global default or a PUBLIC grant.
    const defaults = await quarantinedPostgresSQL<Array<{ unsafe: boolean }>>(runner, `
      SELECT EXISTS (
        SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
        WHERE d.defaclrole = current_user::regrole AND d.defaclobjtype IN ('r', 'S')
          AND (d.defaclnamespace = 0 OR d.defaclnamespace = (SELECT oid FROM pg_namespace WHERE nspname = $2))
          AND (a.grantee = 0 OR (d.defaclnamespace = 0 AND a.grantee = $1::regrole))
          AND (a.privilege_type <> 'SELECT' OR a.is_grantable)
      ) AS unsafe`, [runtimeRole, schema]);
    if (defaults[0]?.unsafe) throw new Error('Unsafe global or PUBLIC default privileges must be removed before runtime grants are refreshed');

    const relations = await quarantinedPostgresSQL<Array<{ name: string; kind: string; owned: boolean; ledger_sequence: boolean }>>(runner, `
      SELECT c.relname AS name, c.relkind AS kind, c.relowner = current_user::regrole AS owned,
        EXISTS (SELECT 1 FROM pg_depend d JOIN pg_class t ON t.oid = d.refobjid
          WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.refclassid = 'pg_class'::regclass
            AND d.deptype IN ('a', 'i') AND t.relnamespace = n.oid AND t.relname = $2) AS ledger_sequence
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'S') ORDER BY c.relname`, [schema, ledger]);
    if (!relations.some((relation) => relation.name === ledger && relation.kind !== 'S')) throw new Error('Migration ledger must exist before runtime grants are refreshed');
    if (relations.some((relation) => !relation.owned)) throw new Error('Migration identity must own every managed table and sequence');
    await quarantinedPostgresSQL(runner, `REVOKE ALL ON SCHEMA ${schemaRef} FROM ${role}`);
    await quarantinedPostgresSQL(runner, `GRANT USAGE ON SCHEMA ${schemaRef} TO ${role}`);
    for (const relation of relations) {
      const target = `${schemaRef}.${identifier(relation.name)}`;
      const sequence = relation.kind === 'S';
      await quarantinedPostgresSQL(runner, `REVOKE ALL ON ${sequence ? 'SEQUENCE' : 'TABLE'} ${target} FROM ${role}`);
      await quarantinedPostgresSQL(runner, `GRANT ${sequence ? relation.ledger_sequence ? 'SELECT' : 'USAGE, SELECT' : relation.name === ledger ? 'SELECT' : 'SELECT, INSERT, UPDATE, DELETE'} ON ${sequence ? 'SEQUENCE' : 'TABLE'} ${target} TO ${role}`);
      const effective = await quarantinedPostgresSQL<Array<{ unsafe: boolean }>>(runner,
        sequence
          ? `SELECT has_sequence_privilege($1, $2, '${relation.ledger_sequence ? 'USAGE,UPDATE' : 'UPDATE'}') AS unsafe`
          : `SELECT has_table_privilege($1, $2, '${relation.name === ledger ? 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER' : 'TRUNCATE,REFERENCES,TRIGGER'}')
              OR has_any_column_privilege($1, $2, '${relation.name === ledger ? 'INSERT,UPDATE,REFERENCES' : 'REFERENCES'}') AS unsafe`,
        [runtimeRole, target]);
      if (effective[0]?.unsafe) throw new Error('Runtime role inherits unsafe privileges through PUBLIC');
    }
    await quarantinedPostgresSQL(runner, `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaRef} REVOKE ALL ON TABLES FROM ${role}`);
    await quarantinedPostgresSQL(runner, `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaRef} GRANT SELECT ON TABLES TO ${role}`);
    await quarantinedPostgresSQL(runner, `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaRef} REVOKE ALL ON SEQUENCES FROM ${role}`);
    await quarantinedPostgresSQL(runner, `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaRef} GRANT SELECT ON SEQUENCES TO ${role}`);
    await runner.commitTransaction();
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  }
}
