import { TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

import { pluginMigrationTable } from './plugin-migration-schema.js';

export class AddPluginStorage1700000000018 implements MigrationInterface {
  name = 'AddPluginStorage1700000000018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tablePath =
      queryRunner.connection.getMetadata('PluginStorageEntry').tablePath;
    if (await queryRunner.hasTable(tablePath)) return;

    await queryRunner.createTable(
      pluginMigrationTable(queryRunner, {
        name: tablePath,
        columns: [
          { name: 'id', type: 'text', isPrimary: true },
          { name: 'plugin_id', type: 'text' },
          { name: 'deployment_ref', type: 'text' },
          { name: 'scope', type: 'text' },
          { name: 'tenant_ref_key', type: 'text' },
          { name: 'storage_key', type: 'text' },
          { name: 'value_json', type: 'text' },
          { name: 'value_bytes', type: 'bigint' },
          { name: 'revision', type: 'bigint', default: 1 },
          { name: 'created_at', type: 'bigint' },
          { name: 'updated_at', type: 'bigint' },
        ],
        indices: [
          new TableIndex({
            name: 'idx_plugin_storage_identity',
            columnNames: [
              'plugin_id',
              'deployment_ref',
              'scope',
              'tenant_ref_key',
              'storage_key',
            ],
            isUnique: true,
          }),
          new TableIndex({
            name: 'idx_plugin_storage_namespace',
            columnNames: [
              'plugin_id',
              'deployment_ref',
              'scope',
              'tenant_ref_key',
            ],
          }),
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tablePath =
      queryRunner.connection.getMetadata('PluginStorageEntry').tablePath;
    if (await queryRunner.hasTable(tablePath)) {
      await queryRunner.dropTable(tablePath);
    }
  }
}
