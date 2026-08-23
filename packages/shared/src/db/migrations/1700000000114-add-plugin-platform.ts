import { TableIndex } from 'typeorm';
import type {
  MigrationInterface,
  QueryRunner,
  TableColumnOptions,
} from 'typeorm';

import { pluginMigrationTable } from './plugin-migration-schema.js';

type TableDefinition = {
  entity: string;
  columns: TableColumnOptions[];
  indices: TableIndex[];
};

const tables: TableDefinition[] = [
  {
    entity: 'PluginPlatformState',
    columns: [
      { name: 'id', type: 'text', isPrimary: true },
      { name: 'installer_revision', type: 'bigint', default: 0 },
      { name: 'snapshot_hash', type: 'text' },
      { name: 'updated_at', type: 'bigint' },
    ],
    indices: [],
  },
  {
    entity: 'PluginInstallation',
    columns: [
      { name: 'id', type: 'text', isPrimary: true },
      { name: 'plugin_id', type: 'text' },
      { name: 'version', type: 'text' },
      { name: 'publisher', type: 'text' },
      { name: 'display_name', type: 'text' },
      { name: 'manifest_sha256', type: 'text' },
      { name: 'source_record_hash', type: 'text' },
      { name: 'bundle_digest', type: 'text' },
      { name: 'state', type: 'text' },
      { name: 'reason_code', type: 'text' },
      { name: 'desired_enabled', type: 'boolean', default: false },
      { name: 'installer_enabled', type: 'boolean', default: false },
      { name: 'enablement_scope', type: 'text', default: "'deployment'" },
      { name: 'grant_set_hash', type: 'text' },
      { name: 'compatible', type: 'boolean', default: false },
      { name: 'healthy', type: 'boolean', default: false },
      { name: 'entitlement_state', type: 'text', default: "'not_required'" },
      { name: 'revision', type: 'bigint', default: 0 },
      { name: 'installer_revision', type: 'bigint', default: 0 },
      { name: 'created_at', type: 'bigint' },
      { name: 'updated_at', type: 'bigint' },
    ],
    indices: [
      new TableIndex({
        name: 'idx_plugin_install_plugin',
        columnNames: ['plugin_id'],
        isUnique: true,
      }),
      new TableIndex({
        name: 'idx_plugin_install_state',
        columnNames: ['state'],
      }),
    ],
  },
  {
    entity: 'PluginPermissionGrant',
    columns: [
      { name: 'id', type: 'text', isPrimary: true },
      { name: 'plugin_id', type: 'text' },
      { name: 'permission', type: 'text' },
      { name: 'granted', type: 'boolean', default: false },
      { name: 'granted_by_ref', type: 'text', isNullable: true },
      { name: 'created_at', type: 'bigint' },
      { name: 'updated_at', type: 'bigint' },
    ],
    indices: [
      new TableIndex({
        name: 'idx_plugin_grant_identity',
        columnNames: ['plugin_id', 'permission'],
        isUnique: true,
      }),
      new TableIndex({
        name: 'idx_plugin_grant_plugin',
        columnNames: ['plugin_id'],
      }),
    ],
  },
  {
    entity: 'PluginTenantEnablement',
    columns: [
      { name: 'id', type: 'text', isPrimary: true },
      { name: 'plugin_id', type: 'text' },
      { name: 'tenant_ref', type: 'text' },
      { name: 'enabled', type: 'boolean', default: false },
      { name: 'reason_code', type: 'text', default: "'none'" },
      { name: 'revision', type: 'bigint', default: 0 },
      { name: 'created_at', type: 'bigint' },
      { name: 'updated_at', type: 'bigint' },
    ],
    indices: [
      new TableIndex({
        name: 'idx_plugin_tenant_identity',
        columnNames: ['plugin_id', 'tenant_ref'],
        isUnique: true,
      }),
      new TableIndex({
        name: 'idx_plugin_tenant_plugin',
        columnNames: ['plugin_id'],
      }),
    ],
  },
  {
    entity: 'PluginLifecycleOperation',
    columns: [
      { name: 'id', type: 'text', isPrimary: true },
      { name: 'plugin_id', type: 'text' },
      { name: 'type', type: 'text' },
      { name: 'status', type: 'text' },
      { name: 'idempotency_key_hash', type: 'text' },
      { name: 'request_hash', type: 'text' },
      { name: 'target_version', type: 'text', isNullable: true },
      { name: 'reason_code', type: 'text', default: "'none'" },
      { name: 'revision', type: 'bigint', default: 0 },
      { name: 'lease_owner', type: 'text', isNullable: true },
      { name: 'lease_expires_at', type: 'bigint', isNullable: true },
      { name: 'created_at', type: 'bigint' },
      { name: 'updated_at', type: 'bigint' },
    ],
    indices: [
      new TableIndex({
        name: 'idx_plugin_op_idempotency',
        columnNames: ['idempotency_key_hash'],
        isUnique: true,
      }),
      new TableIndex({
        name: 'idx_plugin_op_plugin',
        columnNames: ['plugin_id'],
      }),
      new TableIndex({
        name: 'idx_plugin_op_status',
        columnNames: ['status'],
      }),
      new TableIndex({
        name: 'idx_plugin_op_lease',
        columnNames: ['lease_expires_at'],
      }),
    ],
  },
  {
    entity: 'PluginPlatformAudit',
    columns: [
      { name: 'id', type: 'text', isPrimary: true },
      { name: 'event_type', type: 'text' },
      { name: 'plugin_id', type: 'text', isNullable: true },
      { name: 'tenant_ref', type: 'text', isNullable: true },
      { name: 'actor_ref', type: 'text' },
      { name: 'correlation_id', type: 'text' },
      { name: 'from_state', type: 'text', isNullable: true },
      { name: 'to_state', type: 'text', isNullable: true },
      { name: 'reason_code', type: 'text' },
      { name: 'occurred_at', type: 'bigint' },
    ],
    indices: [
      new TableIndex({
        name: 'idx_plugin_audit_plugin',
        columnNames: ['plugin_id'],
      }),
      new TableIndex({
        name: 'idx_plugin_audit_time',
        columnNames: ['occurred_at'],
      }),
      new TableIndex({
        name: 'idx_plugin_audit_corr',
        columnNames: ['correlation_id'],
      }),
    ],
  },
];

export class AddPluginPlatform1700000000114 implements MigrationInterface {
  name = 'AddPluginPlatform1700000000114';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const definition of tables) {
      const tablePath =
        queryRunner.connection.getMetadata(definition.entity).tablePath;
      if (await queryRunner.hasTable(tablePath)) continue;

      await queryRunner.createTable(
        pluginMigrationTable(queryRunner, {
          name: tablePath,
          columns: definition.columns,
          indices: definition.indices,
        }),
        true,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const definition of [...tables].reverse()) {
      const tablePath =
        queryRunner.connection.getMetadata(definition.entity).tablePath;
      if (await queryRunner.hasTable(tablePath)) {
        await queryRunner.dropTable(tablePath);
      }
    }
  }
}
