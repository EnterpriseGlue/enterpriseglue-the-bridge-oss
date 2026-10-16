import type { MigrationInterface, QueryRunner } from 'typeorm';
import { portableColumn } from './support/portable-columns.js';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

export class AddEngineRuntimeAuthorizationMode1700000000044 implements MigrationInterface {
  name = 'AddEngineRuntimeAuthorizationMode1700000000044';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const settingsTable = tablePath(queryRunner, 'PlatformSettings', 'platform_settings');
    if (!(await queryRunner.hasTable(settingsTable)) || await queryRunner.hasColumn(settingsTable, 'engine_runtime_authorization_mode')) {
      return;
    }
    await queryRunner.addColumn(settingsTable, portableColumn(queryRunner, {
      name: 'engine_runtime_authorization_mode',
      type: 'text',
      default: "'enterpriseglue_authoritative'",
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const settingsTable = tablePath(queryRunner, 'PlatformSettings', 'platform_settings');
    if (await queryRunner.hasTable(settingsTable) && await queryRunner.hasColumn(settingsTable, 'engine_runtime_authorization_mode')) {
      await queryRunner.dropColumn(settingsTable, 'engine_runtime_authorization_mode');
    }
  }
}
