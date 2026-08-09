import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner): string {
  try {
    return queryRunner.connection.getMetadata('ProjectEngineTarget').tablePath;
  } catch {
    return 'project_engine_targets';
  }
}

function escapeTablePath(queryRunner: QueryRunner, table: string): string {
  return table.split('.').map((part) => queryRunner.connection.driver.escape(part)).join('.');
}

/** Adds config ownership and drift lineage to project-engine targets. */
export class AddProjectEngineTargetConfigOwnership1700000000068 implements MigrationInterface {
  name = 'AddProjectEngineTargetConfigOwnership1700000000068';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    if (!(await queryRunner.hasTable(tableName))) return;
    const columns: Array<[string, TableColumn]> = [
      ['ownership_mode', new TableColumn({ name: 'ownership_mode', type: 'text', default: "'manual'" })],
      ['source_hash', new TableColumn({ name: 'source_hash', type: 'text', isNullable: true })],
      ['last_applied_at', new TableColumn({ name: 'last_applied_at', type: 'bigint', isNullable: true })],
      ['drift_status', new TableColumn({ name: 'drift_status', type: 'text', isNullable: true })],
    ];
    for (const [name, column] of columns) if (!(await queryRunner.hasColumn(tableName, name))) await queryRunner.addColumn(tableName, column);
    if (await queryRunner.hasColumn(tableName, 'source')) {
      const escaped = escapeTablePath(queryRunner, tableName);
      const source = queryRunner.connection.driver.escape('source');
      const ownership = queryRunner.connection.driver.escape('ownership_mode');
      const drift = queryRunner.connection.driver.escape('drift_status');
      await queryRunner.query(`UPDATE ${escaped} SET ${ownership} = 'config_locked', ${drift} = 'in_sync' WHERE ${source} = 'config'`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    if (!(await queryRunner.hasTable(tableName))) return;
    for (const column of ['drift_status', 'last_applied_at', 'source_hash', 'ownership_mode']) {
      if (await queryRunner.hasColumn(tableName, column)) await queryRunner.dropColumn(tableName, column);
    }
  }
}
