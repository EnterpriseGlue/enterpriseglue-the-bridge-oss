import { Table, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

export class AddServiceAccounts1700000000027 implements MigrationInterface {
  name = 'AddServiceAccounts1700000000027';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const serviceAccounts = tablePath(queryRunner, 'ServiceAccount', 'service_accounts');

    if (!(await queryRunner.hasTable(serviceAccounts))) {
      await queryRunner.createTable(new Table({
        name: serviceAccounts,
        columns: [
          { name: 'id', type: 'text', isPrimary: true },
          { name: 'name', type: 'text' },
          { name: 'description', type: 'text', isNullable: true },
          { name: 'is_active', type: 'boolean', default: true },
          { name: 'created_by_id', type: 'text', isNullable: true },
          { name: 'revoked_at', type: 'bigint', isNullable: true },
          { name: 'created_at', type: 'bigint' },
          { name: 'updated_at', type: 'bigint' },
        ],
        indices: [
          new TableIndex({ name: 'idx_service_accounts_active', columnNames: ['is_active'] }),
          new TableIndex({ name: 'idx_service_accounts_created_by', columnNames: ['created_by_id'] }),
        ],
      }), true);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const serviceAccounts = tablePath(queryRunner, 'ServiceAccount', 'service_accounts');
    if (await queryRunner.hasTable(serviceAccounts)) {
      await queryRunner.dropTable(serviceAccounts);
    }
  }
}
