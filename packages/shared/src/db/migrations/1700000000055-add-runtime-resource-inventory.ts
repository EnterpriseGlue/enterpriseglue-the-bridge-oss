import { Table, TableIndex, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRuntimeResourceInventory1700000000055 implements MigrationInterface {
  name = 'AddRuntimeResourceInventory1700000000055';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!await queryRunner.hasTable('runtime_resources')) {
      await queryRunner.createTable(new Table({ name: 'runtime_resources', columns: [
        { name: 'id', type: 'text', isPrimary: true }, { name: 'tenant_id', type: 'text', isNullable: true },
        { name: 'engine_id', type: 'text' }, { name: 'resource_kind', type: 'text' }, { name: 'resource_key', type: 'text' }, { name: 'runtime_tenant_id', type: 'text', default: "''" },
        { name: 'engine_resource_id', type: 'text', isNullable: true }, { name: 'deployment_id', type: 'text', isNullable: true }, { name: 'project_id', type: 'text', isNullable: true }, { name: 'file_id', type: 'text', isNullable: true }, { name: 'version', type: 'integer', isNullable: true },
        { name: 'labels_json', type: 'text', default: "'{}'" }, { name: 'lineage_json', type: 'text', default: "'{}'" }, { name: 'source', type: 'text', default: "'engine_discovery'" }, { name: 'source_ref', type: 'text', isNullable: true }, { name: 'observed_at', type: 'bigint' }, { name: 'is_active', type: 'boolean', default: true }, { name: 'created_at', type: 'bigint' }, { name: 'updated_at', type: 'bigint' },
      ], uniques: [new TableUnique({ name: 'uq_runtime_resources_identity', columnNames: ['engine_id', 'resource_kind', 'resource_key', 'runtime_tenant_id'] })], indices: [new TableIndex({ name: 'idx_runtime_resources_engine_kind', columnNames: ['engine_id', 'resource_kind'] }), new TableIndex({ name: 'idx_runtime_resources_project', columnNames: ['project_id'] }), new TableIndex({ name: 'idx_runtime_resources_active', columnNames: ['engine_id', 'is_active'] })] }), true);
    }
    if (!await queryRunner.hasTable('runtime_resource_set_materializations')) {
      await queryRunner.createTable(new Table({ name: 'runtime_resource_set_materializations', columns: [
        { name: 'id', type: 'text', isPrimary: true }, { name: 'tenant_id', type: 'text', isNullable: true }, { name: 'runtime_resource_set_id', type: 'text' }, { name: 'runtime_resource_id', type: 'text' }, { name: 'selector_fingerprint', type: 'text' }, { name: 'matched_by_json', type: 'text' }, { name: 'lineage_json', type: 'text' }, { name: 'last_seen_at', type: 'bigint' }, { name: 'created_at', type: 'bigint' }, { name: 'updated_at', type: 'bigint' },
      ], uniques: [new TableUnique({ name: 'uq_runtime_resource_set_materializations_member', columnNames: ['runtime_resource_set_id', 'runtime_resource_id'] })], indices: [new TableIndex({ name: 'idx_runtime_resource_set_materializations_set', columnNames: ['runtime_resource_set_id'] }), new TableIndex({ name: 'idx_runtime_resource_set_materializations_resource', columnNames: ['runtime_resource_id'] })] }), true);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('runtime_resource_set_materializations')) await queryRunner.dropTable('runtime_resource_set_materializations');
    if (await queryRunner.hasTable('runtime_resources')) await queryRunner.dropTable('runtime_resources');
  }
}
