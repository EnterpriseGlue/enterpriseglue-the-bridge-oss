import type { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

import {
  addPluginMigrationColumn,
  pluginMigrationColumn,
} from './plugin-migration-schema.js';

export class AddPluginEventCircuit1700000000121
implements MigrationInterface {
  name = 'AddPluginEventCircuit1700000000121';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tablePath = queryRunner.connection.getMetadata(
      'PluginEventSubscriptionState',
    ).tablePath;
    if (!(await queryRunner.hasTable(tablePath))) {
      throw new Error('plugin_event_subscription_state_missing');
    }
    const columns: Array<{
      column: TableColumn;
      postgresDefinition: string;
    }> = [
      {
        column: pluginMigrationColumn(queryRunner, {
          name: 'circuit_state',
          type: 'text',
          default: "'closed'",
        }),
        postgresDefinition: "text NOT NULL DEFAULT 'closed'",
      },
      {
        column: pluginMigrationColumn(queryRunner, {
          name: 'consecutive_failures',
          type: 'integer',
          default: 0,
        }),
        postgresDefinition: 'integer NOT NULL DEFAULT 0',
      },
      {
        column: pluginMigrationColumn(queryRunner, {
          name: 'circuit_open_until',
          type: 'bigint',
          isNullable: true,
        }),
        postgresDefinition: 'bigint',
      },
      {
        column: pluginMigrationColumn(queryRunner, {
          name: 'probe_delivery_id',
          type: 'text',
          isNullable: true,
        }),
        postgresDefinition: 'text',
      },
      {
        column: pluginMigrationColumn(queryRunner, {
          name: 'circuit_reason_code',
          type: 'text',
          default: "'none'",
        }),
        postgresDefinition: "text NOT NULL DEFAULT 'none'",
      },
    ];
    for (const { column, postgresDefinition } of columns) {
      if (!(await queryRunner.hasColumn(tablePath, column.name))) {
        if (queryRunner.connection.options.type === 'postgres') {
          await queryRunner.query(
            `ALTER TABLE ${this.postgresTablePath(
              queryRunner,
            )} ADD COLUMN ${queryRunner.connection.driver.escape(
              column.name,
            )} ${postgresDefinition}`,
          );
        } else {
          await addPluginMigrationColumn(
            queryRunner,
            tablePath,
            column,
          );
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tablePath = queryRunner.connection.getMetadata(
      'PluginEventSubscriptionState',
    ).tablePath;
    if (!(await queryRunner.hasTable(tablePath))) return;
    for (const column of [
      'circuit_reason_code',
      'probe_delivery_id',
      'circuit_open_until',
      'consecutive_failures',
      'circuit_state',
    ]) {
      if (await queryRunner.hasColumn(tablePath, column)) {
        if (queryRunner.connection.options.type === 'postgres') {
          await queryRunner.query(
            `ALTER TABLE ${this.postgresTablePath(
              queryRunner,
            )} DROP COLUMN ${queryRunner.connection.driver.escape(column)}`,
          );
        } else {
          await queryRunner.dropColumn(tablePath, column);
        }
      }
    }
  }

  private postgresTablePath(queryRunner: QueryRunner): string {
    const metadata = queryRunner.connection.getMetadata(
      'PluginEventSubscriptionState',
    );
    const escape = (value: string) =>
      queryRunner.connection.driver.escape(value);
    return metadata.schema
      ? `${escape(metadata.schema)}.${escape(metadata.tableName)}`
      : escape(metadata.tableName);
  }
}
