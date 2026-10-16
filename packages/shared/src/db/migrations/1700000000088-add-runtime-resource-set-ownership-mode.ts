import type { MigrationInterface, QueryRunner } from 'typeorm';
import { portableColumn, sqlIdentifier, sqlTablePath } from './support/portable-columns.js';

function tablePath(queryRunner: QueryRunner): string {
  try { return queryRunner.connection.getMetadata('RuntimeResourceSet').tablePath; } catch { return 'runtime_resource_sets'; }
}

export class AddRuntimeResourceSetOwnershipMode1700000000088 implements MigrationInterface {
  name = 'AddRuntimeResourceSetOwnershipMode1700000000088';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    if (!await queryRunner.hasTable(tableName)) return;
    if (!await queryRunner.hasColumn(tableName, 'ownership_mode')) {
      await queryRunner.addColumn(tableName, portableColumn(queryRunner, { name: 'ownership_mode', type: 'text', default: "'manual'" }));
    }
    const column = (name: string) => sqlIdentifier(queryRunner, name);
    await queryRunner.query(
      `UPDATE ${sqlTablePath(queryRunner, tableName)} SET ${column('ownership_mode')} = 'config_locked'`
      + ` WHERE ${column('source')} = 'config'`
      + ` AND (${column('ownership_mode')} IS NULL OR ${column('ownership_mode')} = 'manual')`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    if (await queryRunner.hasTable(tableName) && await queryRunner.hasColumn(tableName, 'ownership_mode')) {
      await queryRunner.dropColumn(tableName, 'ownership_mode');
    }
  }
}
