import { TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

import { pluginMigrationTable } from './plugin-migration-schema.js';

export class AddPluginContributionAvailability1700000000024
implements MigrationInterface {
  name = 'AddPluginContributionAvailability1700000000024';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tablePath = queryRunner.connection.getMetadata(
      'PluginContributionAvailabilityState',
    ).tablePath;
    if (await queryRunner.hasTable(tablePath)) return;
    await queryRunner.createTable(
      pluginMigrationTable(queryRunner, {
        name: tablePath,
        columns: [
          { name: 'id', type: 'text', isPrimary: true },
          { name: 'deployment_ref', type: 'text' },
          { name: 'tenant_ref', type: 'text' },
          { name: 'plugin_id', type: 'text' },
          { name: 'plugin_version', type: 'text' },
          { name: 'installer_revision', type: 'bigint' },
          { name: 'refresh_interval_seconds', type: 'integer' },
          { name: 'maximum_staleness_seconds', type: 'integer' },
          { name: 'projection_json', type: 'text', isNullable: true },
          { name: 'evaluated_at', type: 'bigint', isNullable: true },
          { name: 'valid_until', type: 'bigint', isNullable: true },
          { name: 'next_refresh_at', type: 'bigint' },
          { name: 'lease_owner', type: 'text', isNullable: true },
          { name: 'lease_expires_at', type: 'bigint', isNullable: true },
          { name: 'reason_code', type: 'text' },
          { name: 'consecutive_failures', type: 'integer', default: 0 },
          { name: 'revision', type: 'bigint', default: 0 },
          { name: 'created_at', type: 'bigint' },
          { name: 'updated_at', type: 'bigint' },
        ],
        indices: [
          new TableIndex({
            name: 'idx_plugin_contribution_availability_identity',
            columnNames: ['deployment_ref', 'tenant_ref', 'plugin_id'],
            isUnique: true,
          }),
          new TableIndex({
            name: 'idx_plugin_contribution_availability_due',
            columnNames: ['next_refresh_at', 'lease_expires_at'],
          }),
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tablePath = queryRunner.connection.getMetadata(
      'PluginContributionAvailabilityState',
    ).tablePath;
    if (await queryRunner.hasTable(tablePath)) {
      await queryRunner.dropTable(tablePath);
    }
  }
}
