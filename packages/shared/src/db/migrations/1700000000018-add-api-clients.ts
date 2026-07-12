import { Table, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

export class AddApiClients1700000000018 implements MigrationInterface {
  name = 'AddApiClients1700000000018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const apiClients = tablePath(queryRunner, 'ApiClient', 'api_clients');

    if (!(await queryRunner.hasTable(apiClients))) {
      await queryRunner.createTable(new Table({
        name: apiClients,
        columns: [
          { name: 'id', type: 'text', isPrimary: true },
          { name: 'name', type: 'text' },
          { name: 'token_prefix', type: 'text' },
          { name: 'secret_hash', type: 'text' },
          { name: 'scopes_json', type: 'text' },
          { name: 'is_active', type: 'boolean', default: true },
          { name: 'created_by_id', type: 'text', isNullable: true },
          { name: 'last_used_at', type: 'bigint', isNullable: true },
          { name: 'revoked_at', type: 'bigint', isNullable: true },
          { name: 'created_at', type: 'bigint' },
          { name: 'updated_at', type: 'bigint' },
        ],
        indices: [
          new TableIndex({ name: 'idx_api_clients_active', columnNames: ['is_active'] }),
          new TableIndex({ name: 'idx_api_clients_created_by', columnNames: ['created_by_id'] }),
        ],
      }), true);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const apiClients = tablePath(queryRunner, 'ApiClient', 'api_clients');
    if (await queryRunner.hasTable(apiClients)) {
      await queryRunner.dropTable(apiClients);
    }
  }
}
