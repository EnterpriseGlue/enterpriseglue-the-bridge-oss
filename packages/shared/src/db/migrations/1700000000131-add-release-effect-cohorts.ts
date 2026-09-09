import { TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

import { pluginMigrationTable } from './plugin-migration-schema.js';

export class AddReleaseEffectCohorts1700000000131 implements MigrationInterface {
  name = 'AddReleaseEffectCohorts1700000000131';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tablePath = queryRunner.connection.getMetadata('ReleaseEffectCohort').tablePath;
    if (await queryRunner.hasTable(tablePath)) return;
    await queryRunner.createTable(pluginMigrationTable(queryRunner, {
      name: tablePath,
      columns: [
        { name: 'id', type: 'text', isPrimary: true },
        { name: 'release_id', type: 'text' },
        { name: 'cohort_epoch', type: 'bigint' },
        { name: 'state', type: 'text' },
        { name: 'revision', type: 'bigint', default: 1 },
        { name: 'inventory_version', type: 'text' },
        { name: 'inventory_sha256', type: 'text' },
        { name: 'opened_at', type: 'bigint' },
        { name: 'closed_at', type: 'bigint', isNullable: true },
        { name: 'settled_at', type: 'bigint', isNullable: true },
        { name: 'updated_at', type: 'bigint' },
      ],
      indices: [new TableIndex({
        name: 'idx_release_effect_cohort_identity',
        columnNames: ['release_id'],
        isUnique: true,
      })],
    }), true);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tablePath = queryRunner.connection.getMetadata('ReleaseEffectCohort').tablePath;
    if (await queryRunner.hasTable(tablePath)) await queryRunner.dropTable(tablePath);
  }
}
