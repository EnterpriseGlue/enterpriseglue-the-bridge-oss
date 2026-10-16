import { TableIndex, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { portableTable, sqlIdentifier, sqlTablePath } from './support/portable-columns.js';

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
      await queryRunner.createTable(portableTable(queryRunner, {
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
      const column = (name: string) => sqlIdentifier(queryRunner, name);
      const registrationsRef = sqlTablePath(queryRunner, registrations);
      await queryRunner.query(`
        INSERT INTO ${registrationsRef} (
          ${column('id')},
          ${column('engine_id')},
          ${column('external_id')},
          ${column('labels_json')},
          ${column('registration_source')},
          ${column('api_client_id')},
          ${column('last_registered_at')},
          ${column('created_at')},
          ${column('updated_at')}
        )
        SELECT
          e.${column('id')},
          e.${column('id')},
          e.${column('external_id')},
          e.${column('labels_json')},
          COALESCE(e.${column('registration_source')}, 'user'),
          NULL,
          e.${column('external_updated_at')},
          e.${column('created_at')},
          e.${column('updated_at')}
        FROM ${sqlTablePath(queryRunner, engines)} e
        WHERE e.${column('external_id')} IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM ${registrationsRef} r
            WHERE r.${column('engine_id')} = e.${column('id')}
               OR r.${column('external_id')} = e.${column('external_id')}
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
