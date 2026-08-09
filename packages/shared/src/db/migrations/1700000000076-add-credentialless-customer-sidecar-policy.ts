import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCredentiallessCustomerSidecarPolicy1700000000076 implements MigrationInterface {
  name = 'AddCredentiallessCustomerSidecarPolicy1700000000076';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('platform_settings') && !(await queryRunner.hasColumn('platform_settings', 'credentialless_customer_sidecars_enabled'))) {
      await queryRunner.addColumn('platform_settings', new TableColumn({
        name: 'credentialless_customer_sidecars_enabled',
        type: 'boolean',
        default: false,
      }));
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('platform_settings') && await queryRunner.hasColumn('platform_settings', 'credentialless_customer_sidecars_enabled')) {
      await queryRunner.dropColumn('platform_settings', 'credentialless_customer_sidecars_enabled');
    }
  }
}
