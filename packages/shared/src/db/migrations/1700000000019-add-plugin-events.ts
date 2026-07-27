import { TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

import { pluginMigrationTable } from './plugin-migration-schema.js';

export class AddPluginEvents1700000000019 implements MigrationInterface {
  name = 'AddPluginEvents1700000000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const deliveryPath =
      queryRunner.connection.getMetadata('PluginEventDelivery').tablePath;
    if (!(await queryRunner.hasTable(deliveryPath))) {
      await queryRunner.createTable(
        pluginMigrationTable(queryRunner, {
          name: deliveryPath,
          columns: [
            { name: 'id', type: 'text', isPrimary: true },
            { name: 'delivery_id', type: 'text' },
            { name: 'plugin_id', type: 'text' },
            { name: 'deployment_ref', type: 'text' },
            { name: 'tenant_ref', type: 'text' },
            { name: 'subscription_type', type: 'text' },
            { name: 'operation_id', type: 'text' },
            { name: 'event_id', type: 'text' },
            { name: 'event_sha256', type: 'text' },
            { name: 'event_json', type: 'text' },
            { name: 'status', type: 'text' },
            { name: 'attempt', type: 'integer', default: 0 },
            { name: 'max_attempts', type: 'integer' },
            { name: 'next_attempt_at', type: 'bigint' },
            { name: 'lease_owner', type: 'text', isNullable: true },
            { name: 'lease_expires_at', type: 'bigint', isNullable: true },
            { name: 'reason_code', type: 'text' },
            { name: 'delivered_at', type: 'bigint', isNullable: true },
            { name: 'created_at', type: 'bigint' },
            { name: 'updated_at', type: 'bigint' },
          ],
          indices: [
            new TableIndex({
              name: 'idx_plugin_event_delivery_identity',
              columnNames: ['delivery_id'],
              isUnique: true,
            }),
            new TableIndex({
              name: 'idx_plugin_event_delivery_due',
              columnNames: ['status', 'next_attempt_at'],
            }),
            new TableIndex({
              name: 'idx_plugin_event_delivery_plugin',
              columnNames: ['plugin_id', 'tenant_ref'],
            }),
            new TableIndex({
              name: 'idx_plugin_event_delivery_lease',
              columnNames: ['lease_expires_at'],
            }),
          ],
        }),
        true,
      );
    }

    const subscriptionPath =
      queryRunner.connection.getMetadata(
        'PluginEventSubscriptionState',
      ).tablePath;
    if (!(await queryRunner.hasTable(subscriptionPath))) {
      await queryRunner.createTable(
        pluginMigrationTable(queryRunner, {
          name: subscriptionPath,
          columns: [
            { name: 'id', type: 'text', isPrimary: true },
            { name: 'plugin_id', type: 'text' },
            { name: 'deployment_ref', type: 'text' },
            { name: 'tenant_ref', type: 'text' },
            { name: 'subscription_type', type: 'text' },
            { name: 'paused', type: 'boolean', default: false },
            { name: 'revision', type: 'bigint', default: 0 },
            { name: 'reason_code', type: 'text' },
            { name: 'updated_at', type: 'bigint' },
          ],
          indices: [
            new TableIndex({
              name: 'idx_plugin_event_subscription_identity',
              columnNames: [
                'plugin_id',
                'deployment_ref',
                'tenant_ref',
                'subscription_type',
              ],
              isUnique: true,
            }),
            new TableIndex({
              name: 'idx_plugin_event_subscription_plugin',
              columnNames: ['plugin_id', 'tenant_ref'],
            }),
          ],
        }),
        true,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const entity of [
      'PluginEventSubscriptionState',
      'PluginEventDelivery',
    ]) {
      const path = queryRunner.connection.getMetadata(entity).tablePath;
      if (await queryRunner.hasTable(path)) {
        await queryRunner.dropTable(path);
      }
    }
  }
}
