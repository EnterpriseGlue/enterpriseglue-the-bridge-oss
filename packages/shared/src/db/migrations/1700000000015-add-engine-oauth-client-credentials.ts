import type { MigrationInterface, QueryRunner } from 'typeorm';
import { portableColumn } from './support/portable-columns.js';

export class AddEngineOauthClientCredentials1700000000015 implements MigrationInterface {
  name = 'AddEngineOauthClientCredentials1700000000015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tablePath = queryRunner.connection.getMetadata('Engine').tablePath;
    if (!(await queryRunner.hasTable(tablePath))) return;

    const columns = [
      portableColumn(queryRunner, { name: 'oauth_token_url', type: 'text', isNullable: true }),
      portableColumn(queryRunner, { name: 'oauth_scopes', type: 'text', isNullable: true }),
      portableColumn(queryRunner, { name: 'oauth_audience', type: 'text', isNullable: true }),
    ];

    for (const column of columns) {
      if (!(await queryRunner.hasColumn(tablePath, column.name))) {
        await queryRunner.addColumn(tablePath, column);
      }
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
  }
}
