import { TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

import { pluginMigrationTable } from './plugin-migration-schema.js';

export class AddPluginBrokerReplay1700000000017
  implements MigrationInterface
{
  name = 'AddPluginBrokerReplay1700000000017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tablePath =
      queryRunner.connection.getMetadata('PluginBrokerReplay').tablePath;
    if (await queryRunner.hasTable(tablePath)) return;

    await queryRunner.createTable(
      pluginMigrationTable(queryRunner, {
        name: tablePath,
        columns: [
          { name: 'id', type: 'text', isPrimary: true },
          { name: 'key_hash', type: 'text' },
          { name: 'plugin_id', type: 'text' },
          { name: 'invocation_hash', type: 'text' },
          { name: 'call_id_hash', type: 'text' },
          { name: 'expires_at', type: 'bigint' },
          { name: 'created_at', type: 'bigint' },
        ],
        indices: [
          new TableIndex({
            name: 'idx_plugin_broker_replay_key',
            columnNames: ['key_hash'],
            isUnique: true,
          }),
          new TableIndex({
            name: 'idx_plugin_broker_replay_expiry',
            columnNames: ['expires_at'],
          }),
          new TableIndex({
            name: 'idx_plugin_broker_replay_plugin',
            columnNames: ['plugin_id'],
          }),
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tablePath =
      queryRunner.connection.getMetadata('PluginBrokerReplay').tablePath;
    if (await queryRunner.hasTable(tablePath)) {
      await queryRunner.dropTable(tablePath);
    }
  }
}
