import { Table, TableIndex, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

async function createTableIfMissing(queryRunner: QueryRunner, table: Table): Promise<void> {
  if (!(await queryRunner.hasTable(table.name))) {
    await queryRunner.createTable(table, true);
  }
}

export class AddEngineSets1700000000025 implements MigrationInterface {
  name = 'AddEngineSets1700000000025';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const engineSets = tablePath(queryRunner, 'EngineSet', 'engine_sets');
    const materializations = tablePath(queryRunner, 'EngineSetMaterialization', 'engine_set_materializations');

    await createTableIfMissing(queryRunner, new Table({
      name: engineSets,
      columns: [
        { name: 'id', type: 'text', isPrimary: true },
        { name: 'tenant_id', type: 'text', isNullable: true },
        { name: 'key', type: 'text' },
        { name: 'name', type: 'text' },
        { name: 'description', type: 'text', isNullable: true },
        { name: 'selector_json', type: 'text' },
        { name: 'selector_fingerprint', type: 'text' },
        { name: 'source', type: 'text', default: "'manual'" },
        { name: 'source_ref', type: 'text', isNullable: true },
        { name: 'is_archived', type: 'boolean', default: false },
        { name: 'created_by_id', type: 'text', isNullable: true },
        { name: 'last_materialized_at', type: 'bigint', isNullable: true },
        { name: 'materialization_status', type: 'text', default: "'pending'" },
        { name: 'materialization_error', type: 'text', isNullable: true },
        { name: 'created_at', type: 'bigint' },
        { name: 'updated_at', type: 'bigint' },
      ],
      uniques: [
        new TableUnique({ name: 'uq_engine_sets_tenant_key', columnNames: ['tenant_id', 'key'] }),
      ],
      indices: [
        new TableIndex({ name: 'idx_engine_sets_tenant', columnNames: ['tenant_id'] }),
        new TableIndex({ name: 'idx_engine_sets_source', columnNames: ['source', 'source_ref'] }),
        new TableIndex({ name: 'idx_engine_sets_archived', columnNames: ['is_archived'] }),
      ],
    }));

    await createTableIfMissing(queryRunner, new Table({
      name: materializations,
      columns: [
        { name: 'id', type: 'text', isPrimary: true },
        { name: 'tenant_id', type: 'text', isNullable: true },
        { name: 'engine_set_id', type: 'text' },
        { name: 'engine_id', type: 'text' },
        { name: 'selector_fingerprint', type: 'text' },
        { name: 'matched_by_json', type: 'text' },
        { name: 'lineage_json', type: 'text' },
        { name: 'source', type: 'text', default: "'engine_set'" },
        { name: 'source_ref', type: 'text', isNullable: true },
        { name: 'last_seen_at', type: 'bigint' },
        { name: 'created_at', type: 'bigint' },
        { name: 'updated_at', type: 'bigint' },
      ],
      uniques: [
        new TableUnique({
          name: 'uq_engine_set_materializations_member',
          columnNames: ['engine_set_id', 'engine_id'],
        }),
      ],
      indices: [
        new TableIndex({ name: 'idx_engine_set_materializations_tenant', columnNames: ['tenant_id'] }),
        new TableIndex({ name: 'idx_engine_set_materializations_set', columnNames: ['engine_set_id'] }),
        new TableIndex({ name: 'idx_engine_set_materializations_engine', columnNames: ['engine_id'] }),
        new TableIndex({ name: 'idx_engine_set_materializations_fingerprint', columnNames: ['selector_fingerprint'] }),
      ],
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      tablePath(queryRunner, 'EngineSetMaterialization', 'engine_set_materializations'),
      tablePath(queryRunner, 'EngineSet', 'engine_sets'),
    ];

    for (const table of tables) {
      if (await queryRunner.hasTable(table)) {
        await queryRunner.dropTable(table);
      }
    }
  }
}
