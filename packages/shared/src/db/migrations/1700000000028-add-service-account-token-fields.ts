import type { MigrationInterface, QueryRunner } from 'typeorm';
import { portableColumn } from './support/portable-columns.js';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

export class AddServiceAccountTokenFields1700000000028 implements MigrationInterface {
  name = 'AddServiceAccountTokenFields1700000000028';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const serviceAccounts = tablePath(queryRunner, 'ServiceAccount', 'service_accounts');
    if (!(await queryRunner.hasTable(serviceAccounts))) return;

    const columns = [
      portableColumn(queryRunner, { name: 'token_prefix', type: 'text', isNullable: true }),
      portableColumn(queryRunner, { name: 'secret_hash', type: 'text', isNullable: true }),
      portableColumn(queryRunner, { name: 'scopes_json', type: 'text', isNullable: true }),
      portableColumn(queryRunner, { name: 'last_used_at', type: 'bigint', isNullable: true }),
    ];

    for (const column of columns) {
      if (!(await queryRunner.hasColumn(serviceAccounts, column.name))) {
        await queryRunner.addColumn(serviceAccounts, column);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const serviceAccounts = tablePath(queryRunner, 'ServiceAccount', 'service_accounts');
    if (!(await queryRunner.hasTable(serviceAccounts))) return;

    for (const columnName of ['last_used_at', 'scopes_json', 'secret_hash', 'token_prefix']) {
      if (await queryRunner.hasColumn(serviceAccounts, columnName)) {
        await queryRunner.dropColumn(serviceAccounts, columnName);
      }
    }
  }
}
