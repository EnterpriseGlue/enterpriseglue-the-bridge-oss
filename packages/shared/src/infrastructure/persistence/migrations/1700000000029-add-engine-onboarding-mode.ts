import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

export class AddEngineOnboardingMode1700000000029 implements MigrationInterface {
  name = 'AddEngineOnboardingMode1700000000029';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const settingsTable = tablePath(queryRunner, 'PlatformSettings', 'platform_settings');
    if (!(await queryRunner.hasTable(settingsTable))) return;

    if (!(await queryRunner.hasColumn(settingsTable, 'engine_onboarding_mode'))) {
      await queryRunner.addColumn(
        settingsTable,
        new TableColumn({
          name: 'engine_onboarding_mode',
          type: 'text',
          default: "'manual_allowed'",
        })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const settingsTable = tablePath(queryRunner, 'PlatformSettings', 'platform_settings');
    if (!(await queryRunner.hasTable(settingsTable))) return;

    if (await queryRunner.hasColumn(settingsTable, 'engine_onboarding_mode')) {
      await queryRunner.dropColumn(settingsTable, 'engine_onboarding_mode');
    }
  }
}
