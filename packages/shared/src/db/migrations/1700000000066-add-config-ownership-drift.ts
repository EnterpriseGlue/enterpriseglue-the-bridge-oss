import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

function escapeTablePath(queryRunner: QueryRunner, table: string): string {
  return table.split('.').map((part) => queryRunner.connection.driver.escape(part)).join('.');
}

async function addOwnershipColumns(queryRunner: QueryRunner, tableName: string): Promise<void> {
  if (!(await queryRunner.hasTable(tableName))) return;
  const columns: Array<[string, TableColumn]> = [
    ['ownership_mode', new TableColumn({ name: 'ownership_mode', type: 'text', default: "'manual'" })],
    ['source_hash', new TableColumn({ name: 'source_hash', type: 'text', isNullable: true })],
    ['last_applied_at', new TableColumn({ name: 'last_applied_at', type: 'bigint', isNullable: true })],
    ['drift_status', new TableColumn({ name: 'drift_status', type: 'text', isNullable: true })],
  ];
  for (const [name, column] of columns) {
    if (!(await queryRunner.hasColumn(tableName, name))) await queryRunner.addColumn(tableName, column);
  }

  if (!(await queryRunner.hasColumn(tableName, 'source'))) return;

  const escaped = escapeTablePath(queryRunner, tableName);
  const source = queryRunner.connection.driver.escape('source');
  const ownership = queryRunner.connection.driver.escape('ownership_mode');
  const drift = queryRunner.connection.driver.escape('drift_status');
  await queryRunner.query(`UPDATE ${escaped} SET ${ownership} = 'config_locked', ${drift} = 'in_sync' WHERE ${source} = 'config'`);
}

/** Adds config ownership and local-drift diagnostics to roles and groups. */
export class AddConfigOwnershipDrift1700000000066 implements MigrationInterface {
  name = 'AddConfigOwnershipDrift1700000000066';

  async up(queryRunner: QueryRunner): Promise<void> {
    await addOwnershipColumns(queryRunner, tablePath(queryRunner, 'RbacRole', 'roles'));
    await addOwnershipColumns(queryRunner, tablePath(queryRunner, 'AuthzGroup', 'authz_groups'));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const tableName of [
      tablePath(queryRunner, 'AuthzGroup', 'authz_groups'),
      tablePath(queryRunner, 'RbacRole', 'roles'),
    ]) {
      if (!(await queryRunner.hasTable(tableName))) continue;
      for (const column of ['drift_status', 'last_applied_at', 'source_hash', 'ownership_mode']) {
        if (await queryRunner.hasColumn(tableName, column)) await queryRunner.dropColumn(tableName, column);
      }
    }
  }
}
