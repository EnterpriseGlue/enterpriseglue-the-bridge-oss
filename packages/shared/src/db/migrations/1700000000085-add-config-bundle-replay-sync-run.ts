import { TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConfigBundleReplaySyncRun1700000000085 implements MigrationInterface {
  name = 'AddConfigBundleReplaySyncRun1700000000085';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!await queryRunner.hasTable('config_bundle_identity_replay_tasks')) return;
    const table = await queryRunner.getTable('config_bundle_identity_replay_tasks');
    if (!table?.findColumnByName('sync_run_id')) {
      await queryRunner.addColumn('config_bundle_identity_replay_tasks', new TableColumn({ name: 'sync_run_id', type: 'text', isNullable: true }));
    }
    const refreshed = await queryRunner.getTable('config_bundle_identity_replay_tasks');
    if (!refreshed?.indices.some((index) => index.name === 'idx_config_bundle_identity_replay_task_sync_run')) {
      await queryRunner.createIndex('config_bundle_identity_replay_tasks', new TableIndex({ name: 'idx_config_bundle_identity_replay_task_sync_run', columnNames: ['sync_run_id'] }));
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!await queryRunner.hasTable('config_bundle_identity_replay_tasks')) return;
    const table = await queryRunner.getTable('config_bundle_identity_replay_tasks');
    if (table?.indices.some((index) => index.name === 'idx_config_bundle_identity_replay_task_sync_run')) {
      await queryRunner.dropIndex('config_bundle_identity_replay_tasks', 'idx_config_bundle_identity_replay_task_sync_run');
    }
    if (table?.findColumnByName('sync_run_id')) await queryRunner.dropColumn('config_bundle_identity_replay_tasks', 'sync_run_id');
  }
}
