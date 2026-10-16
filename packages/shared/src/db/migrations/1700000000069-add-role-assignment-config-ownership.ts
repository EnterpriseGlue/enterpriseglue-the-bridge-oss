import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { portableColumn } from './support/portable-columns.js';

function tablePath(queryRunner: QueryRunner): string {
  try {
    return queryRunner.connection.getMetadata('RbacRoleAssignment').tablePath;
  } catch {
    return 'role_assignments';
  }
}

/** Adds config ownership and provenance to scoped role assignments. */
export class AddRoleAssignmentConfigOwnership1700000000069 implements MigrationInterface {
  name = 'AddRoleAssignmentConfigOwnership1700000000069';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    if (!(await queryRunner.hasTable(tableName))) return;
    for (const [name, column] of [
      ['ownership_mode', portableColumn(queryRunner, { name: 'ownership_mode', type: 'text', default: "'manual'" })],
      ['source_hash', portableColumn(queryRunner, { name: 'source_hash', type: 'text', isNullable: true })],
      ['last_applied_at', portableColumn(queryRunner, { name: 'last_applied_at', type: 'bigint', isNullable: true })],
      ['drift_status', portableColumn(queryRunner, { name: 'drift_status', type: 'text', isNullable: true })],
    ] as Array<[string, TableColumn]>) if (!(await queryRunner.hasColumn(tableName, name))) await queryRunner.addColumn(tableName, column);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    if (!(await queryRunner.hasTable(tableName))) return;
    for (const name of ['drift_status', 'last_applied_at', 'source_hash', 'ownership_mode']) if (await queryRunner.hasColumn(tableName, name)) await queryRunner.dropColumn(tableName, name);
  }
}
