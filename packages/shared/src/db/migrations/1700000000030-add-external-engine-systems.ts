import { Table, TableColumn, TableIndex, TableUnique } from 'typeorm';
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

export class AddExternalEngineSystems1700000000030 implements MigrationInterface {
  name = 'AddExternalEngineSystems1700000000030';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const externalSystemsTable = tablePath(queryRunner, 'ExternalEngineSystem', 'external_engine_systems');
    const enginesTable = tablePath(queryRunner, 'Engine', 'engines');
    const registrationsTable = tablePath(queryRunner, 'ExternalEngineRegistration', 'external_engine_registrations');

    if (!(await queryRunner.hasTable(externalSystemsTable))) {
      await queryRunner.createTable(new Table({
        name: externalSystemsTable,
        columns: [
          { name: 'id', type: 'text', isPrimary: true },
          { name: 'tenant_id', type: 'text', isNullable: true },
          { name: 'key', type: 'text' },
          { name: 'name', type: 'text' },
          { name: 'description', type: 'text', isNullable: true },
          { name: 'default_management_mode', type: 'text', default: "'external_managed'" },
          { name: 'default_field_ownership_json', type: 'text', isNullable: true },
          { name: 'is_active', type: 'boolean', default: true },
          { name: 'created_by_id', type: 'text', isNullable: true },
          { name: 'created_at', type: 'bigint' },
          { name: 'updated_at', type: 'bigint' },
        ],
      }));
      await queryRunner.createUniqueConstraint(
        externalSystemsTable,
        new TableUnique({
          name: 'uq_external_engine_systems_tenant_key',
          columnNames: ['tenant_id', 'key'],
        })
      );
      await queryRunner.createIndex(
        externalSystemsTable,
        new TableIndex({ name: 'idx_external_engine_systems_tenant', columnNames: ['tenant_id'] })
      );
      await queryRunner.createIndex(
        externalSystemsTable,
        new TableIndex({ name: 'idx_external_engine_systems_active', columnNames: ['is_active'] })
      );
    }

    await addColumnIfMissing(queryRunner, enginesTable, new TableColumn({ name: 'external_system_id', type: 'text', isNullable: true }));
    await addColumnIfMissing(queryRunner, enginesTable, new TableColumn({ name: 'management_mode', type: 'text', isNullable: true }));
    await addColumnIfMissing(queryRunner, enginesTable, new TableColumn({ name: 'field_ownership_json', type: 'text', isNullable: true }));
    await addColumnIfMissing(queryRunner, enginesTable, new TableColumn({ name: 'drift_status', type: 'text', isNullable: true }));
    if (await queryRunner.hasTable(enginesTable)) {
      const enginesTableObject = await queryRunner.getTable(enginesTable);
      if (enginesTableObject && !enginesTableObject.indices.some((index) => index.name === 'idx_engines_external_system')) {
        await queryRunner.createIndex(
          enginesTable,
          new TableIndex({ name: 'idx_engines_external_system', columnNames: ['external_system_id'] })
        );
      }
    }

    await addColumnIfMissing(queryRunner, registrationsTable, new TableColumn({ name: 'external_system_id', type: 'text', isNullable: true }));
    await addColumnIfMissing(queryRunner, registrationsTable, new TableColumn({ name: 'management_mode', type: 'text', isNullable: true }));
    await addColumnIfMissing(queryRunner, registrationsTable, new TableColumn({ name: 'field_ownership_json', type: 'text', isNullable: true }));
    await addColumnIfMissing(queryRunner, registrationsTable, new TableColumn({ name: 'drift_status', type: 'text', isNullable: true }));
    if (await queryRunner.hasTable(registrationsTable)) {
      const registrationsTableObject = await queryRunner.getTable(registrationsTable);
      if (registrationsTableObject && !registrationsTableObject.indices.some((index) => index.name === 'idx_external_engine_registrations_system')) {
        await queryRunner.createIndex(
          registrationsTable,
          new TableIndex({ name: 'idx_external_engine_registrations_system', columnNames: ['external_system_id'] })
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const externalSystemsTable = tablePath(queryRunner, 'ExternalEngineSystem', 'external_engine_systems');
    const enginesTable = tablePath(queryRunner, 'Engine', 'engines');
    const registrationsTable = tablePath(queryRunner, 'ExternalEngineRegistration', 'external_engine_registrations');

    if (await queryRunner.hasTable(registrationsTable)) {
      const table = await queryRunner.getTable(registrationsTable);
      const index = table?.indices.find((candidate) => candidate.name === 'idx_external_engine_registrations_system');
      if (index) await queryRunner.dropIndex(registrationsTable, index);
    }
    await dropColumnIfPresent(queryRunner, registrationsTable, 'drift_status');
    await dropColumnIfPresent(queryRunner, registrationsTable, 'field_ownership_json');
    await dropColumnIfPresent(queryRunner, registrationsTable, 'management_mode');
    await dropColumnIfPresent(queryRunner, registrationsTable, 'external_system_id');

    if (await queryRunner.hasTable(enginesTable)) {
      const table = await queryRunner.getTable(enginesTable);
      const index = table?.indices.find((candidate) => candidate.name === 'idx_engines_external_system');
      if (index) await queryRunner.dropIndex(enginesTable, index);
    }
    await dropColumnIfPresent(queryRunner, enginesTable, 'drift_status');
    await dropColumnIfPresent(queryRunner, enginesTable, 'field_ownership_json');
    await dropColumnIfPresent(queryRunner, enginesTable, 'management_mode');
    await dropColumnIfPresent(queryRunner, enginesTable, 'external_system_id');

    if (await queryRunner.hasTable(externalSystemsTable)) {
      await queryRunner.dropTable(externalSystemsTable);
    }
  }
}
