import { Table, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds portable, sanitized evidence storage for the Camunda 7 grant importer. */
export class AddCamundaNativeGrantImportRuns1700000000098 implements MigrationInterface {
  name = 'AddCamundaNativeGrantImportRuns1700000000098';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('camunda_native_grant_import_runs')) return;
    await queryRunner.createTable(new Table({
      name: 'camunda_native_grant_import_runs',
      columns: [
        { name: 'id', type: 'text', isPrimary: true },
        { name: 'engine_id', type: 'text' },
        { name: 'tenant_id', type: 'text', isNullable: true },
        { name: 'source_kind', type: 'text' },
        { name: 'status', type: 'text' },
        { name: 'input_hash', type: 'text' },
        { name: 'mapping_catalog_version', type: 'text' },
        { name: 'inventory_truncated', type: 'boolean', default: 'false' },
        { name: 'normalized_counts_json', type: 'text' },
        { name: 'classifications_json', type: 'text' },
        { name: 'encrypted_detailed_snapshot', type: 'text', isNullable: true },
        { name: 'detailed_snapshot_expires_at', type: 'bigint', isNullable: true },
        { name: 'draft_hash', type: 'text', isNullable: true },
        { name: 'created_by_id', type: 'text', isNullable: true },
        { name: 'approved_by_id', type: 'text', isNullable: true },
        { name: 'approved_at', type: 'bigint', isNullable: true },
        { name: 'applied_config_bundle_run_id', type: 'text', isNullable: true },
        { name: 'created_at', type: 'bigint' },
        { name: 'updated_at', type: 'bigint' },
      ],
      indices: [
        new TableIndex({ name: 'idx_camunda_native_grant_import_engine_created', columnNames: ['engine_id', 'created_at'] }),
        new TableIndex({ name: 'idx_camunda_native_grant_import_snapshot_expiry', columnNames: ['detailed_snapshot_expires_at'] }),
        new TableIndex({ name: 'idx_camunda_native_grant_import_status_updated', columnNames: ['status', 'updated_at'] }),
      ],
    }), true);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('camunda_native_grant_import_runs')) await queryRunner.dropTable('camunda_native_grant_import_runs');
  }
}
