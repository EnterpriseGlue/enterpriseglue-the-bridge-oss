import { TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner, TableColumnOptions } from 'typeorm';

import { pluginMigrationTable } from './plugin-migration-schema.js';

interface ManagerTableSpec {
  entity: string;
  columns: TableColumnOptions[];
  indices: TableIndex[];
}

const tables: ManagerTableSpec[] = [
  {
    entity: 'PluginInstallationIntent',
    columns: [
      { name: 'id', type: 'text', isPrimary: true },
      { name: 'installation_id', type: 'text' },
      { name: 'plugin_id', type: 'text' },
      { name: 'release_digest', type: 'text' },
      { name: 'source', type: 'text' },
      { name: 'deployment_mode', type: 'text' },
      { name: 'requester_ref', type: 'text' },
      { name: 'expected_platform_revision', type: 'bigint' },
      { name: 'idempotency_key_hash', type: 'text' },
      { name: 'intent_json', type: 'text' },
      { name: 'state', type: 'text' },
      { name: 'reason_code', type: 'text' },
      { name: 'revision', type: 'bigint', default: 0 },
      { name: 'lease_owner', type: 'text', isNullable: true },
      { name: 'lease_token_hash', type: 'text', isNullable: true },
      { name: 'lease_expires_at', type: 'bigint', isNullable: true },
      { name: 'created_at', type: 'bigint' },
      { name: 'updated_at', type: 'bigint' },
    ],
    indices: [
      new TableIndex({
        name: 'idx_plugin_manager_intent_identity',
        columnNames: ['installation_id'],
        isUnique: true,
      }),
      new TableIndex({
        name: 'idx_plugin_manager_intent_idempotency',
        columnNames: ['idempotency_key_hash'],
        isUnique: true,
      }),
      new TableIndex({
        name: 'idx_plugin_manager_intent_claim',
        columnNames: ['state', 'lease_expires_at', 'created_at'],
      }),
    ],
  },
  {
    entity: 'PluginInstallationReview',
    columns: [
      { name: 'id', type: 'text', isPrimary: true },
      { name: 'installation_id', type: 'text' },
      { name: 'plugin_id', type: 'text' },
      { name: 'version', type: 'text' },
      { name: 'release_digest', type: 'text' },
      { name: 'plan_sha256', type: 'text' },
      { name: 'review_sha256', type: 'text' },
      { name: 'review_json', type: 'text' },
      { name: 'approvable', type: 'boolean' },
      { name: 'expires_at', type: 'bigint' },
      { name: 'created_at', type: 'bigint' },
      { name: 'updated_at', type: 'bigint' },
    ],
    indices: [
      new TableIndex({
        name: 'idx_plugin_manager_review_identity',
        columnNames: ['installation_id'],
        isUnique: true,
      }),
      new TableIndex({
        name: 'idx_plugin_manager_review_digest',
        columnNames: ['review_sha256'],
        isUnique: true,
      }),
    ],
  },
  {
    entity: 'PluginInstallationApproval',
    columns: [
      { name: 'id', type: 'text', isPrimary: true },
      { name: 'installation_id', type: 'text' },
      { name: 'decision', type: 'text' },
      { name: 'review_sha256', type: 'text' },
      { name: 'plan_sha256', type: 'text' },
      { name: 'approver_ref', type: 'text' },
      { name: 'expected_revision', type: 'bigint' },
      { name: 'decided_at', type: 'bigint' },
      { name: 'expires_at', type: 'bigint' },
    ],
    indices: [
      new TableIndex({
        name: 'idx_plugin_manager_approval_identity',
        columnNames: ['installation_id'],
        isUnique: true,
      }),
      new TableIndex({
        name: 'idx_plugin_manager_approval_digest',
        columnNames: ['review_sha256', 'plan_sha256'],
      }),
    ],
  },
  {
    entity: 'PluginInstallationObservation',
    columns: [
      { name: 'id', type: 'text', isPrimary: true },
      { name: 'installation_id', type: 'text' },
      { name: 'plugin_id', type: 'text' },
      { name: 'revision', type: 'bigint' },
      { name: 'state', type: 'text' },
      { name: 'reason_code', type: 'text' },
      { name: 'plan_sha256', type: 'text', isNullable: true },
      { name: 'observation_json', type: 'text' },
      { name: 'occurred_at', type: 'bigint' },
    ],
    indices: [
      new TableIndex({
        name: 'idx_plugin_manager_observation_installation',
        columnNames: ['installation_id', 'revision'],
      }),
      new TableIndex({
        name: 'idx_plugin_manager_observation_time',
        columnNames: ['occurred_at'],
      }),
    ],
  },
  {
    entity: 'PluginManagerCapability',
    columns: [
      { name: 'id', type: 'text', isPrimary: true },
      { name: 'manager_id', type: 'text' },
      { name: 'manager_version', type: 'text' },
      { name: 'state', type: 'text' },
      { name: 'capability_json', type: 'text' },
      { name: 'last_seen_at', type: 'bigint' },
    ],
    indices: [
      new TableIndex({
        name: 'idx_plugin_manager_capability_identity',
        columnNames: ['manager_id'],
        isUnique: true,
      }),
      new TableIndex({
        name: 'idx_plugin_manager_capability_seen',
        columnNames: ['last_seen_at'],
      }),
    ],
  },
  {
    entity: 'PluginManagerAdmission',
    columns: [
      { name: 'id', type: 'text', isPrimary: true },
      { name: 'scope', type: 'text' },
      { name: 'installation_id', type: 'text', isNullable: true },
      { name: 'manager_id', type: 'text', isNullable: true },
      { name: 'lease_token_hash', type: 'text', isNullable: true },
      { name: 'lease_expires_at', type: 'bigint', isNullable: true },
      { name: 'revision', type: 'bigint', default: 0 },
      { name: 'updated_at', type: 'bigint' },
    ],
    indices: [
      new TableIndex({
        name: 'idx_plugin_manager_admission_scope',
        columnNames: ['scope'],
        isUnique: true,
      }),
    ],
  },
];

export class AddPluginManager1700000000123 implements MigrationInterface {
  name = 'AddPluginManager1700000000123';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const spec of tables) {
      const tablePath = queryRunner.connection.getMetadata(spec.entity).tablePath;
      if (await queryRunner.hasTable(tablePath)) continue;
      await queryRunner.createTable(
        pluginMigrationTable(queryRunner, {
          name: tablePath,
          columns: spec.columns,
          indices: spec.indices,
        }),
        true,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const spec of [...tables].reverse()) {
      const tablePath = queryRunner.connection.getMetadata(spec.entity).tablePath;
      if (await queryRunner.hasTable(tablePath)) {
        await queryRunner.dropTable(tablePath);
      }
    }
  }
}
