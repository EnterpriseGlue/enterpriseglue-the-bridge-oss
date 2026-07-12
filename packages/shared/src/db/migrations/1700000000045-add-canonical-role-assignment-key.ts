import { TableColumn, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner, Table } from 'typeorm';
import { canonicalRoleAssignmentKey } from '../../authz/role-assignment-identity.js';
import { RbacRoleAssignment } from '../../infrastructure/persistence/entities/RbacRoleAssignment.js';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

export class AddCanonicalRoleAssignmentKey1700000000045 implements MigrationInterface {
  name = 'AddCanonicalRoleAssignmentKey1700000000045';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner, 'RbacRoleAssignment', 'role_assignments');
    const table = await queryRunner.getTable(tableName);
    if (!table) return;

    if (!table.columns.some((column) => column.name === 'assignment_key')) {
      await queryRunner.addColumn(tableName, new TableColumn({ name: 'assignment_key', type: 'text', isNullable: true }));
    }

    const repository = queryRunner.manager.getRepository(RbacRoleAssignment);
    const rows = await repository.find();
    const seenKeys = new Set<string>();
    const duplicateIds: string[] = [];
    for (const row of rows) {
      const key = canonicalRoleAssignmentKey({
        tenantId: row.tenantId,
        principalType: row.principalType || 'user',
        principalId: row.principalId || row.userId,
        roleId: row.roleId,
        scopeType: row.scopeType || row.resourceType || '',
        scopeId: row.scopeId ?? row.resourceId,
        source: row.source,
        sourceRef: row.sourceRef ?? row.sourceMappingId,
      });
      if (seenKeys.has(key)) {
        duplicateIds.push(row.id);
        continue;
      }
      seenKeys.add(key);
      if (row.assignmentKey !== key) await repository.update({ id: row.id }, { assignmentKey: key });
    }
    // Retain one row for duplicate historical assignments before the canonical
    // unique guard. This is intentionally source-lineage aware through key.
    if (duplicateIds.length > 0) await repository.delete(duplicateIds);

    const refreshed = await queryRunner.getTable(tableName);
    if (!refreshed) return;
    const keyColumn = refreshed.columns.find((column) => column.name === 'assignment_key');
    if (keyColumn?.isNullable) {
      await queryRunner.changeColumn(tableName, 'assignment_key', new TableColumn({
        name: 'assignment_key',
        type: 'text',
        isNullable: false,
      }));
    }
    const tableWithRequiredKey = await queryRunner.getTable(tableName);
    if (!tableWithRequiredKey) return;
    const legacyUnique = tableWithRequiredKey.uniques.find((unique) => unique.name === 'uq_role_assignments_identity');
    if (legacyUnique) await queryRunner.dropUniqueConstraint(tableName, legacyUnique);
    if (!tableWithRequiredKey.uniques.some((unique) => unique.name === 'uq_role_assignments_canonical_identity')) {
      await queryRunner.createUniqueConstraint(tableName, new TableUnique({
        name: 'uq_role_assignments_canonical_identity',
        columnNames: ['assignment_key'],
      }));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner, 'RbacRoleAssignment', 'role_assignments');
    const table = await queryRunner.getTable(tableName);
    if (!table) return;
    const canonicalUnique = table.uniques.find((unique) => unique.name === 'uq_role_assignments_canonical_identity');
    if (canonicalUnique) await queryRunner.dropUniqueConstraint(tableName, canonicalUnique);
    if (table.columns.some((column) => column.name === 'assignment_key')) await queryRunner.dropColumn(tableName, 'assignment_key');
  }
}
