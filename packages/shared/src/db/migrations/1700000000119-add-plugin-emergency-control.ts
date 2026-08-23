import { TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

import {
  addPluginMigrationColumn,
  pluginMigrationColumn,
  pluginMigrationTable,
} from './plugin-migration-schema.js';

export class AddPluginEmergencyControl1700000000119
implements MigrationInterface {
  name = 'AddPluginEmergencyControl1700000000119';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const statePath =
      queryRunner.connection.getMetadata('PluginPlatformState').tablePath;
    for (const { column, postgresDefinition } of [
      {
        column: pluginMigrationColumn(queryRunner, {
          name: 'emergency_disabled',
          type: 'boolean',
          default: false,
        }),
        postgresDefinition: 'boolean NOT NULL DEFAULT false',
      },
      {
        column: pluginMigrationColumn(queryRunner, {
          name: 'emergency_revision',
          type: 'bigint',
          default: 0,
        }),
        postgresDefinition: 'bigint NOT NULL DEFAULT 0',
      },
      {
        column: pluginMigrationColumn(queryRunner, {
          name: 'emergency_updated_at',
          type: 'bigint',
          isNullable: true,
        }),
        postgresDefinition: 'bigint',
      },
    ]) {
      if (!(await queryRunner.hasColumn(statePath, column.name))) {
        if (queryRunner.connection.options.type === 'postgres') {
          await queryRunner.query(
            `ALTER TABLE ${this.postgresStateTablePath(
              queryRunner,
            )} ADD COLUMN ${queryRunner.connection.driver.escape(
              column.name,
            )} ${postgresDefinition}`,
          );
        } else {
          await addPluginMigrationColumn(
            queryRunner,
            statePath,
            column,
          );
        }
      }
    }

    const operationPath = queryRunner.connection.getMetadata(
      'PluginEmergencyControlOperation',
    ).tablePath;
    if (!(await queryRunner.hasTable(operationPath))) {
      await queryRunner.createTable(
        pluginMigrationTable(queryRunner, {
          name: operationPath,
          columns: [
            { name: 'id', type: 'text', isPrimary: true },
            { name: 'idempotency_key_hash', type: 'text' },
            { name: 'request_hash', type: 'text' },
            { name: 'disabled', type: 'boolean' },
            { name: 'revision', type: 'bigint' },
            { name: 'actor_ref', type: 'text' },
            { name: 'correlation_id', type: 'text' },
            { name: 'created_at', type: 'bigint' },
          ],
          indices: [
            new TableIndex({
              name: 'idx_plugin_emergency_operation_idempotency',
              columnNames: ['idempotency_key_hash'],
              isUnique: true,
            }),
          ],
        }),
        true,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const operationPath = queryRunner.connection.getMetadata(
      'PluginEmergencyControlOperation',
    ).tablePath;
    if (await queryRunner.hasTable(operationPath)) {
      await queryRunner.dropTable(operationPath);
    }

    const statePath =
      queryRunner.connection.getMetadata('PluginPlatformState').tablePath;
    for (const column of [
      'emergency_updated_at',
      'emergency_revision',
      'emergency_disabled',
    ]) {
      if (await queryRunner.hasColumn(statePath, column)) {
        if (queryRunner.connection.options.type === 'postgres') {
          await queryRunner.query(
            `ALTER TABLE ${this.postgresStateTablePath(
              queryRunner,
            )} DROP COLUMN ${queryRunner.connection.driver.escape(column)}`,
          );
        } else {
          await queryRunner.dropColumn(statePath, column);
        }
      }
    }
  }

  private postgresStateTablePath(queryRunner: QueryRunner): string {
    const metadata =
      queryRunner.connection.getMetadata('PluginPlatformState');
    const escape = (value: string) =>
      queryRunner.connection.driver.escape(value);
    return metadata.schema
      ? `${escape(metadata.schema)}.${escape(metadata.tableName)}`
      : escape(metadata.tableName);
  }
}
