import type { MigrationInterface, QueryRunner } from 'typeorm';
import { portableColumn } from './support/portable-columns.js';

export class AddHotfixMetadata1700000000008 implements MigrationInterface {
  name = 'AddHotfixMetadata1700000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tablePath = queryRunner.connection.getMetadata('Commit').tablePath;
    if (!(await queryRunner.hasTable(tablePath))) {
      console.warn(`Migration ${this.name}: table "${tablePath}" not found; skipping.`);
      return;
    }

    const cols = await queryRunner.getTable(tablePath);
    const hasHotfixCommit = cols?.columns.some(c => c.name === 'hotfix_from_commit_id');
    const hasHotfixVersion = cols?.columns.some(c => c.name === 'hotfix_from_file_version');

    if (!hasHotfixCommit) {
      await queryRunner.addColumn(tablePath, portableColumn(queryRunner, {
        name: 'hotfix_from_commit_id', type: 'text', isNullable: true,
      }));
    }
    if (!hasHotfixVersion) {
      await queryRunner.addColumn(tablePath, portableColumn(queryRunner, {
        name: 'hotfix_from_file_version', type: 'integer', isNullable: true,
      }));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tablePath = queryRunner.connection.getMetadata('Commit').tablePath;
    if (!(await queryRunner.hasTable(tablePath))) {
      return;
    }

    const cols = await queryRunner.getTable(tablePath);
    if (cols?.columns.some(c => c.name === 'hotfix_from_commit_id')) {
      await queryRunner.dropColumn(tablePath, 'hotfix_from_commit_id');
    }
    if (cols?.columns.some(c => c.name === 'hotfix_from_file_version')) {
      await queryRunner.dropColumn(tablePath, 'hotfix_from_file_version');
    }
  }
}
