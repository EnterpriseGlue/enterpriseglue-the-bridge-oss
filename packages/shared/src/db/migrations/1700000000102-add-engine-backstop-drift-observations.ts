import { TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function text(queryRunner: QueryRunner): { type: string; length?: string } {
  const database = queryRunner.connection?.options?.type || 'postgres';
  if (database === 'mysql') return { type: 'varchar', length: '191' };
  if (database === 'mssql') return { type: 'nvarchar', length: '191' };
  if (database === 'oracle') return { type: 'varchar2', length: '191' };
  if (database === 'spanner') return { type: 'string', length: '191' };
  return { type: 'text' };
}

/** Adds an auditable link from a read-only drift observation to its apply receipt. */
export class AddEngineBackstopDriftObservations1700000000102 implements MigrationInterface {
  name = 'AddEngineBackstopDriftObservations1700000000102';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('engine_backstop_sync_runs');
    if (!table) return;
    if (!table.columns.some((column) => column.name === 'observed_of_run_id')) {
      await queryRunner.addColumn('engine_backstop_sync_runs', new TableColumn({ name: 'observed_of_run_id', ...text(queryRunner), isNullable: true }));
    }
    const refreshed = await queryRunner.getTable('engine_backstop_sync_runs');
    if (refreshed && !refreshed.indices.some((index) => index.name === 'idx_engine_backstop_sync_run_observed_source')) {
      await queryRunner.createIndex('engine_backstop_sync_runs', new TableIndex({ name: 'idx_engine_backstop_sync_run_observed_source', columnNames: ['observed_of_run_id'] }));
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('engine_backstop_sync_runs');
    if (!table) return;
    const index = table.indices.find((candidate) => candidate.name === 'idx_engine_backstop_sync_run_observed_source');
    if (index) await queryRunner.dropIndex('engine_backstop_sync_runs', index);
    const refreshed = await queryRunner.getTable('engine_backstop_sync_runs');
    if (refreshed?.columns.some((column) => column.name === 'observed_of_run_id')) {
      await queryRunner.dropColumn('engine_backstop_sync_runs', 'observed_of_run_id');
    }
  }
}
