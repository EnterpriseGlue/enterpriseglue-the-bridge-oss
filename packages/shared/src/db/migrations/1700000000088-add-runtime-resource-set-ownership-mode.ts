import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRuntimeResourceSetOwnershipMode1700000000088 implements MigrationInterface {
  name = 'AddRuntimeResourceSetOwnershipMode1700000000088';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!await queryRunner.hasTable('runtime_resource_sets')) return;
    if (!await queryRunner.hasColumn('runtime_resource_sets', 'ownership_mode')) {
      await queryRunner.addColumn('runtime_resource_sets', new TableColumn({ name: 'ownership_mode', type: 'text', default: "'manual'" }));
    }
    await queryRunner.query("UPDATE runtime_resource_sets SET ownership_mode = 'config_locked' WHERE source = 'config' AND (ownership_mode IS NULL OR ownership_mode = 'manual')");
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('runtime_resource_sets') && await queryRunner.hasColumn('runtime_resource_sets', 'ownership_mode')) {
      await queryRunner.dropColumn('runtime_resource_sets', 'ownership_mode');
    }
  }
}
