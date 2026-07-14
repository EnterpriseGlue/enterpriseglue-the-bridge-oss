import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEngineDeploymentDiscoverySetting1700000000075 implements MigrationInterface {
  name = 'AddEngineDeploymentDiscoverySetting1700000000075';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('engines') && !(await queryRunner.hasColumn('engines', 'deployment_discovery_enabled'))) {
      await queryRunner.addColumn('engines', new TableColumn({ name: 'deployment_discovery_enabled', type: 'boolean', default: true }));
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('engines') && await queryRunner.hasColumn('engines', 'deployment_discovery_enabled')) {
      await queryRunner.dropColumn('engines', 'deployment_discovery_enabled');
    }
  }
}
