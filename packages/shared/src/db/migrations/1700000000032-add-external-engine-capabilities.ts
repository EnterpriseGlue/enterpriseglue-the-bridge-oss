import { TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

async function addColumnIfMissing(queryRunner: QueryRunner, tableName: string, column: TableColumn): Promise<void> {
  if (!(await queryRunner.hasTable(tableName)) || await queryRunner.hasColumn(tableName, column.name)) return;
  await queryRunner.addColumn(tableName, column);
}

async function dropColumnIfPresent(queryRunner: QueryRunner, tableName: string, columnName: string): Promise<void> {
  if (!(await queryRunner.hasTable(tableName)) || !(await queryRunner.hasColumn(tableName, columnName))) return;
  await queryRunner.dropColumn(tableName, columnName);
}

async function createIndexIfMissing(queryRunner: QueryRunner, tableName: string, index: TableIndex): Promise<void> {
  if (!(await queryRunner.hasTable(tableName))) return;
  const table = await queryRunner.getTable(tableName);
  if (!table || table.indices.some((candidate) => candidate.name === index.name)) return;
  await queryRunner.createIndex(tableName, index);
}

async function dropIndexIfPresent(queryRunner: QueryRunner, tableName: string, indexName: string): Promise<void> {
  if (!(await queryRunner.hasTable(tableName))) return;
  const table = await queryRunner.getTable(tableName);
  const index = table?.indices.find((candidate) => candidate.name === indexName);
  if (index) await queryRunner.dropIndex(tableName, index);
}

export class AddExternalEngineCapabilities1700000000032 implements MigrationInterface {
  name = 'AddExternalEngineCapabilities1700000000032';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const enginesTable = tablePath(queryRunner, 'Engine', 'engines');
    const registrationsTable = tablePath(queryRunner, 'ExternalEngineRegistration', 'external_engine_registrations');

    await addColumnIfMissing(queryRunner, enginesTable, new TableColumn({ name: 'capabilities_json', type: 'text', isNullable: true }));
    await addColumnIfMissing(queryRunner, enginesTable, new TableColumn({ name: 'capability_status', type: 'text', isNullable: true }));
    await createIndexIfMissing(queryRunner, enginesTable, new TableIndex({ name: 'idx_engines_capability_status', columnNames: ['capability_status'] }));

    await addColumnIfMissing(queryRunner, registrationsTable, new TableColumn({ name: 'capabilities_json', type: 'text', isNullable: true }));
    await addColumnIfMissing(queryRunner, registrationsTable, new TableColumn({ name: 'capability_status', type: 'text', isNullable: true }));
    await createIndexIfMissing(queryRunner, registrationsTable, new TableIndex({ name: 'idx_external_engine_registrations_capability_status', columnNames: ['capability_status'] }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const enginesTable = tablePath(queryRunner, 'Engine', 'engines');
    const registrationsTable = tablePath(queryRunner, 'ExternalEngineRegistration', 'external_engine_registrations');

    await dropIndexIfPresent(queryRunner, registrationsTable, 'idx_external_engine_registrations_capability_status');
    await dropColumnIfPresent(queryRunner, registrationsTable, 'capability_status');
    await dropColumnIfPresent(queryRunner, registrationsTable, 'capabilities_json');

    await dropIndexIfPresent(queryRunner, enginesTable, 'idx_engines_capability_status');
    await dropColumnIfPresent(queryRunner, enginesTable, 'capability_status');
    await dropColumnIfPresent(queryRunner, enginesTable, 'capabilities_json');
  }
}
