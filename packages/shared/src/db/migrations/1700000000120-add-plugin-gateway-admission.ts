import { TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

import { pluginMigrationTable } from './plugin-migration-schema.js';

export class AddPluginGatewayAdmission1700000000120
implements MigrationInterface {
  name = 'AddPluginGatewayAdmission1700000000120';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const statePath = queryRunner.connection.getMetadata(
      'PluginGatewayAdmissionState',
    ).tablePath;
    if (!(await queryRunner.hasTable(statePath))) {
      await queryRunner.createTable(
        pluginMigrationTable(queryRunner, {
          name: statePath,
          columns: [
            { name: 'id', type: 'text', isPrimary: true },
            { name: 'plugin_id', type: 'text' },
            { name: 'window_started_at', type: 'bigint' },
            { name: 'request_count', type: 'integer', default: 0 },
            { name: 'updated_at', type: 'bigint' },
          ],
          indices: [
            new TableIndex({
              name: 'idx_plugin_gateway_admission_plugin',
              columnNames: ['plugin_id'],
              isUnique: true,
            }),
          ],
        }),
        true,
      );
    }

    const subjectPath = queryRunner.connection.getMetadata(
      'PluginGatewaySubjectBucket',
    ).tablePath;
    if (!(await queryRunner.hasTable(subjectPath))) {
      await queryRunner.createTable(
        pluginMigrationTable(queryRunner, {
          name: subjectPath,
          columns: [
            { name: 'id', type: 'text', isPrimary: true },
            { name: 'bucket_hash', type: 'text' },
            { name: 'plugin_id', type: 'text' },
            { name: 'operation_id', type: 'text' },
            { name: 'window_started_at', type: 'bigint' },
            { name: 'request_count', type: 'integer', default: 0 },
            { name: 'updated_at', type: 'bigint' },
          ],
          indices: [
            new TableIndex({
              name: 'idx_plugin_gateway_subject_bucket_hash',
              columnNames: ['bucket_hash'],
              isUnique: true,
            }),
            new TableIndex({
              name: 'idx_plugin_gateway_subject_bucket_plugin',
              columnNames: ['plugin_id', 'updated_at'],
            }),
          ],
        }),
        true,
      );
    }

    const leasePath = queryRunner.connection.getMetadata(
      'PluginGatewayConcurrencyLease',
    ).tablePath;
    if (!(await queryRunner.hasTable(leasePath))) {
      await queryRunner.createTable(
        pluginMigrationTable(queryRunner, {
          name: leasePath,
          columns: [
            { name: 'id', type: 'text', isPrimary: true },
            { name: 'lease_id', type: 'text' },
            { name: 'plugin_id', type: 'text' },
            { name: 'operation_id', type: 'text' },
            { name: 'expires_at', type: 'bigint' },
            { name: 'created_at', type: 'bigint' },
          ],
          indices: [
            new TableIndex({
              name: 'idx_plugin_gateway_concurrency_lease',
              columnNames: ['lease_id'],
              isUnique: true,
            }),
            new TableIndex({
              name: 'idx_plugin_gateway_concurrency_scope',
              columnNames: ['plugin_id', 'operation_id'],
            }),
            new TableIndex({
              name: 'idx_plugin_gateway_concurrency_expiry',
              columnNames: ['expires_at'],
            }),
          ],
        }),
        true,
      );
    }

    const eventQueuePath = queryRunner.connection.getMetadata(
      'PluginEventQueueState',
    ).tablePath;
    if (!(await queryRunner.hasTable(eventQueuePath))) {
      await queryRunner.createTable(
        pluginMigrationTable(queryRunner, {
          name: eventQueuePath,
          columns: [
            { name: 'id', type: 'text', isPrimary: true },
            { name: 'plugin_id', type: 'text' },
            { name: 'updated_at', type: 'bigint' },
          ],
          indices: [
            new TableIndex({
              name: 'idx_plugin_event_queue_state_plugin',
              columnNames: ['plugin_id'],
              isUnique: true,
            }),
          ],
        }),
        true,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const entity of [
      'PluginEventQueueState',
      'PluginGatewayConcurrencyLease',
      'PluginGatewaySubjectBucket',
      'PluginGatewayAdmissionState',
    ]) {
      const tablePath = queryRunner.connection.getMetadata(entity).tablePath;
      if (await queryRunner.hasTable(tablePath)) {
        await queryRunner.dropTable(tablePath);
      }
    }
  }
}
