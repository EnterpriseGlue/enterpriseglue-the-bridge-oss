import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

const columns = [
  'sso_secret_view_mappings_enabled',
  'sso_unredacted_audit_mappings_enabled',
  'sso_permanent_delete_mappings_enabled',
];

export class AddSsoSensitivePermissionMappingSettings1700000000041 implements MigrationInterface {
  name = 'AddSsoSensitivePermissionMappingSettings1700000000041';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const settingsTable = tablePath(queryRunner, 'PlatformSettings', 'platform_settings');
    if (!(await queryRunner.hasTable(settingsTable))) return;

    for (const column of columns) {
      if (await queryRunner.hasColumn(settingsTable, column)) continue;
      await queryRunner.addColumn(settingsTable, new TableColumn({
        name: column,
        type: 'boolean',
        default: false,
      }));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const settingsTable = tablePath(queryRunner, 'PlatformSettings', 'platform_settings');
    if (!(await queryRunner.hasTable(settingsTable))) return;

    for (const column of [...columns].reverse()) {
      if (await queryRunner.hasColumn(settingsTable, column)) {
        await queryRunner.dropColumn(settingsTable, column);
      }
    }
  }
}
