import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

export class AddSsoRegexClaimMappingSetting1700000000040 implements MigrationInterface {
  name = 'AddSsoRegexClaimMappingSetting1700000000040';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const settingsTable = tablePath(queryRunner, 'PlatformSettings', 'platform_settings');
    if (!(await queryRunner.hasTable(settingsTable))) return;

    if (!(await queryRunner.hasColumn(settingsTable, 'sso_regex_claim_mappings_enabled'))) {
      await queryRunner.addColumn(settingsTable, new TableColumn({
        name: 'sso_regex_claim_mappings_enabled',
        type: 'boolean',
        default: false,
      }));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const settingsTable = tablePath(queryRunner, 'PlatformSettings', 'platform_settings');
    if (!(await queryRunner.hasTable(settingsTable))) return;

    if (await queryRunner.hasColumn(settingsTable, 'sso_regex_claim_mappings_enabled')) {
      await queryRunner.dropColumn(settingsTable, 'sso_regex_claim_mappings_enabled');
    }
  }
}
