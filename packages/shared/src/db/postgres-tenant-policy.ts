import type { QueryRunner } from 'typeorm';
import { createHash } from 'node:crypto';
import { POSTGRES_TENANT_RLS_TABLES } from './tenant-ownership-inventory.js';

const capability = "COALESCE(NULLIF(current_setting('enterpriseglue.platform_capability', true), ''), '{}')::jsonb";
const field = (key: string) => `(${capability}->>'${key}')`;
const kind = (...values: string[]) => `${field('kind')} IN (${values.map((value) => `'${value}'`).join(', ')})`;
const authenticatedGroup = "'system.group.authenticated_users'";
const systemGroups = ['platform_administrators','authenticated_users','access_administrators','access_auditors','user_administrators','sso_administrators','engine_registry_administrators','api_client_administrators'].map(name => `'system.group.${name}'`).join(',');
export const POSTGRES_TENANT_POLICY_COMMANDS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const;
type Command = typeof POSTGRES_TENANT_POLICY_COMMANDS[number];

/** PostgreSQL policies have no portable TypeORM API; isolate SQL at this boundary. */
async function quarantinedPostgresSQL(runner: QueryRunner, sql: string, parameters?: unknown[]): Promise<any> {
  return runner.query(sql, parameters);
}

/** Finite global branches. Unlisted tables/actions have no NULL-row authority. */
function globalPredicate(table: string, command: Command, membershipTable: string, userTable: string): string {
  const read = command === 'SELECT';
  const write = command === 'INSERT' || command === 'UPDATE';
  const clauses: string[] = [];
  if (table === 'identity_providers') {
    if (read) clauses.push(`(${kind('provider-discovery')} AND is_enabled AND authentication_mode = 'direct' AND protocol IN ('oidc', 'saml'))`);
    if (read) clauses.push(`(${kind('provider-lookup')} AND id = ${field('providerId')} AND is_enabled AND authentication_mode='direct' AND protocol IN ('oidc','saml'))`);
    if (read || command === 'UPDATE') clauses.push(`(${kind('provider-proof', 'provider-login', 'provider-account','session-account')} AND id = ${field('providerId')})`);
    if (read) clauses.push(kind('config-bootstrap'));
    if (write) clauses.push(`(${kind('config-bootstrap')} AND (${capability}->'providerKeys') ? key AND source_ref = 'config_bundle:' || ${field('bundleKey')})`);
  }
  if (table === 'config_bundle_apply_runs' && (read || write)) {
    clauses.push(`(${kind('config-bootstrap')} AND bundle_key = ${field('bundleKey')})`);
  }
  if (table === 'external_identities' && (read || write)) {
    if (read) clauses.push(`(${kind('provider-proof','provider-login')} AND provider_id=${field('providerId')} AND subject_id=${field('subjectId')})`);
    clauses.push(`(${kind('provider-account')} AND provider_id=${field('providerId')} AND subject_id=${field('subjectId')} AND user_id=${field('userId')})`);
  }
  if (table === 'sso_sync_runs' && (read || write)) clauses.push(`(${kind('provider-login')} AND id=${field('runId')} AND provider_id=${field('providerId')} AND trigger='login')`);
  if (table === 'sso_sync_events' && (read || command === 'INSERT')) clauses.push(`(${kind('provider-login')} AND run_id=${field('runId')} AND provider_id=${field('providerId')})`);
  if (table === 'sso_normalized_identities' && (read || write)) {
    clauses.push(`(${kind('provider-account')} AND provider_id = ${field('providerId')} AND provider_subject = ${field('subjectId')} AND user_id = ${field('userId')})`);
  }
  if (table === 'identity_entitlement_mappings' && read) {
    clauses.push(`(${kind('provider-account')} AND provider_id = ${field('providerId')})`);
  }
  if (table === 'authz_groups') {
    if (read) clauses.push(`(${kind('manual-administrator-grant','manual-administrator-revoke')} AND id='system.group.platform_administrators' AND source='system')`);
    // The joined membership table independently limits these reads to the one
    // verified account; this is not a platform-group directory capability.
    if (read) clauses.push(`(${kind('authenticated-account')} AND source='system' AND id IN (${systemGroups}) AND id IN (SELECT group_id FROM ${membershipTable} WHERE user_id=${field('userId')} AND tenant_id IS NULL))`);
    if (read) clauses.push(`(${kind('account-baseline', 'provider-account')} AND id = ${authenticatedGroup} AND source = 'system')`);
    if (read || write) clauses.push(`(${kind('system-group-seed')} AND (${capability}->'groupIds') ? id AND source = 'system')`);
    if (read) clauses.push(`(${kind('system-membership')} AND id = ${field('groupId')} AND source = 'system')`);
  }
  if (table === 'authz_group_memberships') {
    if (read) clauses.push(`(${kind('administrator-status')} AND group_id='system.group.platform_administrators'
      AND (expires_at IS NULL OR expires_at > floor(extract(epoch FROM clock_timestamp())*1000))
      AND EXISTS (SELECT 1 FROM ${userTable} administrator WHERE administrator.id=user_id AND administrator.is_active))`);
    if (read || command === 'DELETE') clauses.push(`(${kind('authenticated-baseline-revoke')} AND group_id=${authenticatedGroup} AND user_id=${field('userId')} AND source='system' AND source_ref='authenticated-user-baseline')`);
    if (read || command === 'INSERT') clauses.push(`(${kind('manual-administrator-grant')} AND group_id='system.group.platform_administrators' AND user_id=${field('userId')} AND source='manual' AND source_ref='manual-platform-administrator')`);
    if (read || command === 'DELETE') clauses.push(`(${kind('manual-administrator-revoke')} AND group_id='system.group.platform_administrators' AND user_id=${field('userId')} AND source='manual' AND source_ref='manual-platform-administrator')`);
    if (read || command === 'UPDATE') clauses.push(`(${kind('administrator-recovery-claim')} AND group_id='system.group.platform_administrators'
      AND id=${field('membershipId')} AND user_id=${field('userId')} AND source=${field('source')}
      AND source_ref IS NOT DISTINCT FROM ${field('sourceRef')} AND expires_at::text IS NOT DISTINCT FROM ${field('expiresAt')}
      AND created_by_id IS NOT DISTINCT FROM ${field('createdById')} AND created_at::text=${field('createdAt')} AND updated_at::text=${field('updatedAt')}
      AND (expires_at IS NULL OR expires_at > floor(extract(epoch FROM clock_timestamp())*1000)))`);
    if (read) clauses.push(`(${kind('authenticated-account')} AND group_id IN (${systemGroups}) AND user_id=${field('userId')})`);
    if (read || command === 'INSERT') clauses.push(`(${kind('account-baseline', 'provider-account')} AND group_id = ${authenticatedGroup} AND user_id = ${field('userId')} AND source = 'system' AND source_ref = 'authenticated-user-baseline')`);
    if (read || command === 'INSERT') clauses.push(`(${kind('system-membership')} AND group_id = ${field('groupId')} AND user_id = ${field('userId')} AND source = 'system' AND source_ref = ${field('sourceRef')})`);
  }
  if (table === 'audit_logs' && command === 'INSERT') {
    clauses.push(`(${kind('audit-append')} AND id = ${field('rowId')})`);
    clauses.push(`(${kind('config-bootstrap')} AND action LIKE 'authz.config_bundle.%')`);
    clauses.push(`(${kind('account-baseline', 'provider-account', 'system-membership')} AND action = 'authz.group_membership.authenticate')`);
  }
  return clauses.length ? `(tenant_id IS NULL AND (${clauses.join(' OR ')}))` : 'FALSE';
}

/** One canonical source for creation and runtime drift verification. */
function policySource(schema: string, tableName: string, command: Command): string {
  const schemaLiteral = `'${schema.replace(/'/g, "''")}'`;
  const membershipTable = `"${schema.replace(/"/g, '""')}"."authz_group_memberships"`;
  const userTable = `"${schema.replace(/"/g, '""')}"."users"`;
  const migration = `(${kind('migration-execution')} AND ${field('schema')} = ${schemaLiteral} AND ${field('ownerRole')} = current_user AND EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname = ${schemaLiteral} AND n.nspowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)))`;
  const tenant = "(current_setting('enterpriseglue.tenancy_mode', true) = 'pooled' AND tenant_id = NULLIF(current_setting('enterpriseglue.tenant_id', true), ''))";
  const single = "current_setting('enterpriseglue.tenancy_mode', true) = 'single'";
  return `(${single} OR ${tenant} OR ${migration} OR ${globalPredicate(tableName, command, membershipTable, userTable)})`;
}

export interface PostgresTenantPolicyCatalogRow {
  policy_name: string;
  using_expression: string | null;
  check_expression: string | null;
  attestation: string | null;
}

/** PostgreSQL deparses expressions under a fixed path, without object OIDs
 * from pg_node_tree or a hand-written SQL parser. One guarded statement saves
 * and restores search_path. The aggregate always produces a row, including an
 * empty catalogue; PostgreSQL statement rollback restores GUCs on SQL errors. */
export async function readPostgresTenantPolicyCatalog(runner: QueryRunner, schema: string, tableName: string): Promise<PostgresTenantPolicyCatalogRow[]> {
  const rows = await quarantinedPostgresSQL(runner, `WITH prior_path AS MATERIALIZED (
      SELECT pg_catalog.current_setting('search_path') AS path
    ), canonical_path AS MATERIALIZED (
      SELECT pg_catalog.set_config('search_path','pg_catalog',false) AS path FROM prior_path
    ), policies AS MATERIALIZED (
      SELECT COALESCE(pg_catalog.json_agg(body),'[]'::json) AS policies FROM (
        SELECT p.polname AS policy_name,pg_catalog.pg_get_expr(p.polqual,p.polrelid,canonical_path.path<>'pg_catalog') AS using_expression,
          pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid,canonical_path.path<>'pg_catalog') AS check_expression,
          pg_catalog.obj_description(p.oid,'pg_policy') AS attestation
        FROM canonical_path CROSS JOIN pg_catalog.pg_policy p
        JOIN pg_catalog.pg_class c ON c.oid=p.polrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=$1 AND c.relname=$2 AND p.polname=ANY($3::name[])
      ) body
    ), restored_path AS MATERIALIZED (
      SELECT pg_catalog.set_config('search_path',prior_path.path,false) AS path FROM prior_path CROSS JOIN policies
      WHERE pg_catalog.json_typeof(policies.policies)='array'
    ) SELECT policies.policies,restored_path.path AS restored_search_path FROM policies CROSS JOIN restored_path`,
  [schema, tableName, POSTGRES_TENANT_POLICY_COMMANDS.map(command => `eg_tenant_isolation_${command.toLowerCase()}`)]);
  if (!Array.isArray(rows) || rows.length !== 1 || !Array.isArray(rows[0].policies)) throw new Error('PostgreSQL policy catalogue normalization failed');
  return rows[0].policies;
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function policyAttestation(schema: string, tableName: string, command: Command, row: PostgresTenantPolicyCatalogRow) {
  if ((command === 'INSERT' ? row.using_expression !== null : typeof row.using_expression !== 'string') ||
      (command === 'SELECT' || command === 'DELETE' ? row.check_expression !== null : typeof row.check_expression !== 'string')) {
    throw new Error('PostgreSQL tenant policy catalog expression is missing');
  }
  return { schemaVersion: 'postgres-tenant-policy-attestation/v1', schema, table: tableName, command,
    sourceSha256: hash(policySource(schema, tableName, command)),
    usingSha256: row.using_expression === null ? null : hash(row.using_expression),
    checkSha256: row.check_expression === null ? null : hash(row.check_expression) };
}

/** Owner-controlled drift evidence, not a signature or protection from a
 * malicious schema owner capable of changing both policy and its comment. */
export function postgresTenantPolicyAttestationMatches(schema: string, tableName: string, command: Command, row: PostgresTenantPolicyCatalogRow): boolean {
  try {
    if (typeof row.attestation !== 'string' || row.attestation.length > 2048) return false;
    const recorded = JSON.parse(row.attestation);
    const expected = policyAttestation(schema, tableName, command, row);
    return recorded !== null && !Array.isArray(recorded) &&
      Object.keys(recorded).sort().join() === Object.keys(expected).sort().join() &&
      Object.entries(expected).every(([key, value]) => recorded[key] === value);
  } catch { return false; }
}

/** Shared by the additive policy migration and the critical migration repair. */
export async function applyPostgresTenantPolicies(queryRunner: QueryRunner): Promise<void> {
  if (queryRunner.connection.options.type !== 'postgres') return;
  for (const metadata of queryRunner.connection.entityMetadatas) {
    if (!POSTGRES_TENANT_RLS_TABLES.has(metadata.tableName) || !metadata.columns.some((column) => column.databaseName === 'tenant_id')) continue;
    if (!await queryRunner.hasTable(metadata.tablePath)) continue;
    const table = metadata.tablePath.split('.').map((part) => queryRunner.connection.driver.escape(part)).join('.');
    const schema = metadata.schema || String((queryRunner.connection.options as { schema?: string }).schema || 'public');
    await quarantinedPostgresSQL(queryRunner, `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await quarantinedPostgresSQL(queryRunner, `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    await quarantinedPostgresSQL(queryRunner, `DROP POLICY IF EXISTS eg_tenant_isolation ON ${table}`);
    for (const command of POSTGRES_TENANT_POLICY_COMMANDS) {
      const policy = `eg_tenant_isolation_${command.toLowerCase()}`;
      await quarantinedPostgresSQL(queryRunner, `DROP POLICY IF EXISTS ${policy} ON ${table}`);
      const predicate = policySource(schema, metadata.tableName, command);
      const using = command === 'INSERT' ? '' : ` USING (${predicate})`;
      const check = command === 'SELECT' || command === 'DELETE' ? '' : ` WITH CHECK (${predicate})`;
      await quarantinedPostgresSQL(queryRunner, `CREATE POLICY ${policy} ON ${table} FOR ${command}${using}${check}`);
    }
    const catalog = await readPostgresTenantPolicyCatalog(queryRunner, schema, metadata.tableName);
    if (!Array.isArray(catalog) || catalog.length !== 4) throw new Error('PostgreSQL tenant policy catalog is incomplete');
    for (const command of POSTGRES_TENANT_POLICY_COMMANDS) {
      const policy = `eg_tenant_isolation_${command.toLowerCase()}`;
      const row = catalog.find(item => item.policy_name === policy);
      if (!row) throw new Error('PostgreSQL tenant policy catalog is incomplete');
      const comment = JSON.stringify(policyAttestation(schema, metadata.tableName, command, row)).replace(/'/g, "''");
      await quarantinedPostgresSQL(queryRunner, `COMMENT ON POLICY ${policy} ON ${table} IS '${comment}'`);
    }
  }
}
