import { Table, TableIndex, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConfigBundleRuntimeReconciliationTasks1700000000086 implements MigrationInterface {
  name = 'AddConfigBundleRuntimeReconciliationTasks1700000000086';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('config_bundle_runtime_reconciliation_tasks')) return;
    await queryRunner.createTable(new Table({
      name: 'config_bundle_runtime_reconciliation_tasks',
      columns: [
        { name: 'id', type: 'text', isPrimary: true }, { name: 'tenant_id', type: 'text', isNullable: true }, { name: 'apply_run_id', type: 'text' },
        { name: 'engine_set_ids_json', type: 'text' }, { name: 'runtime_resource_set_ids_json', type: 'text' }, { name: 'engine_ids_json', type: 'text' },
        { name: 'status', type: 'text' }, { name: 'lease_id', type: 'text', isNullable: true }, { name: 'lease_expires_at', type: 'bigint', isNullable: true },
        { name: 'attempts', type: 'integer', default: 0 }, { name: 'next_attempt_at', type: 'bigint', isNullable: true }, { name: 'result_json', type: 'text', isNullable: true },
        { name: 'last_error', type: 'text', isNullable: true }, { name: 'completed_at', type: 'bigint', isNullable: true },
        { name: 'created_at', type: 'bigint' }, { name: 'updated_at', type: 'bigint' },
      ],
      uniques: [new TableUnique({ name: 'uq_config_bundle_runtime_reconciliation_task_run', columnNames: ['apply_run_id'] })],
      indices: [
        new TableIndex({ name: 'idx_config_bundle_runtime_reconciliation_task_ready', columnNames: ['status', 'next_attempt_at', 'created_at'] }),
        new TableIndex({ name: 'idx_config_bundle_runtime_reconciliation_task_lease', columnNames: ['lease_expires_at'] }),
      ],
    }), true);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('config_bundle_runtime_reconciliation_tasks')) await queryRunner.dropTable('config_bundle_runtime_reconciliation_tasks');
  }
}
