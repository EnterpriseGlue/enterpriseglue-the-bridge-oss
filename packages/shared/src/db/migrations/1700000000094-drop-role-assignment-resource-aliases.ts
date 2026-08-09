import type { MigrationInterface, QueryRunner } from 'typeorm';

/** scope_type and scope_id are the sole persisted assignment target fields. */
export class DropRoleAssignmentResourceAliases1700000000094 implements MigrationInterface {
  name = 'DropRoleAssignmentResourceAliases1700000000094';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('role_assignments'))) return;
    const table = await queryRunner.getTable('role_assignments');
    if (!table) return;
    const legacyIndex = table.indices.find((index) => index.name === 'idx_role_assignments_resource');
    if (legacyIndex) await queryRunner.dropIndex(table, legacyIndex);
    for (const column of ['resource_type', 'resource_id']) {
      if (table.columns.some((entry) => entry.name === column)) await queryRunner.dropColumn(table, column);
    }
  }

  async down(): Promise<void> {
    // Deliberately irreversible: scope fields are the canonical target shape.
  }
}
