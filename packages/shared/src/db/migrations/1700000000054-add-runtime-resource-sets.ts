import { Table, TableIndex, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
export class AddRuntimeResourceSets1700000000054 implements MigrationInterface {
  name = 'AddRuntimeResourceSets1700000000054';
  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('runtime_resource_sets')) return;
    await queryRunner.createTable(new Table({ name: 'runtime_resource_sets', columns: [
      { name: 'id', type: 'text', isPrimary: true }, { name: 'tenant_id', type: 'text', isNullable: true }, { name: 'key', type: 'text' }, { name: 'name', type: 'text' }, { name: 'description', type: 'text', isNullable: true }, { name: 'engine_id', type: 'text' }, { name: 'resource_kind', type: 'text' }, { name: 'selector_json', type: 'text' }, { name: 'selector_fingerprint', type: 'text' }, { name: 'runtime_tenant_id', type: 'text', isNullable: true }, { name: 'source', type: 'text', default: "'manual'" }, { name: 'source_ref', type: 'text', isNullable: true }, { name: 'is_archived', type: 'boolean', default: false }, { name: 'created_by_id', type: 'text', isNullable: true }, { name: 'created_at', type: 'bigint' }, { name: 'updated_at', type: 'bigint' },
    ], uniques: [new TableUnique({ name: 'uq_runtime_resource_sets_tenant_key', columnNames: ['tenant_id', 'key'] })], indices: [new TableIndex({ name: 'idx_runtime_resource_sets_engine', columnNames: ['engine_id'] }), new TableIndex({ name: 'idx_runtime_resource_sets_source', columnNames: ['source', 'source_ref'] })] }), true);
  }
  async down(queryRunner: QueryRunner): Promise<void> { if (await queryRunner.hasTable('runtime_resource_sets')) await queryRunner.dropTable('runtime_resource_sets'); }
}
