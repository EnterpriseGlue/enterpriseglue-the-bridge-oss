import { Table, TableColumn, TableIndex, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addNullableColumnIfMissing,
  addRequiredColumnWithBackfill,
  portableBigint,
  portableBoolean,
  portableBooleanDefault,
  portableNumberDefault,
  portableStringDefault,
  portableText,
  sqlStringLiteral,
} from './support/portable-columns.js';

function entityTable(queryRunner: QueryRunner, entity: string, fallback: string): string {
  try { return queryRunner.connection.getMetadata(entity).tablePath; } catch { return fallback; }
}

/**
 * Adds durable, independently claimable settings sections and row-level
 * environment-tag provenance for the expanded headless administration API.
 */
export class AddHeadlessPlatformSettingsOwnership1700000000110 implements MigrationInterface {
  name = 'AddHeadlessPlatformSettingsOwnership1700000000110';

  async up(queryRunner: QueryRunner): Promise<void> {
    const ownershipTable = entityTable(
      queryRunner,
      'PlatformSettingsSectionOwnership',
      'platform_settings_section_ownership',
    );
    if (!await queryRunner.hasTable(ownershipTable)) {
      await queryRunner.createTable(new Table({
        name: ownershipTable,
        columns: [
          { name: 'id', ...portableText(queryRunner, 'key'), isPrimary: true },
          { name: 'settings_id', ...portableText(queryRunner, 'key'), isNullable: false, default: portableStringDefault(queryRunner, 'default') },
          { name: 'section', ...portableText(queryRunner, 'key'), isNullable: false },
          { name: 'scope_key', ...portableText(queryRunner, 'key'), isNullable: false, default: portableStringDefault(queryRunner, 'platform') },
          { name: 'source_ref', ...portableText(queryRunner), isNullable: true },
          { name: 'ownership_mode', ...portableText(queryRunner, 'key'), isNullable: false, default: portableStringDefault(queryRunner, 'manual') },
          { name: 'source_hash', ...portableText(queryRunner), isNullable: true },
          { name: 'last_applied_at', ...portableBigint(queryRunner), isNullable: true },
          { name: 'drift_status', ...portableText(queryRunner, 'key'), isNullable: true },
          { name: 'generation', ...portableBigint(queryRunner), isNullable: false, default: portableNumberDefault(queryRunner, 0) },
          { name: 'updated_at', ...portableBigint(queryRunner), isNullable: false },
        ],
        uniques: [new TableUnique({
          name: 'uq_platform_settings_section_ownership_scope',
          columnNames: ['settings_id', 'section'],
        })],
        indices: [new TableIndex({
          name: 'idx_platform_settings_section_ownership_source',
          columnNames: ['source_ref'],
        })],
      }), true);
    }

    const objectOwnershipTable = entityTable(
      queryRunner,
      'AdminConfigObjectOwnership',
      'admin_config_object_ownership',
    );
    if (!await queryRunner.hasTable(objectOwnershipTable)) {
      await queryRunner.createTable(new Table({
        name: objectOwnershipTable,
        columns: [
          { name: 'id', ...portableText(queryRunner, 'key'), isPrimary: true },
          { name: 'object_type', ...portableText(queryRunner, 'key'), isNullable: false },
          { name: 'object_id', ...portableText(queryRunner, 'key'), isNullable: false },
          { name: 'scope_key', ...portableText(queryRunner, 'key'), isNullable: false },
          { name: 'config_key', ...portableText(queryRunner, 'key'), isNullable: false },
          { name: 'key_identity', ...portableText(queryRunner, 'key'), isNullable: false },
          { name: 'source_ref', ...portableText(queryRunner), isNullable: false },
          { name: 'ownership_mode', ...portableText(queryRunner, 'key'), isNullable: false, default: portableStringDefault(queryRunner, 'config_locked') },
          { name: 'source_hash', ...portableText(queryRunner), isNullable: false },
          { name: 'secret_references_json', ...portableText(queryRunner), isNullable: true },
          { name: 'last_applied_at', ...portableBigint(queryRunner), isNullable: false },
          { name: 'drift_status', ...portableText(queryRunner, 'key'), isNullable: false, default: portableStringDefault(queryRunner, 'in_sync') },
          { name: 'active', ...portableBoolean(queryRunner), isNullable: false, default: portableBooleanDefault(queryRunner, true) },
          { name: 'generation', ...portableBigint(queryRunner), isNullable: false, default: portableNumberDefault(queryRunner, 0) },
          { name: 'updated_at', ...portableBigint(queryRunner), isNullable: false },
        ],
        uniques: [
          new TableUnique({
            name: 'uq_admin_config_object_ownership_object',
            columnNames: ['object_type', 'object_id'],
          }),
          new TableUnique({
            name: 'uq_admin_config_object_ownership_key_identity',
            columnNames: ['key_identity'],
          }),
        ],
        indices: [new TableIndex({
          name: 'idx_admin_config_object_ownership_source',
          columnNames: ['source_ref', 'object_type'],
        })],
      }), true);
    }

    const tagTable = entityTable(queryRunner, 'EnvironmentTag', 'environment_tags');
    if (!await queryRunner.hasTable(tagTable)) return;
    await addNullableColumnIfMissing(queryRunner, tagTable, new TableColumn({ name: 'config_key', ...portableText(queryRunner, 'key'), isNullable: true }));
    await addNullableColumnIfMissing(queryRunner, tagTable, new TableColumn({ name: 'source_ref', ...portableText(queryRunner), isNullable: true }));
    await addNullableColumnIfMissing(queryRunner, tagTable, new TableColumn({ name: 'config_scope_key', ...portableText(queryRunner, 'key'), isNullable: true }));
    await addNullableColumnIfMissing(queryRunner, tagTable, new TableColumn({ name: 'source_hash', ...portableText(queryRunner), isNullable: true }));
    await addNullableColumnIfMissing(queryRunner, tagTable, new TableColumn({ name: 'last_applied_at', ...portableBigint(queryRunner), isNullable: true }));
    await addNullableColumnIfMissing(queryRunner, tagTable, new TableColumn({ name: 'drift_status', ...portableText(queryRunner, 'key'), isNullable: true }));
    await addRequiredColumnWithBackfill(
      queryRunner,
      tagTable,
      new TableColumn({
        name: 'ownership_mode',
        ...portableText(queryRunner, 'key'),
        isNullable: false,
        default: portableStringDefault(queryRunner, 'manual'),
      }),
      sqlStringLiteral('manual'),
    );
    await addRequiredColumnWithBackfill(
      queryRunner,
      tagTable,
      new TableColumn({
        name: 'config_generation',
        ...portableBigint(queryRunner),
        isNullable: false,
        default: portableNumberDefault(queryRunner, 0),
      }),
      '0',
    );
    const tagMetadata = await queryRunner.getTable(tagTable);
    if (tagMetadata && ![...tagMetadata.indices, ...tagMetadata.uniques].some((candidate) => candidate.name === 'uq_environment_tags_config_key')) {
      await queryRunner.createIndex(tagTable, new TableIndex({
        name: 'uq_environment_tags_config_key',
        columnNames: ['config_key'],
        isUnique: true,
      }));
    }
    const tagWithKeyIndex = await queryRunner.getTable(tagTable);
    if (tagWithKeyIndex && !tagWithKeyIndex.indices.some((candidate) => candidate.name === 'idx_environment_tags_source')) {
      await queryRunner.createIndex(tagTable, new TableIndex({
        name: 'idx_environment_tags_source',
        columnNames: ['source_ref'],
      }));
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tagTable = entityTable(queryRunner, 'EnvironmentTag', 'environment_tags');
    if (await queryRunner.hasTable(tagTable)) {
      const table = await queryRunner.getTable(tagTable);
      const configKeyIndex = table?.indices.find((index) => index.name === 'uq_environment_tags_config_key');
      if (configKeyIndex) await queryRunner.dropIndex(tagTable, configKeyIndex);
      const sourceIndex = table?.indices.find((index) => index.name === 'idx_environment_tags_source');
      if (sourceIndex) await queryRunner.dropIndex(tagTable, sourceIndex);
      for (const column of ['config_generation', 'drift_status', 'last_applied_at', 'source_hash', 'ownership_mode', 'config_scope_key', 'source_ref', 'config_key']) {
        if (await queryRunner.hasColumn(tagTable, column)) await queryRunner.dropColumn(tagTable, column);
      }
    }
    const ownershipTable = entityTable(queryRunner, 'PlatformSettingsSectionOwnership', 'platform_settings_section_ownership');
    if (await queryRunner.hasTable(ownershipTable)) await queryRunner.dropTable(ownershipTable);
    const objectOwnershipTable = entityTable(queryRunner, 'AdminConfigObjectOwnership', 'admin_config_object_ownership');
    if (await queryRunner.hasTable(objectOwnershipTable)) await queryRunner.dropTable(objectOwnershipTable);
  }
}
