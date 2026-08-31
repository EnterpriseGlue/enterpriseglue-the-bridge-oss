import { Table, TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { portableBigint, portableText } from './support/portable-columns.js';

const pathFor = (queryRunner: QueryRunner, entityName: string, fallback: string): string => {
  try { return queryRunner.connection.getMetadata(entityName).tablePath; }
  catch { return fallback; }
};

export class AddReleaseAwarePluginWork1700000000130 implements MigrationInterface {
  name = 'AddReleaseAwarePluginWork1700000000130';

  async up(queryRunner: QueryRunner): Promise<void> {
    const key = portableText(queryRunner, 'key');
    const timestamp = portableBigint(queryRunner);
    for (const tableName of [
      pathFor(queryRunner, 'PluginEventDelivery', 'plugin_event_deliveries'),
      pathFor(queryRunner, 'PluginScheduledJob', 'plugin_scheduled_jobs'),
    ]) {
      if (!await queryRunner.hasColumn(tableName, 'release_id')) {
        await queryRunner.addColumn(tableName, new TableColumn({ name: 'release_id', ...key, isNullable: true }));
      }
      if (!await queryRunner.hasColumn(tableName, 'assignment_epoch')) {
        await queryRunner.addColumn(tableName, new TableColumn({ name: 'assignment_epoch', ...timestamp, isNullable: true }));
      }
    }

    const assignments = pathFor(queryRunner, 'TenantReleaseWorkAssignment', 'tenant_release_work_assignments');
    if (!await queryRunner.hasTable(assignments)) {
      await queryRunner.createTable(new Table({
        name: assignments,
        columns: [
          { name: 'id', ...key, isPrimary: true },
          { name: 'tenant_ref', ...key, isUnique: true },
          { name: 'release_id', ...key },
          { name: 'assignment_epoch', ...timestamp },
          { name: 'updated_at', ...timestamp },
        ],
        indices: [new TableIndex({ name: 'idx_tenant_release_work_assignment_release', columnNames: ['release_id'] })],
      }), true);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const assignments = pathFor(queryRunner, 'TenantReleaseWorkAssignment', 'tenant_release_work_assignments');
    if (await queryRunner.hasTable(assignments)) await queryRunner.dropTable(assignments);
    for (const tableName of [
      pathFor(queryRunner, 'PluginEventDelivery', 'plugin_event_deliveries'),
      pathFor(queryRunner, 'PluginScheduledJob', 'plugin_scheduled_jobs'),
    ]) {
      for (const columnName of ['assignment_epoch', 'release_id']) {
        if (await queryRunner.hasColumn(tableName, columnName)) await queryRunner.dropColumn(tableName, columnName);
      }
    }
  }
}
