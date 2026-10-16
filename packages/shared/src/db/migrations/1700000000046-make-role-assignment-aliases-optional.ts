import type { MigrationInterface, QueryRunner } from 'typeorm';
import { setExistingColumnNullability } from './support/portable-columns.js';

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
    await setExistingColumnNullability(queryRunner, tableName, 'user_id', true);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Deliberately non-destructive: canonical group and machine assignments do
    // not have a meaningful user_id value to restore.
  }
}
