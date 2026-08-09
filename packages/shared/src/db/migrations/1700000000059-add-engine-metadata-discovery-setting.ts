import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEngineMetadataDiscoverySetting1700000000059 implements MigrationInterface {
  name = 'AddEngineMetadataDiscoverySetting1700000000059';
  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('engines') && !(await queryRunner.hasColumn('engines', 'metadata_discovery_enabled'))) {
      await queryRunner.addColumn('engines', new TableColumn({ name: 'metadata_discovery_enabled', type: 'boolean', default: true }));
    }
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('engines') && await queryRunner.hasColumn('engines', 'metadata_discovery_enabled')) await queryRunner.dropColumn('engines', 'metadata_discovery_enabled');
  }
}
