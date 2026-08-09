import type { MigrationInterface, QueryRunner } from 'typeorm';

/** source_ref is the sole role-assignment lineage field. */
export class DropRoleAssignmentSourceMappingAlias1700000000093 implements MigrationInterface {
  name = 'DropRoleAssignmentSourceMappingAlias1700000000093';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('role_assignments'))) return;
    const table = await queryRunner.getTable('role_assignments');
    if (!table?.columns.some((column) => column.name === 'source_mapping_id')) return;
    const legacyIndex = table.indices.find((index) => index.name === 'idx_role_assignments_source');
    if (legacyIndex) await queryRunner.dropIndex(table, legacyIndex);
    await queryRunner.dropColumn(table, 'source_mapping_id');
  }

  async down(): Promise<void> {
    // Deliberately irreversible: sourceRef is the canonical lineage field.
  }
}
