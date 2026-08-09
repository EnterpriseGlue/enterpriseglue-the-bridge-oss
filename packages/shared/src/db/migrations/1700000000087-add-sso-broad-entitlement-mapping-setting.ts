import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSsoBroadEntitlementMappingSetting1700000000087 implements MigrationInterface {
  name = 'AddSsoBroadEntitlementMappingSetting1700000000087';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('platform_settings') && !(await queryRunner.hasColumn('platform_settings', 'sso_broad_entitlement_mappings_enabled'))) {
      await queryRunner.addColumn('platform_settings', new TableColumn({ name: 'sso_broad_entitlement_mappings_enabled', type: 'boolean', default: false }));
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('platform_settings') && await queryRunner.hasColumn('platform_settings', 'sso_broad_entitlement_mappings_enabled')) {
      await queryRunner.dropColumn('platform_settings', 'sso_broad_entitlement_mappings_enabled');
    }
  }
}
