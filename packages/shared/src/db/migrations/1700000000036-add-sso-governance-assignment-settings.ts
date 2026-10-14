import { legacyBooleanColumn } from './support/portable-columns.js';
import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

export class AddSsoGovernanceAssignmentSettings1700000000036 implements MigrationInterface {
  name = 'AddSsoGovernanceAssignmentSettings1700000000036';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const settingsTable = tablePath(queryRunner, 'PlatformSettings', 'platform_settings');
    if (!(await queryRunner.hasTable(settingsTable))) return;

    const columns = [
      new TableColumn({
        name: 'sso_engine_owner_assignment_mappings_enabled',
        ...legacyBooleanColumn(queryRunner, false),
      }),
      new TableColumn({
        name: 'sso_engine_delegate_assignment_mappings_enabled',
        ...legacyBooleanColumn(queryRunner, false),
      }),
    ];

    for (const column of columns) {
      if (!(await queryRunner.hasColumn(settingsTable, column.name))) {
        await queryRunner.addColumn(settingsTable, column);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const settingsTable = tablePath(queryRunner, 'PlatformSettings', 'platform_settings');
    if (!(await queryRunner.hasTable(settingsTable))) return;

    for (const columnName of [
      'sso_engine_delegate_assignment_mappings_enabled',
      'sso_engine_owner_assignment_mappings_enabled',
    ]) {
      if (await queryRunner.hasColumn(settingsTable, columnName)) {
        await queryRunner.dropColumn(settingsTable, columnName);
      }
    }
  }
}
