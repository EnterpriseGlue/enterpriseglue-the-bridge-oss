import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Retains the ordinary config-apply receipt for an import-owned rollback. */
export class AddCamundaNativeGrantRollbackReceipt1700000000099 implements MigrationInterface {
  name = 'AddCamundaNativeGrantRollbackReceipt1700000000099';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!await queryRunner.hasTable('camunda_native_grant_import_runs')) return;
    if (!await queryRunner.hasColumn('camunda_native_grant_import_runs', 'rollback_config_bundle_run_id')) {
      await queryRunner.addColumn('camunda_native_grant_import_runs', new TableColumn({ name: 'rollback_config_bundle_run_id', type: 'text', isNullable: true }));
    }
    if (!await queryRunner.hasColumn('camunda_native_grant_import_runs', 'rolled_back_at')) {
      await queryRunner.addColumn('camunda_native_grant_import_runs', new TableColumn({ name: 'rolled_back_at', type: 'bigint', isNullable: true }));
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!await queryRunner.hasTable('camunda_native_grant_import_runs')) return;
    if (await queryRunner.hasColumn('camunda_native_grant_import_runs', 'rolled_back_at')) await queryRunner.dropColumn('camunda_native_grant_import_runs', 'rolled_back_at');
    if (await queryRunner.hasColumn('camunda_native_grant_import_runs', 'rollback_config_bundle_run_id')) await queryRunner.dropColumn('camunda_native_grant_import_runs', 'rollback_config_bundle_run_id');
  }
}
