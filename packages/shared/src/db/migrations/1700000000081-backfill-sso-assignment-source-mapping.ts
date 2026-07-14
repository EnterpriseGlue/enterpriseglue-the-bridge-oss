import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner): string {
  try { return queryRunner.connection.getMetadata('RbacRoleAssignment').tablePath; } catch { return 'role_assignments'; }
}

/**
 * Older SSO assignment writers persisted only source_ref even though cleanup
 * is indexed by source_mapping_id. Preserve the existing source contract while
 * making every legacy SSO assignment addressable by its originating mapping.
 */
export class BackfillSsoAssignmentSourceMapping1700000000081 implements MigrationInterface {
  name = 'BackfillSsoAssignmentSourceMapping1700000000081';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    const table = await queryRunner.getTable(tableName);
    if (!table
      || !table.columns.some((column) => column.name === 'source_mapping_id')
      || !table.columns.some((column) => column.name === 'source_ref')) return;
    const sourceParameter = queryRunner.connection.driver.createParameter('source', 0);
    await queryRunner.query(
      `UPDATE ${tableName} SET source_mapping_id = source_ref WHERE source = ${sourceParameter} AND source_mapping_id IS NULL AND source_ref IS NOT NULL`,
      ['sso'],
    );
  }

  async down(): Promise<void> {
    // This is a data backfill; clearing the repaired linkage would reintroduce
    // orphaned mapping-managed assignments, so reversal is deliberately a no-op.
  }
}
