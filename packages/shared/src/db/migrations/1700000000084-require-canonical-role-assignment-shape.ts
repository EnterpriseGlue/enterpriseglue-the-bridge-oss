import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

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
    const rows = await queryRunner.query(
      `SELECT id, user_id, principal_type, principal_id, resource_type, resource_id, scope_type, scope_id FROM ${tableName}`,
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
        `UPDATE ${tableName} SET principal_type = ${queryRunner.connection.driver.createParameter('principalType', 0)}, principal_id = ${queryRunner.connection.driver.createParameter('principalId', 1)}, scope_type = ${queryRunner.connection.driver.createParameter('scopeType', 2)}, scope_id = ${queryRunner.connection.driver.createParameter('scopeId', 3)} WHERE id = ${queryRunner.connection.driver.createParameter('assignmentId', 4)}`,
        parameters,
      );
    }

    await queryRunner.changeColumn(tableName, 'principal_type', new TableColumn({ name: 'principal_type', type: 'text', isNullable: false }));
    await queryRunner.changeColumn(tableName, 'principal_id', new TableColumn({ name: 'principal_id', type: 'text', isNullable: false }));
    await queryRunner.changeColumn(tableName, 'scope_type', new TableColumn({ name: 'scope_type', type: 'text', isNullable: false }));
  }

  public async down(): Promise<void> {
    // Canonical fields remain populated after rollout; restoring nullable columns would be destructive.
  }
}
