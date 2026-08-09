import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

export class AddProjectEngineTargetPolicyMode1700000000033 implements MigrationInterface {
  name = 'AddProjectEngineTargetPolicyMode1700000000033';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const settingsTable = tablePath(queryRunner, 'PlatformSettings', 'platform_settings');
    if (!(await queryRunner.hasTable(settingsTable))) return;

    if (!(await queryRunner.hasColumn(settingsTable, 'project_engine_target_mode'))) {
      await queryRunner.addColumn(
        settingsTable,
        new TableColumn({
          name: 'project_engine_target_mode',
          type: 'text',
          default: "'manual_allowed'",
        })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const settingsTable = tablePath(queryRunner, 'PlatformSettings', 'platform_settings');
    if (!(await queryRunner.hasTable(settingsTable))) return;

    if (await queryRunner.hasColumn(settingsTable, 'project_engine_target_mode')) {
      await queryRunner.dropColumn(settingsTable, 'project_engine_target_mode');
    }
  }
}
