import { TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner, Table } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

async function addColumnIfMissing(queryRunner: QueryRunner, table: Table, column: TableColumn): Promise<void> {
  if (!table.columns.some((existing) => existing.name === column.name)) {
    await queryRunner.addColumn(table, column);
  }
}

async function addIndexIfMissing(queryRunner: QueryRunner, table: Table, index: TableIndex): Promise<void> {
  if (!table.indices.some((existing) => existing.name === index.name)) {
    await queryRunner.createIndex(table, index);
  }
}

export class AddPrincipalRoleAssignmentShape1700000000022 implements MigrationInterface {
  name = 'AddPrincipalRoleAssignmentShape1700000000022';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner, 'RbacRoleAssignment', 'role_assignments');
    const table = await queryRunner.getTable(tableName);
    if (!table) return;

    await addColumnIfMissing(queryRunner, table, new TableColumn({ name: 'principal_type', type: 'text', isNullable: true }));
    await addColumnIfMissing(queryRunner, table, new TableColumn({ name: 'principal_id', type: 'text', isNullable: true }));
    await addColumnIfMissing(queryRunner, table, new TableColumn({ name: 'scope_type', type: 'text', isNullable: true }));
    await addColumnIfMissing(queryRunner, table, new TableColumn({ name: 'scope_id', type: 'text', isNullable: true }));
    await addColumnIfMissing(queryRunner, table, new TableColumn({ name: 'source_ref', type: 'text', isNullable: true }));
    await addColumnIfMissing(queryRunner, table, new TableColumn({ name: 'expires_at', type: 'bigint', isNullable: true }));

    const refreshedTable = await queryRunner.getTable(tableName);
    if (!refreshedTable) return;

    await addIndexIfMissing(queryRunner, refreshedTable, new TableIndex({
      name: 'idx_role_assignments_principal',
      columnNames: ['principal_type', 'principal_id'],
    }));
    await addIndexIfMissing(queryRunner, refreshedTable, new TableIndex({
      name: 'idx_role_assignments_scope',
      columnNames: ['scope_type', 'scope_id'],
    }));

    await queryRunner.manager
      .createQueryBuilder()
      .update(tableName)
      .set({
        principalType: () => "'user'",
        principalId: () => 'user_id',
        scopeType: () => 'resource_type',
        scopeId: () => 'resource_id',
        sourceRef: () => 'source_mapping_id',
      })
      .where('principal_type IS NULL')
      .execute();
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner, 'RbacRoleAssignment', 'role_assignments');
    const table = await queryRunner.getTable(tableName);
    if (!table) return;

    for (const indexName of ['idx_role_assignments_scope', 'idx_role_assignments_principal']) {
      const index = table.indices.find((existing) => existing.name === indexName);
      if (index) {
        await queryRunner.dropIndex(table, index);
      }
    }

    for (const columnName of ['expires_at', 'source_ref', 'scope_id', 'scope_type', 'principal_id', 'principal_type']) {
      if ((await queryRunner.getTable(tableName))?.columns.some((column) => column.name === columnName)) {
        await queryRunner.dropColumn(tableName, columnName);
      }
    }
  }
}
