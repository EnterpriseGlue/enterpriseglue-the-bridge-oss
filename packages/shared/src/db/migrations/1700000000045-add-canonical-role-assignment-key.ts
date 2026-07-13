import { TableColumn, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner, Table } from 'typeorm';
import { canonicalRoleAssignmentKey } from '../../authz/role-assignment-identity.js';

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

    const rows = await queryRunner.query(`SELECT id, tenant_id, user_id, principal_type, principal_id, role_id, resource_type, resource_id, scope_type, scope_id, source, source_mapping_id, source_ref, assignment_key FROM ${tableName}`) as Array<{
      id: string;
      tenant_id: string | null;
      user_id: string | null;
      principal_type: string | null;
      principal_id: string | null;
      role_id: string;
      resource_type: string | null;
      resource_id: string | null;
      scope_type: string | null;
      scope_id: string | null;
      source: string;
      source_mapping_id: string | null;
      source_ref: string | null;
      assignment_key: string | null;
    }>;
    const seenKeys = new Set<string>();
    const duplicateIds: string[] = [];
    for (const row of rows) {
      const key = canonicalRoleAssignmentKey({
        tenantId: row.tenant_id,
        principalType: row.principal_type || 'user',
        principalId: row.principal_id || row.user_id || '',
        roleId: row.role_id,
        scopeType: row.scope_type || row.resource_type || '',
        scopeId: row.scope_id ?? row.resource_id,
        source: row.source,
        sourceRef: row.source_ref ?? row.source_mapping_id,
      });
      if (seenKeys.has(key)) {
        duplicateIds.push(row.id);
        continue;
      }
      seenKeys.add(key);
      if (row.assignment_key !== key) {
        const keyParameter = queryRunner.connection.driver.createParameter('assignmentKey', 0);
        const idParameter = queryRunner.connection.driver.createParameter('assignmentId', 1);
        await queryRunner.query(
          `UPDATE ${tableName} SET assignment_key = ${keyParameter} WHERE id = ${idParameter}`,
          [key, row.id],
        );
      }
    }
    // Retain one row for duplicate historical assignments before the canonical
    // unique guard. This is intentionally source-lineage aware through key.
    for (const id of duplicateIds) {
      const idParameter = queryRunner.connection.driver.createParameter('assignmentId', 0);
      await queryRunner.query(`DELETE FROM ${tableName} WHERE id = ${idParameter}`, [id]);
    }

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
    const hasCanonicalUnique = tableWithRequiredKey.uniques.some((unique) => unique.name === 'uq_role_assignments_canonical_identity')
      || tableWithRequiredKey.indices.some((index) => index.name === 'uq_role_assignments_canonical_identity');
    if (!hasCanonicalUnique) {
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
