import type { MigrationInterface, QueryRunner } from 'typeorm';

const TENANT_OWNED_TABLES = new Set([
  'audit_logs', 'authz_audit_log', 'authz_groups', 'authz_group_memberships', 'authz_policies',
  'config_bundle_apply_runs', 'config_bundle_identity_replay_tasks', 'config_bundle_runtime_reconciliation_tasks',
  'deployment_receipts', 'external_engine_systems', 'external_identities', 'git_providers',
  'identity_entitlement_mappings', 'identity_providers', 'identity_provisioning_diagnostics',
  'identity_provisioning_directories', 'identity_reconciliation_checkpoints', 'invitations', 'notifications',
  'projects', 'project_engine_targets', 'runtime_resources', 'runtime_resource_sets',
  'runtime_resource_set_materializations', 'saml_assertion_replays', 'scim_group_links',
  'scim_group_memberships', 'scim_user_links', 'sso_normalized_identities', 'sso_sync_events', 'sso_sync_runs',
]);

function tableRef(queryRunner: QueryRunner, tablePath: string): string {
  return tablePath.split('.').map((part) => queryRunner.connection.driver.escape(part)).join('.');
}

export class BackfillNativeTenantOwnership1700000000125 implements MigrationInterface {
  name = 'BackfillNativeTenantOwnership1700000000125';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const metadata of queryRunner.connection.entityMetadatas) {
      if (!TENANT_OWNED_TABLES.has(metadata.tableName)) continue;
      const tenantColumn = metadata.columns.find((column) => column.databaseName === 'tenant_id');
      if (!tenantColumn || !await queryRunner.hasTable(metadata.tablePath)) continue;
      await queryRunner.query(
        `UPDATE ${tableRef(queryRunner, metadata.tablePath)} SET ${queryRunner.connection.driver.escape('tenant_id')} = 'tenant-default' ` +
        `WHERE ${queryRunner.connection.driver.escape('tenant_id')} IS NULL`,
      );
    }
  }

  async down(): Promise<void> {
    // Ownership backfills are intentionally irreversible.
  }
}
