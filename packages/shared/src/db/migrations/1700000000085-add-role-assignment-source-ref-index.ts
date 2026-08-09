import { TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner): string {
  try {
    return queryRunner.connection.getMetadata('RbacRoleAssignment').tablePath;
  } catch {
    return 'role_assignments';
  }
}

/**
 * New assignment writers use source_ref as their canonical managed lineage.
 * Keep the source-mapping alias index for historical rows, but add the
 * canonical lookup index before aliases are cleared in a later migration.
 */
export class AddRoleAssignmentSourceRefIndex1700000000085 implements MigrationInterface {
  name = 'AddRoleAssignmentSourceRefIndex1700000000085';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    const table = await queryRunner.getTable(tableName);
    if (!table || table.indices.some((index) => index.name === 'idx_role_assignments_source_ref')) return;
    await queryRunner.createIndex(tableName, new TableIndex({
      name: 'idx_role_assignments_source_ref',
      columnNames: ['source', 'source_ref'],
    }));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    const table = await queryRunner.getTable(tableName);
    const index = table?.indices.find((candidate) => candidate.name === 'idx_role_assignments_source_ref');
    if (index) await queryRunner.dropIndex(tableName, index);
  }
}
