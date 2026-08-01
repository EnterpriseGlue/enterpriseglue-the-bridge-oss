import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addNullableColumnIfMissing,
  addRequiredColumnWithBackfill,
  portableBoolean,
  portableBooleanDefault,
  portableInteger,
  portableNumberDefault,
  portableStringDefault,
  portableText,
  sqlBooleanLiteral,
  sqlIdentifier,
  sqlStringLiteral,
} from './support/portable-columns.js';

function tablePath(queryRunner: QueryRunner, entity: string, fallback: string): string {
  try { return queryRunner.connection.getMetadata(entity).tablePath; } catch { return fallback; }
}

export class AddLoginExperienceMetadata1700000000106 implements MigrationInterface {
  name = 'AddLoginExperienceMetadata1700000000106';

  async up(queryRunner: QueryRunner): Promise<void> {
    const providerTable = tablePath(queryRunner, 'IdentityProvider', 'identity_providers');
    if (await queryRunner.hasTable(providerTable)) {
      await addRequiredColumnWithBackfill(
        queryRunner,
        providerTable,
        new TableColumn({ name: 'display_name', ...portableText(queryRunner, 'document') }),
        sqlIdentifier(queryRunner, 'key'),
      );
      await addNullableColumnIfMissing(queryRunner, providerTable, new TableColumn({
        name: 'organization',
        ...portableText(queryRunner, 'document'),
        isNullable: true,
      }));
      await addRequiredColumnWithBackfill(
        queryRunner,
        providerTable,
        new TableColumn({
          name: 'display_order',
          ...portableInteger(queryRunner),
          default: portableNumberDefault(queryRunner, 0),
        }),
        '0',
      );
      await addRequiredColumnWithBackfill(
        queryRunner,
        providerTable,
        new TableColumn({
          name: 'is_preferred',
          ...portableBoolean(queryRunner),
          default: portableBooleanDefault(queryRunner, false),
        }),
        sqlBooleanLiteral(queryRunner, false),
      );
      await addRequiredColumnWithBackfill(
        queryRunner,
        providerTable,
        new TableColumn({
          name: 'login_domains_json',
          ...portableText(queryRunner, 'document'),
          default: portableStringDefault(queryRunner, '[]'),
        }),
        sqlStringLiteral('[]'),
      );
    }

    const settingsTable = tablePath(queryRunner, 'PlatformSettings', 'platform_settings');
    if (await queryRunner.hasTable(settingsTable)) {
      await addRequiredColumnWithBackfill(
        queryRunner,
        settingsTable,
        new TableColumn({
          name: 'local_password_login_mode',
          ...portableText(queryRunner, 'key'),
          default: portableStringDefault(queryRunner, 'auto'),
        }),
        sqlStringLiteral('auto'),
      );
      await addRequiredColumnWithBackfill(
        queryRunner,
        settingsTable,
        new TableColumn({
          name: 'sso_provider_selection_mode',
          ...portableText(queryRunner, 'key'),
          default: portableStringDefault(queryRunner, 'auto_redirect_single'),
        }),
        sqlStringLiteral('auto_redirect_single'),
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const settingsTable = tablePath(queryRunner, 'PlatformSettings', 'platform_settings');
    for (const column of ['sso_provider_selection_mode', 'local_password_login_mode']) {
      if (await queryRunner.hasColumn(settingsTable, column)) {
        await queryRunner.dropColumn(settingsTable, column);
      }
    }
    const providerTable = tablePath(queryRunner, 'IdentityProvider', 'identity_providers');
    for (const column of ['login_domains_json', 'is_preferred', 'display_order', 'organization', 'display_name']) {
      if (await queryRunner.hasColumn(providerTable, column)) {
        await queryRunner.dropColumn(providerTable, column);
      }
    }
  }
}
