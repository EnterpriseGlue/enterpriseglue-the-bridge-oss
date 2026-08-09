import { Table, TableIndex, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConfigBundleApplyRuns1700000000061 implements MigrationInterface {
  name = 'AddConfigBundleApplyRuns1700000000061';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('config_bundle_apply_runs')) return;
    await queryRunner.createTable(new Table({
      name: 'config_bundle_apply_runs',
      columns: [
        { name: 'id', type: 'text', isPrimary: true },
        { name: 'tenant_id', type: 'text', isNullable: true },
        { name: 'tenant_scope_key', type: 'text' },
        { name: 'bundle_key', type: 'text' },
        { name: 'canonical_hash', type: 'text' },
        { name: 'idempotency_key', type: 'text', isNullable: true },
        { name: 'actor_id', type: 'text', isNullable: true },
        { name: 'status', type: 'text' },
        { name: 'result_json', type: 'text', isNullable: true },
        { name: 'error_message', type: 'text', isNullable: true },
        { name: 'completed_at', type: 'bigint', isNullable: true },
        { name: 'created_at', type: 'bigint' },
        { name: 'updated_at', type: 'bigint' },
      ],
      uniques: [new TableUnique({ name: 'uq_config_bundle_apply_run_idempotency', columnNames: ['tenant_scope_key', 'idempotency_key'] })],
      indices: [
        new TableIndex({ name: 'idx_config_bundle_apply_run_tenant_created', columnNames: ['tenant_scope_key', 'created_at'] }),
        new TableIndex({ name: 'idx_config_bundle_apply_run_status', columnNames: ['status', 'updated_at'] }),
      ],
    }), true);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('config_bundle_apply_runs')) await queryRunner.dropTable('config_bundle_apply_runs');
  }
}
