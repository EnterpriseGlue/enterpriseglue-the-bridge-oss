import { TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

const COLUMNS: Array<{ name: string; type: string; isNullable?: boolean; default?: string }> = [
  { name: 'source_ref', type: 'text', isNullable: true },
  { name: 'config_key', type: 'text', isNullable: true },
  { name: 'config_key_identity', type: 'text', isNullable: true },
  { name: 'source_hash', type: 'text', isNullable: true },
  { name: 'last_applied_at', type: 'bigint', isNullable: true },
  { name: 'ownership_mode', type: 'text', isNullable: true },
  { name: 'runtime_access_scope', type: 'text', default: "'engine_wide'" },
  { name: 'deployment_integration', type: 'text', default: "'enterpriseglue_proxy'" },
  { name: 'connection_mode', type: 'text', default: "'direct'" },
];

/** Config provenance and the central-engine contract; defaults retain legacy engine behavior. */
export class AddEngineConfigOwnershipAndRuntimeScope1700000000051 implements MigrationInterface {
  name = 'AddEngineConfigOwnershipAndRuntimeScope1700000000051';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner, 'Engine', 'engines');
    if (!(await queryRunner.hasTable(tableName))) return;
    for (const definition of COLUMNS) {
      if (!(await queryRunner.hasColumn(tableName, definition.name))) {
        await queryRunner.addColumn(tableName, new TableColumn(definition));
      }
    }
    const table = await queryRunner.getTable(tableName);
    if (!table) return;
    if (!table.indices.some((index) => index.name === 'idx_engines_source_ref')) {
      await queryRunner.createIndex(tableName, new TableIndex({ name: 'idx_engines_source_ref', columnNames: ['source_ref'] }));
    }
    if (!table.indices.some((index) => index.name === 'uq_engines_config_key_identity')) {
      await queryRunner.createIndex(tableName, new TableIndex({ name: 'uq_engines_config_key_identity', columnNames: ['config_key_identity'], isUnique: true }));
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner, 'Engine', 'engines');
    if (!(await queryRunner.hasTable(tableName))) return;
    const table = await queryRunner.getTable(tableName);
    const sourceIndex = table?.indices.find((index) => index.name === 'idx_engines_source_ref');
    const keyIndex = table?.indices.find((index) => index.name === 'uq_engines_config_key_identity');
    if (sourceIndex) await queryRunner.dropIndex(tableName, sourceIndex);
    if (keyIndex) await queryRunner.dropIndex(tableName, keyIndex);
    for (const definition of [...COLUMNS].reverse()) {
      if (await queryRunner.hasColumn(tableName, definition.name)) await queryRunner.dropColumn(tableName, definition.name);
    }
  }
}
