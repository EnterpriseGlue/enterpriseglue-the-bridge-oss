import type { MigrationInterface, QueryRunner } from 'typeorm';
import { requireExistingColumn, sqlIdentifier, sqlTablePath } from './support/portable-columns.js';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

export class RequireCanonicalRoleAssignmentShape1700000000084 implements MigrationInterface {
  name = 'RequireCanonicalRoleAssignmentShape1700000000084';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner, 'RbacRoleAssignment', 'role_assignments');
    const table = await queryRunner.getTable(tableName);
    if (!table) return;
    const column = (name: string) => sqlIdentifier(queryRunner, name);
    const tableRef = sqlTablePath(queryRunner, tableName);
    // Later migrations drop the legacy alias columns, so a Path B bootstrap can
    // present this table without them; read only what the schema still has.
    const present = new Set(table.columns.map((existing) => existing.name));
    const selected = [
      'id', 'user_id', 'principal_type', 'principal_id',
      'resource_type', 'resource_id', 'scope_type', 'scope_id',
    ].filter((name) => present.has(name)).map(column).join(', ');
    const rows = await queryRunner.query(
      `SELECT ${selected} FROM ${tableRef}`,
    ) as Array<Record<string, string | null>>;

    for (const row of rows) {
      const principalType = row.principal_type?.trim() || (row.user_id ? 'user' : '');
      const principalId = row.principal_id?.trim() || row.user_id || '';
      const scopeType = row.scope_type?.trim() || row.resource_type?.trim() || '';
      const scopeId = row.scope_id ?? row.resource_id ?? null;
      if (!principalType || !principalId || !scopeType) {
        throw new Error(`Cannot derive canonical principal and scope for role assignment ${row.id}; repair the row before retrying migration`);
      }
      const parameters = [principalType, principalId, scopeType, scopeId, row.id];
      await queryRunner.query(
        `UPDATE ${tableRef} SET ${column('principal_type')} = ${queryRunner.connection.driver.createParameter('principalType', 0)},`
        + ` ${column('principal_id')} = ${queryRunner.connection.driver.createParameter('principalId', 1)},`
        + ` ${column('scope_type')} = ${queryRunner.connection.driver.createParameter('scopeType', 2)},`
        + ` ${column('scope_id')} = ${queryRunner.connection.driver.createParameter('scopeId', 3)}`
        + ` WHERE ${column('id')} = ${queryRunner.connection.driver.createParameter('assignmentId', 4)}`,
        parameters,
      );
    }

    // Tighten the live columns in place: a rebuilt column whose type differs
    // makes Oracle drop and re-add it, which fails on a populated table (ORA-01758).
    for (const name of ['principal_type', 'principal_id', 'scope_type']) {
      await requireExistingColumn(queryRunner, tableName, name);
    }
  }

  public async down(): Promise<void> {
    // Canonical fields remain populated after rollout; restoring nullable columns would be destructive.
  }
}
