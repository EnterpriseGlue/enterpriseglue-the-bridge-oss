import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

export class MakeRoleAssignmentAliasesOptional1700000000046 implements MigrationInterface {
  name = 'MakeRoleAssignmentAliasesOptional1700000000046';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner, 'RbacRoleAssignment', 'role_assignments');
    const table = await queryRunner.getTable(tableName);
    const userId = table?.columns.find((column) => column.name === 'user_id');
    if (userId && !userId.isNullable) {
      await queryRunner.changeColumn(tableName, 'user_id', new TableColumn({
        name: 'user_id',
        type: 'text',
        isNullable: true,
      }));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Deliberately non-destructive: canonical group and machine assignments do
    // not have a meaningful user_id value to restore.
  }
}
