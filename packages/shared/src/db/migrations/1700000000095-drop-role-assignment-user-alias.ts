import type { MigrationInterface, QueryRunner } from 'typeorm';

/** principal_type and principal_id are the sole persisted assignment identity fields. */
export class DropRoleAssignmentUserAlias1700000000095 implements MigrationInterface {
  name = 'DropRoleAssignmentUserAlias1700000000095';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('role_assignments'))) return;
    const table = await queryRunner.getTable('role_assignments');
    if (!table) return;
    const legacyIndex = table.indices.find((index) => index.name === 'idx_role_assignments_user');
    if (legacyIndex) await queryRunner.dropIndex(table, legacyIndex);
    if (table.columns.some((column) => column.name === 'user_id')) {
      await queryRunner.dropColumn(table, 'user_id');
    }
  }

  async down(): Promise<void> {
    // Deliberately irreversible: principal fields are the canonical identity shape.
  }
}
