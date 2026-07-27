import { TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

import { pluginMigrationTable } from './plugin-migration-schema.js';

export class AddPluginNotificationsAndSchedules1700000000020
implements MigrationInterface {
  name = 'AddPluginNotificationsAndSchedules1700000000020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const notificationPath = queryRunner.connection.getMetadata(
      'PluginNotificationPublication',
    ).tablePath;
    if (!(await queryRunner.hasTable(notificationPath))) {
      await queryRunner.createTable(
        pluginMigrationTable(queryRunner, {
          name: notificationPath,
          columns: [
            { name: 'id', type: 'text', isPrimary: true },
            { name: 'idempotency_key_hash', type: 'text' },
            { name: 'request_hash', type: 'text' },
            { name: 'notification_ref', type: 'text' },
            { name: 'plugin_id', type: 'text' },
            { name: 'deployment_ref', type: 'text' },
            { name: 'tenant_ref', type: 'text' },
            { name: 'subject_ref', type: 'text' },
            { name: 'template_id', type: 'text' },
            { name: 'reason_code', type: 'text' },
            { name: 'created_at', type: 'bigint' },
          ],
          indices: [
            new TableIndex({
              name: 'idx_plugin_notification_idempotency',
              columnNames: ['idempotency_key_hash'],
              isUnique: true,
            }),
            new TableIndex({
              name: 'idx_plugin_notification_subject',
              columnNames: ['plugin_id', 'tenant_ref', 'subject_ref'],
            }),
          ],
        }),
        true,
      );
    }

    const jobPath =
      queryRunner.connection.getMetadata('PluginScheduledJob').tablePath;
    if (!(await queryRunner.hasTable(jobPath))) {
      await queryRunner.createTable(
        pluginMigrationTable(queryRunner, {
          name: jobPath,
          columns: [
            { name: 'id', type: 'text', isPrimary: true },
            { name: 'job_ref', type: 'text' },
            { name: 'plugin_id', type: 'text' },
            { name: 'deployment_ref', type: 'text' },
            { name: 'tenant_ref', type: 'text' },
            { name: 'job_type', type: 'text' },
            { name: 'operation_id', type: 'text' },
            { name: 'interval_seconds', type: 'integer' },
            { name: 'max_attempts', type: 'integer' },
            { name: 'status', type: 'text' },
            { name: 'revision', type: 'bigint', default: 1 },
            { name: 'attempt', type: 'integer', default: 0 },
            { name: 'next_run_at', type: 'bigint' },
            { name: 'lease_owner', type: 'text', isNullable: true },
            { name: 'lease_expires_at', type: 'bigint', isNullable: true },
            { name: 'reason_code', type: 'text' },
            { name: 'scheduled_by_ref', type: 'text' },
            { name: 'created_at', type: 'bigint' },
            { name: 'updated_at', type: 'bigint' },
          ],
          indices: [
            new TableIndex({
              name: 'idx_plugin_scheduled_job_identity',
              columnNames: ['job_ref'],
              isUnique: true,
            }),
            new TableIndex({
              name: 'idx_plugin_scheduled_job_due',
              columnNames: ['status', 'next_run_at'],
            }),
            new TableIndex({
              name: 'idx_plugin_scheduled_job_scope',
              columnNames: ['plugin_id', 'deployment_ref', 'tenant_ref'],
            }),
            new TableIndex({
              name: 'idx_plugin_scheduled_job_lease',
              columnNames: ['lease_expires_at'],
            }),
          ],
        }),
        true,
      );
    }

    const commandPath =
      queryRunner.connection.getMetadata('PluginScheduleCommand').tablePath;
    if (!(await queryRunner.hasTable(commandPath))) {
      await queryRunner.createTable(
        pluginMigrationTable(queryRunner, {
          name: commandPath,
          columns: [
            { name: 'id', type: 'text', isPrimary: true },
            { name: 'idempotency_key_hash', type: 'text' },
            { name: 'request_hash', type: 'text' },
            { name: 'response_json', type: 'text' },
            { name: 'plugin_id', type: 'text' },
            { name: 'deployment_ref', type: 'text' },
            { name: 'tenant_ref', type: 'text' },
            { name: 'created_at', type: 'bigint' },
          ],
          indices: [
            new TableIndex({
              name: 'idx_plugin_schedule_command_idempotency',
              columnNames: ['idempotency_key_hash'],
              isUnique: true,
            }),
            new TableIndex({
              name: 'idx_plugin_schedule_command_scope',
              columnNames: ['plugin_id', 'deployment_ref', 'tenant_ref'],
            }),
          ],
        }),
        true,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const entity of [
      'PluginScheduleCommand',
      'PluginScheduledJob',
      'PluginNotificationPublication',
    ]) {
      const path = queryRunner.connection.getMetadata(entity).tablePath;
      if (await queryRunner.hasTable(path)) {
        await queryRunner.dropTable(path);
      }
    }
  }
}
