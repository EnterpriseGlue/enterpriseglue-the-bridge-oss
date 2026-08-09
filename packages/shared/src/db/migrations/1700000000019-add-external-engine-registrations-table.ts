import { Table, TableIndex, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

export class AddExternalEngineRegistrationsTable1700000000019 implements MigrationInterface {
  name = 'AddExternalEngineRegistrationsTable1700000000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const registrations = tablePath(queryRunner, 'ExternalEngineRegistration', 'external_engine_registrations');
    const engines = tablePath(queryRunner, 'Engine', 'engines');

    if (!(await queryRunner.hasTable(registrations))) {
      await queryRunner.createTable(new Table({
        name: registrations,
        columns: [
          { name: 'id', type: 'text', isPrimary: true },
          { name: 'engine_id', type: 'text' },
          { name: 'external_id', type: 'text' },
          { name: 'labels_json', type: 'text', isNullable: true },
          { name: 'registration_source', type: 'text' },
          { name: 'api_client_id', type: 'text', isNullable: true },
          { name: 'last_registered_at', type: 'bigint', isNullable: true },
          { name: 'created_at', type: 'bigint' },
          { name: 'updated_at', type: 'bigint' },
        ],
        uniques: [
          new TableUnique({ name: 'uq_external_engine_registrations_engine', columnNames: ['engine_id'] }),
        ],
        indices: [
          new TableIndex({ name: 'idx_external_engine_registrations_engine', columnNames: ['engine_id'] }),
          new TableIndex({ name: 'idx_external_engine_registrations_external_id', columnNames: ['external_id'] }),
          new TableIndex({ name: 'idx_external_engine_registrations_api_client', columnNames: ['api_client_id'] }),
        ],
      }), true);
    }

    if (await queryRunner.hasTable(engines)) {
      await queryRunner.query(`
        INSERT INTO ${registrations} (
          id,
          engine_id,
          external_id,
          labels_json,
          registration_source,
          api_client_id,
          last_registered_at,
          created_at,
          updated_at
        )
        SELECT
          e.id,
          e.id,
          e.external_id,
          e.labels_json,
          COALESCE(e.registration_source, 'user'),
          NULL,
          e.external_updated_at,
          e.created_at,
          e.updated_at
        FROM ${engines} e
        WHERE e.external_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM ${registrations} r
            WHERE r.engine_id = e.id OR r.external_id = e.external_id
          )
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const registrations = tablePath(queryRunner, 'ExternalEngineRegistration', 'external_engine_registrations');
    if (await queryRunner.hasTable(registrations)) {
      await queryRunner.dropTable(registrations);
    }
  }
}
