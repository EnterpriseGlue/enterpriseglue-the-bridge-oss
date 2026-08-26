import type { QueryRunner } from 'typeorm';

export const POSTGRES_TENANT_RLS_TABLES = new Set([
  // Refresh tokens and invitations deliberately remain outside this content
  // policy: their opaque pre-authentication lookup is what establishes the
  // tenant. Both records carry an explicit tenant binding that their auth
  // services verify before issuing a session.
  'audit_logs', 'authz_audit_log', 'authz_groups', 'authz_group_memberships', 'authz_policies',
  'config_bundle_apply_runs', 'config_bundle_identity_replay_tasks', 'config_bundle_runtime_reconciliation_tasks',
  'deployment_receipts', 'external_engine_systems', 'external_identities', 'git_providers',
  'identity_entitlement_mappings', 'identity_providers', 'identity_provisioning_diagnostics',
  'identity_provisioning_directories', 'identity_reconciliation_checkpoints', 'notifications',
  'projects', 'project_engine_targets', 'runtime_resources', 'runtime_resource_sets',
  'runtime_resource_set_materializations', 'saml_assertion_replays', 'scim_group_links',
  'scim_group_memberships', 'scim_user_links', 'sso_normalized_identities', 'sso_sync_events', 'sso_sync_runs',
  'tenant_login_policies',
]);

export async function verifyPostgresTenantRls(queryRunner: QueryRunner): Promise<{ expected: number; enforced: number }> {
  if (queryRunner.connection.options.type !== 'postgres') return { expected: 0, enforced: 0 };
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
