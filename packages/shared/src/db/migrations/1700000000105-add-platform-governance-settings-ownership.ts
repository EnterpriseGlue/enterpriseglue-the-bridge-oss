import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addNullableColumnIfMissing,
  addRequiredColumnWithBackfill,
  portableBigint,
  portableStringDefault,
  portableText,
  sqlStringLiteral,
} from './support/portable-columns.js';

const columnNames = [
  'access_governance_source_ref',
  'access_governance_ownership_mode',
  'access_governance_source_hash',
  'access_governance_last_applied_at',
  'access_governance_drift_status',
] as const;

function tablePath(queryRunner: QueryRunner): string {
  try { return queryRunner.connection.getMetadata('PlatformSettings').tablePath; } catch { return 'platform_settings'; }
}

export class AddPlatformGovernanceSettingsOwnership1700000000105 implements MigrationInterface {
  name = 'AddPlatformGovernanceSettingsOwnership1700000000105';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    if (!await queryRunner.hasTable(tableName)) return;
    await addNullableColumnIfMissing(queryRunner, tableName, new TableColumn({
      name: 'access_governance_source_ref',
      ...portableText(queryRunner, 'document'),
      isNullable: true,
    }));
    await addRequiredColumnWithBackfill(
      queryRunner,
      tableName,
      new TableColumn({
        name: 'access_governance_ownership_mode',
        ...portableText(queryRunner, 'key'),
        default: portableStringDefault(queryRunner, 'manual'),
      }),
      sqlStringLiteral('manual'),
    );
    await addNullableColumnIfMissing(queryRunner, tableName, new TableColumn({
      name: 'access_governance_source_hash',
      ...portableText(queryRunner, 'document'),
      isNullable: true,
    }));
    await addNullableColumnIfMissing(queryRunner, tableName, new TableColumn({
      name: 'access_governance_last_applied_at',
      ...portableBigint(queryRunner),
      isNullable: true,
    }));
    await addNullableColumnIfMissing(queryRunner, tableName, new TableColumn({
      name: 'access_governance_drift_status',
      ...portableText(queryRunner, 'key'),
      isNullable: true,
    }));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    if (!await queryRunner.hasTable(tableName)) return;
    for (const columnName of [...columnNames].reverse()) {
      if (await queryRunner.hasColumn(tableName, columnName)) {
        await queryRunner.dropColumn(tableName, columnName);
      }
    }
  }
}
