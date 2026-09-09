import type { DataSource } from 'typeorm';
import { config } from '../config/index.js';
import { runWithPlatformDatabaseCapability } from '../services/platform-database-context.js';
import { POSTGRES_TENANT_RLS_TABLES } from './tenant-ownership-inventory.js';
import { logger } from '../utils/logger.js';

/** Owner identity is confined to the existing migration-job transport. This
 * lease never changes roles, credentials, RLS flags or application privileges. */
export async function withPostgresMigrationContext<T>(
  source: DataSource, mode: 'apply' | 'verify', work: () => Promise<T>,
): Promise<T> {
  if (source.options.type !== 'postgres' || mode !== 'apply' || config.tenancyMode === 'single') return work();
  const schema = source.options.schema || 'public';
  const runner = source.createQueryRunner();
  let ownerRole: string;
  try {
    const rows: Array<{ role: string; safe: boolean }> = await runner.query(`
      SELECT current_user AS role,
        EXISTS (SELECT 1 FROM pg_namespace WHERE nspname=$1 AND nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))
        AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname=$1 AND c.relkind IN ('r','p','S','v','m','f') AND c.relowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS safe`, [schema]);
    if (rows.length !== 1 || rows[0].safe !== true) throw new Error('Pooled migration execution requires the independently verified schema owner');
    ownerRole = rows[0].role;
    const runtimeRole = process.env.EG_POSTGRES_RUNTIME_ROLE;
    if (runtimeRole !== undefined) {
      const roles: Array<{ safe: boolean }> = await runner.query(`SELECT
        NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication)
        AND r.rolname<>current_user
        AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid)
        AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner=r.oid)
        AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relowner=r.oid) AS safe
        FROM pg_roles r WHERE r.rolname=$1`, [runtimeRole]);
      if (roles.length !== 1 || roles[0].safe !== true) throw new Error('Configured PostgreSQL runtime role must be restricted, nonowning and have no memberships');
    }
  } finally {
    await runner.release();
  }
  return (async () => {
    const transport = source.createQueryRunner();
    const tables: number[] = [];
    let primaryFailure: unknown;
    try {
      // Existing FORCE-RLS schemas can have pending historical DML before the
      // new policy migration. Add only a temporary, actual-owner-bound branch;
      // do not weaken tenant policies or rewrite historical migrations.
      for (const metadata of source.entityMetadatas) {
        if (!POSTGRES_TENANT_RLS_TABLES.has(metadata.tableName) || !metadata.columns.some(column => column.databaseName === 'tenant_id')) continue;
        if ((metadata.schema || schema) !== schema) throw new Error('Migration relation is outside the verified owner schema');
        const relations: Array<{oid:number}> = await transport.query(`SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname=$1 AND c.relname=$2 AND c.relkind IN ('r','p') AND c.relrowsecurity AND c.relforcerowsecurity`, [schema,metadata.tableName]);
        if (relations.length === 0) continue;
        const table = metadata.tablePath.split('.').map(part => source.driver.escape(part)).join('.');
        const literal = `'${schema.replace(/'/g, "''")}'`;
        const cap = "COALESCE(NULLIF(current_setting('enterpriseglue.platform_capability',true),''),'{}')::jsonb";
        const predicate = `(${cap}->>'kind')='migration-execution' AND (${cap}->>'schema')=${literal} AND (${cap}->>'ownerRole')=current_user AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname=${literal} AND nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))`;
        tables.push(relations[0].oid);
        await transport.query(`DROP POLICY IF EXISTS eg_migration_execution ON ${table}`);
        await transport.query(`CREATE POLICY eg_migration_execution ON ${table} USING (${predicate}) WITH CHECK (${predicate})`);
      }
      await transport.release();
      return await runWithPlatformDatabaseCapability({ kind: 'migration-execution', schema, ownerRole }, work);
    } catch (error) {
      primaryFailure = error;
      throw error;
    } finally {
      await transport.release();
      const cleanup = source.createQueryRunner();
      let cleanupFailures = 0;
      try {
        // OIDs survive rename; a legitimately dropped relation needs no cleanup.
        // Attempt every bounded relation even when one cleanup fails.
        for (const oid of tables) {
          try {
            const relations: Array<{schema:string;name:string}> = await cleanup.query(`SELECT n.nspname AS schema,c.relname AS name
              FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=$1`, [oid]);
            if (!relations[0]) continue;
            const table = `${source.driver.escape(relations[0].schema)}.${source.driver.escape(relations[0].name)}`;
            await cleanup.query(`DROP POLICY IF EXISTS eg_migration_execution ON ${table}`);
          } catch { cleanupFailures += 1; }
        }
      } finally { await cleanup.release(); }
      if (cleanupFailures) {
        logger.error('Migration security policy cleanup incomplete', {count:cleanupFailures});
        if (!primaryFailure) throw new Error('Migration security policy cleanup incomplete');
      }
    }
  })();
}
