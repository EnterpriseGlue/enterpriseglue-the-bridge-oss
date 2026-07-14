import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner): string {
  try { return queryRunner.connection.getMetadata('User').tablePath; } catch { return 'users'; }
}

export class AddUserAuthSessionVersion1700000000083 implements MigrationInterface {
  name = 'AddUserAuthSessionVersion1700000000083';
  async up(queryRunner: QueryRunner): Promise<void> {
    const table = tablePath(queryRunner);
    if (!(await queryRunner.hasTable(table)) || await queryRunner.hasColumn(table, 'auth_session_version')) return;
    await queryRunner.addColumn(table, new TableColumn({ name: 'auth_session_version', type: 'integer', default: '0', isNullable: false }));
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    const table = tablePath(queryRunner);
    if (await queryRunner.hasColumn(table, 'auth_session_version')) await queryRunner.dropColumn(table, 'auth_session_version');
  }
}
