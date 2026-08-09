import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConfigBundleApiVersion1700000000071 implements MigrationInterface {
  name = 'AddConfigBundleApiVersion1700000000071';
  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('config_bundle_apply_runs') && !await queryRunner.hasColumn('config_bundle_apply_runs', 'bundle_api_version')) {
      await queryRunner.addColumn('config_bundle_apply_runs', new TableColumn({ name: 'bundle_api_version', type: 'text', isNullable: true }));
    }
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('config_bundle_apply_runs') && await queryRunner.hasColumn('config_bundle_apply_runs', 'bundle_api_version')) await queryRunner.dropColumn('config_bundle_apply_runs', 'bundle_api_version');
  }
}
