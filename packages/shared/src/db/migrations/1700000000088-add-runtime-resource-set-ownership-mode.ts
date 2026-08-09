import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner): string {
  try { return queryRunner.connection.getMetadata('RuntimeResourceSet').tablePath; } catch { return 'runtime_resource_sets'; }
}

export class AddRuntimeResourceSetOwnershipMode1700000000088 implements MigrationInterface {
  name = 'AddRuntimeResourceSetOwnershipMode1700000000088';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    if (!await queryRunner.hasTable(tableName)) return;
    if (!await queryRunner.hasColumn(tableName, 'ownership_mode')) {
      await queryRunner.addColumn(tableName, new TableColumn({ name: 'ownership_mode', type: 'text', default: "'manual'" }));
    }
    await queryRunner.query(`UPDATE ${tableName} SET ownership_mode = 'config_locked' WHERE source = 'config' AND (ownership_mode IS NULL OR ownership_mode = 'manual')`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    if (await queryRunner.hasTable(tableName) && await queryRunner.hasColumn(tableName, 'ownership_mode')) {
      await queryRunner.dropColumn(tableName, 'ownership_mode');
    }
  }
}
