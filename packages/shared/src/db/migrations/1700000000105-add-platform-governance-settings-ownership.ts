import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

const columns = [
  new TableColumn({ name: 'access_governance_source_ref', type: 'text', isNullable: true }),
  new TableColumn({ name: 'access_governance_ownership_mode', type: 'text', default: "'manual'" }),
  new TableColumn({ name: 'access_governance_source_hash', type: 'text', isNullable: true }),
  new TableColumn({ name: 'access_governance_last_applied_at', type: 'bigint', isNullable: true }),
  new TableColumn({ name: 'access_governance_drift_status', type: 'text', isNullable: true }),
];

export class AddPlatformGovernanceSettingsOwnership1700000000105 implements MigrationInterface {
  name = 'AddPlatformGovernanceSettingsOwnership1700000000105';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!await queryRunner.hasTable('platform_settings')) return;
    for (const column of columns) {
      if (!await queryRunner.hasColumn('platform_settings', column.name)) {
        await queryRunner.addColumn('platform_settings', column);
      }
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!await queryRunner.hasTable('platform_settings')) return;
    for (const column of [...columns].reverse()) {
      if (await queryRunner.hasColumn('platform_settings', column.name)) {
        await queryRunner.dropColumn('platform_settings', column.name);
      }
    }
  }
}

